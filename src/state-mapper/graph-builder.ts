/**
 * WCRS Graph Builder (Module 2 — UI State Mapper)
 * Converts raw action traces into a directed state graph.
 * Each unique page state becomes a graph node; each action becomes an edge
 * annotated with selectors, guards, and confidence scores.
 *
 * Bible spec:
 *   "Consume Action-State Recorder traces, infer state graph, add guards/
 *    assertions/recovery paths. North-Star Vision: a complete, inspectable
 *    map of PointClickCare's CU workflow as a state machine."
 *
 * Critical insight from the Bible:
 *   "The UI State Mapper is the most important piece — it models the app
 *    as a directed graph." (Insight #3, HIGH confidence)
 */

import type {
  WorkflowTrace,
  ActionEvent,
  PageState,
  TraceState,
  TraceTransition,
  GuardCondition,
  SelectorCandidate,
  StateMachineDefinition
} from '../types/index.js';

import { exportToXState, type ExportOptions } from './xstate-export.js';
import { calculateConfidence } from './confidence-scorer.js';

// ── Public API ─────────────────────────────────────────────────────────────

export interface BuildGraphOptions {
  /** Minimum confidence threshold to include an edge (default: 0.1) */
  minConfidence?: number;
  /** If true, normalize URLs by stripping patient-specific params (default: false for PCC) */
  normalizeUrlParams?: boolean;
  /** List of URL params to preserve even if normalizing (PCC: ESOLclientid) */
  preserveParams?: string[];
}

export interface StateGraph {
  states: Map<string, TraceState>;
  transitions: TraceTransition[];
  totalTraces: number;
}

/**
 * Build a state graph from one or more workflow traces.
 *
 * @param traces - One or more workflow_trace.json objects
 * @param options - Build configuration
 * @returns StateGraph with states and transitions
 */
export function buildGraph(traces: WorkflowTrace[], options: BuildGraphOptions = {}): StateGraph {
  const minConfidence = options.minConfidence ?? 0.1;
  const normalizeParams = options.normalizeUrlParams ?? false;
  const preserveParams = options.preserveParams ?? ['ESOLclientid', 'clientId', 'patientId'];

  const states = new Map<string, TraceState>();
  const transitionMap = new Map<string, TraceTransition>();

  for (const trace of traces) {
    processTrace(trace, states, transitionMap, { normalizeParams, preserveParams, totalTraces: traces.length });
  }

  // Recalculate confidence for all transitions now that we know total trace count
  const transitions: TraceTransition[] = [];
  for (const transition of transitionMap.values()) {
    transition.confidence = calculateConfidence(transition.recordings_seen, traces.length);
    if (transition.confidence >= minConfidence) {
      transitions.push(transition);
    }
  }

  return { states, transitions, totalTraces: traces.length };
}

/**
 * Build a state graph and export it as an XState v5 machine definition.
 *
 * @param traces - Workflow traces
 * @param options - Build options
 * @param exportOptions - XState export options (machineId, addRecoveryStates, etc.)
 * @returns XState-compatible StateMachineDefinition
 */
export function buildAndExportXState(
  traces: WorkflowTrace[],
  options: BuildGraphOptions = {},
  exportOptions: ExportOptions = {}
): StateMachineDefinition {
  const graph = buildGraph(traces, options);
  return exportToXState(graph, exportOptions);
}

// ── Trace Processing ───────────────────────────────────────────────────────

interface ProcessOptions {
  normalizeParams: boolean;
  preserveParams: string[];
  totalTraces: number;
}

function processTrace(
  trace: WorkflowTrace,
  states: Map<string, TraceState>,
  transitionMap: Map<string, TraceTransition>,
  opts: ProcessOptions
): void {
  const actions = trace.actions.filter(a => a.action_type !== 'checkpoint');

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!action.state_before || !action.state_after) continue;
    if (!action.state_before.url || !action.state_after.url) continue;

    // Identify states
    const beforeState = identifyState(action.state_before, opts);
    const afterState = identifyState(action.state_after, opts);

    // Register states
    updateState(states, beforeState, action.state_before);
    updateState(states, afterState, action.state_after);

    // Skip self-transitions (same state before and after)
    if (beforeState.id === afterState.id) continue;

    // Create or update transition
    const transitionKey = buildTransitionKey(beforeState.id, afterState.id, action.action_type);
    const existing = transitionMap.get(transitionKey);

    if (existing) {
      existing.recordings_seen++;
      mergeSelectors(existing.selectors, action.target?.selectors ?? []);
    } else {
      const transition: TraceTransition = {
        id: transitionKey,
        from: beforeState.id,
        to: afterState.id,
        event: generateEventName(action),
        action_type: action.action_type,
        selectors: [...(action.target?.selectors ?? [])],
        guard_conditions: inferGuards(action.state_before, action),
        confidence: 0, // calculated after all traces
        recordings_seen: 1
      };
      transitionMap.set(transitionKey, transition);
    }
  }
}

// ── State Identity ─────────────────────────────────────────────────────────

/**
 * Identify a unique state from page state info.
 * Two states are the same if they have the same normalized URL + DOM signature.
 *
 * Bible note: "The same URL can represent different states (e.g., different
 * tabs selected on same page). DOM signature hashing must be selective."
 */
function identifyState(pageState: PageState, opts: ProcessOptions): TraceState {
  const urlPattern = normalizeUrl(pageState.url, opts);
  const domSig = pageState.dom_snapshot_hash || '00000000';

  // ID: combine URL pattern + DOM signature, sanitize for XState
  const rawId = `${urlPattern}__${domSig}`;
  const id = sanitizeStateId(rawId);

  return {
    id,
    url_pattern: urlPattern,
    dom_signature: domSig,
    title: pageState.title || '',
    recordings_seen: 1
  };
}

function updateState(
  states: Map<string, TraceState>,
  state: TraceState,
  pageState: PageState
): void {
  const existing = states.get(state.id);
  if (existing) {
    existing.recordings_seen++;
    // Update title if empty
    if (!existing.title && pageState.title) {
      existing.title = pageState.title;
    }
  } else {
    states.set(state.id, { ...state });
  }
}

// ── Guard Inference ────────────────────────────────────────────────────────

function inferGuards(stateBefore: PageState, action: ActionEvent): GuardCondition[] {
  const guards: GuardCondition[] = [];

  // Guard: must be at expected URL
  if (stateBefore.url) {
    guards.push({
      type: 'url_match',
      pattern: normalizeUrl(stateBefore.url, { normalizeParams: false, preserveParams: [] })
    });
  }

  // Guard: key selectors must be present (from target element)
  const stableSelectors = (action.target?.selectors ?? [])
    .filter(s => s.strategy !== 'css' && s.resilience > 0.5)
    .map(s => s.selector)
    .slice(0, 2);

  if (stableSelectors.length > 0) {
    guards.push({ type: 'element_present', selectors: stableSelectors });
  }

  return guards;
}

// ── Selector Merging ───────────────────────────────────────────────────────

/**
 * Merge new selectors into an existing list.
 * - Keeps highest-resilience selector per strategy
 * - Deduplicates by selector string
 * - Caps at 5 total candidates
 */
function mergeSelectors(
  existing: SelectorCandidate[],
  incoming: SelectorCandidate[]
): void {
  for (const candidate of incoming) {
    const dup = existing.find(e => e.selector === candidate.selector);
    if (!dup) {
      // Check if better candidate for same strategy
      const sameStrategy = existing.find(e => e.strategy === candidate.strategy);
      if (!sameStrategy || candidate.resilience > sameStrategy.resilience) {
        if (!sameStrategy) {
          existing.push(candidate);
        } else {
          sameStrategy.selector = candidate.selector;
          sameStrategy.resilience = candidate.resilience;
          sameStrategy.playwright_locator = candidate.playwright_locator;
        }
      }
    }
  }

  // Sort and cap
  existing.sort((a, b) => b.resilience - a.resilience);
  if (existing.length > 5) existing.splice(5);
}

// ── Utilities ──────────────────────────────────────────────────────────────

function normalizeUrl(url: string, opts: { normalizeParams: boolean; preserveParams: string[] }): string {
  try {
    const u = new URL(url);
    if (opts.normalizeParams) {
      // Remove all query params except preserved ones
      const preserved = new URLSearchParams();
      for (const param of opts.preserveParams) {
        const val = u.searchParams.get(param);
        if (val) preserved.set(param, val);
      }
      return `${u.origin}${u.pathname}${preserved.toString() ? '?' + preserved.toString() : ''}`;
    }
    // Keep full URL but remove fragment
    return `${u.origin}${u.pathname}${u.search}`;
  } catch (_) {
    return url.split('#')[0] ?? url;
  }
}

function sanitizeStateId(raw: string): string {
  return raw
    .replace(/https?:\/\//g, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120);
}

function buildTransitionKey(from: string, to: string, actionType: string): string {
  return `${from}--${actionType}--${to}`;
}

function generateEventName(action: ActionEvent): string {
  const type = action.action_type.toUpperCase();
  const domTarget = action.target && 'visible_text' in action.target ? action.target : null;
  const text = domTarget?.visible_text?.slice(0, 20).replace(/[^A-Z0-9]/gi, '_').toUpperCase() || '';
  return text ? `${type}_${text}` : type;
}
