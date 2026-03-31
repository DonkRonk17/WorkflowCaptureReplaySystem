/**
 * WCRS State Differ (Module 2 — UI State Mapper)
 * Merges multiple workflow traces into a single, unified StateGraph.
 *
 * Core algorithm:
 *   1. Build individual graph per trace (via graph-builder)
 *   2. Reconcile states by ID — merge title/metadata, increment recordings_seen
 *   3. Reconcile transitions — same (from, to, actionType) key gets recordings_seen++
 *      and selectors merged from all contributing traces
 *   4. Diverging paths (same from-state, different to-state) are KEPT as separate
 *      transitions, each with their own confidence score
 *   5. Recalculate confidence for all transitions against total trace count
 *
 * Bible spec:
 *   "If trace is malformed, skip with warning and continue with remaining traces."
 *   "Two traces show different paths from same state → both edges added with confidence scores."
 *   "Multi-trace merge with confidence scoring."
 */

import type {
  WorkflowTrace,
  TraceState,
  TraceTransition,
  SelectorCandidate
} from '../types/index.js';

import { buildGraph, type StateGraph, type BuildGraphOptions } from './graph-builder.js';
import { calculateConfidence } from './confidence-scorer.js';

// ── Public API ─────────────────────────────────────────────────────────────

export interface DiffResult {
  graph: StateGraph;
  skippedTraces: SkippedTrace[];
  mergeStats: MergeStats;
}

export interface SkippedTrace {
  traceId: string;
  reason: string;
}

export interface MergeStats {
  inputTraces: number;
  validTraces: number;
  skippedTraces: number;
  mergedStates: number;
  newStates: number;
  mergedTransitions: number;
  newTransitions: number;
  divergingPaths: number;   // transitions where same from-state goes to different to-states
}

/**
 * Merge multiple workflow traces into a single unified StateGraph.
 *
 * Unlike buildGraph() which processes all traces in one pass, diffTraces()
 * processes each trace individually and then reconciles the resulting graphs.
 * This gives more granular control over per-trace contributions.
 *
 * @param traces - Array of workflow traces to merge
 * @param options - Graph build options (applied to each per-trace build)
 * @returns DiffResult with merged graph and merge statistics
 */
export function diffTraces(
  traces: WorkflowTrace[],
  options: BuildGraphOptions = {}
): DiffResult {
  const skippedTraces: SkippedTrace[] = [];
  const validTraces: WorkflowTrace[] = [];

  // Validate and filter traces
  for (const trace of traces) {
    const validation = validateTrace(trace);
    if (validation.valid) {
      validTraces.push(trace);
    } else {
      skippedTraces.push({ traceId: trace.trace_id ?? 'unknown', reason: validation.reason });
      console.warn(`[WCRS:StateDiffer] Skipping trace ${trace.trace_id}: ${validation.reason}`);
    }
  }

  if (validTraces.length === 0) {
    return {
      graph: { states: new Map(), transitions: [], totalTraces: 0 },
      skippedTraces,
      mergeStats: {
        inputTraces: traces.length, validTraces: 0, skippedTraces: skippedTraces.length,
        mergedStates: 0, newStates: 0, mergedTransitions: 0, newTransitions: 0, divergingPaths: 0
      }
    };
  }

  // Build individual graphs
  const perTraceGraphs = validTraces.map(trace =>
    buildGraph([trace], { ...options, minConfidence: 0.0 })
  );

  // Merge all graphs
  const mergedStates = new Map<string, TraceState>();
  const transitionMap = new Map<string, TraceTransition>();

  let stats: MergeStats = {
    inputTraces: traces.length,
    validTraces: validTraces.length,
    skippedTraces: skippedTraces.length,
    mergedStates: 0,
    newStates: 0,
    mergedTransitions: 0,
    newTransitions: 0,
    divergingPaths: 0
  };

  for (const singleGraph of perTraceGraphs) {
    // Merge states
    for (const [id, state] of singleGraph.states) {
      const existing = mergedStates.get(id);
      if (existing) {
        existing.recordings_seen += state.recordings_seen;
        if (!existing.title && state.title) existing.title = state.title;
        stats.mergedStates++;
      } else {
        mergedStates.set(id, { ...state, recordings_seen: state.recordings_seen });
        stats.newStates++;
      }
    }

    // Merge transitions
    for (const transition of singleGraph.transitions) {
      const key = transition.id;
      const existing = transitionMap.get(key);
      if (existing) {
        existing.recordings_seen += transition.recordings_seen;
        mergeSelectors(existing.selectors, transition.selectors);
        stats.mergedTransitions++;
      } else {
        transitionMap.set(key, { ...transition, selectors: [...transition.selectors] });
        stats.newTransitions++;
      }
    }
  }

  // Recalculate confidence against total valid trace count
  const allTransitions: TraceTransition[] = [];
  const minConfidence = options.minConfidence ?? 0.1;

  for (const transition of transitionMap.values()) {
    transition.confidence = calculateConfidence(transition.recordings_seen, validTraces.length);
    if (transition.confidence >= minConfidence) {
      allTransitions.push(transition);
    }
  }

  // Count diverging paths
  stats.divergingPaths = countDivergingPaths(allTransitions);

  const mergedGraph: StateGraph = {
    states: mergedStates,
    transitions: allTransitions,
    totalTraces: validTraces.length
  };

  return { graph: mergedGraph, skippedTraces, mergeStats: stats };
}

/**
 * Produce a human-readable diff summary between two StateGraphs.
 * Useful for understanding how a new recording changes the model.
 *
 * @param base - Existing graph (baseline)
 * @param updated - New graph (after adding more traces)
 * @returns GraphDiff object
 */
export function diffGraphs(base: StateGraph, updated: StateGraph): GraphDiff {
  const addedStates: string[] = [];
  const removedStates: string[] = [];
  const addedTransitions: string[] = [];
  const removedTransitions: string[] = [];
  const confidenceChanges: ConfidenceChange[] = [];

  // States
  for (const id of updated.states.keys()) {
    if (!base.states.has(id)) addedStates.push(id);
  }
  for (const id of base.states.keys()) {
    if (!updated.states.has(id)) removedStates.push(id);
  }

  // Transitions
  const baseTransMap = new Map(base.transitions.map(t => [t.id, t]));
  const updatedTransMap = new Map(updated.transitions.map(t => [t.id, t]));

  for (const [id, updated_t] of updatedTransMap) {
    const base_t = baseTransMap.get(id);
    if (!base_t) {
      addedTransitions.push(id);
    } else if (Math.abs(updated_t.confidence - base_t.confidence) > 0.05) {
      confidenceChanges.push({
        transitionId: id,
        before: base_t.confidence,
        after: updated_t.confidence,
        delta: updated_t.confidence - base_t.confidence
      });
    }
  }
  for (const id of baseTransMap.keys()) {
    if (!updatedTransMap.has(id)) removedTransitions.push(id);
  }

  return { addedStates, removedStates, addedTransitions, removedTransitions, confidenceChanges };
}

export interface GraphDiff {
  addedStates: string[];
  removedStates: string[];
  addedTransitions: string[];
  removedTransitions: string[];
  confidenceChanges: ConfidenceChange[];
}

export interface ConfidenceChange {
  transitionId: string;
  before: number;
  after: number;
  delta: number;
}

// ── Private Helpers ────────────────────────────────────────────────────────

interface TraceValidation {
  valid: boolean;
  reason: string;
}

function validateTrace(trace: WorkflowTrace): TraceValidation {
  if (!trace) return { valid: false, reason: 'null or undefined trace' };
  if (!trace.trace_id) return { valid: false, reason: 'missing trace_id' };
  if (!Array.isArray(trace.actions)) return { valid: false, reason: 'actions is not an array' };
  if (trace.actions.length === 0) return { valid: false, reason: 'empty actions array' };
  return { valid: true, reason: '' };
}

/**
 * Merge incoming selectors into an existing list.
 * Keeps highest-resilience candidate per strategy, caps at 5.
 */
function mergeSelectors(existing: SelectorCandidate[], incoming: SelectorCandidate[]): void {
  for (const candidate of incoming) {
    const dup = existing.find(e => e.selector === candidate.selector);
    if (dup) continue;

    const sameStrategy = existing.find(e => e.strategy === candidate.strategy);
    if (!sameStrategy) {
      existing.push({ ...candidate });
    } else if (candidate.resilience > sameStrategy.resilience) {
      sameStrategy.selector = candidate.selector;
      sameStrategy.resilience = candidate.resilience;
      sameStrategy.playwright_locator = candidate.playwright_locator;
    }
  }

  existing.sort((a, b) => b.resilience - a.resilience);
  if (existing.length > 5) existing.splice(5);
}

/**
 * Count transitions where the same from-state has multiple edges to different to-states.
 */
function countDivergingPaths(transitions: TraceTransition[]): number {
  const fromMap = new Map<string, Set<string>>();
  for (const t of transitions) {
    const targets = fromMap.get(t.from) ?? new Set();
    targets.add(t.to);
    fromMap.set(t.from, targets);
  }
  let count = 0;
  for (const targets of fromMap.values()) {
    if (targets.size > 1) count += targets.size;
  }
  return count;
}
