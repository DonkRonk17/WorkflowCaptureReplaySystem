/**
 * WCRS XState Exporter (Module 2 — UI State Mapper)
 * Converts the internal StateGraph representation into an XState v5
 * machine definition that can be:
 *   1. Visualized in Stately.ai
 *   2. Executed via @xstate/xstate createMachine()
 *   3. Saved to workflow_graph.json
 *
 * Bible spec:
 *   "Produces valid XState v5 machine definitions."
 *   "Graph is visualizable in Stately.ai."
 *   "All states have URL patterns and selector references."
 */

import type {
  StateMachineDefinition,
  XStateNode,
  XStateTransition,
  TraceState,
  TraceTransition
} from '../types/index.js';

import type { StateGraph } from './graph-builder.js';
import { injectRecoveryStates } from './recovery-injector.js';
import { confidenceLabel } from './confidence-scorer.js';

// ── Public API ─────────────────────────────────────────────────────────────

export interface ExportOptions {
  machineId?: string;
  addRecoveryStates?: boolean;
  addContextSchema?: boolean;
  includeMetadata?: boolean;
}

/**
 * Export a StateGraph to an XState v5 machine definition.
 *
 * @param graph - Built state graph
 * @param options - Export options
 * @returns XState-compatible machine definition
 */
export function exportToXState(
  graph: StateGraph,
  options: ExportOptions = {}
): StateMachineDefinition {
  const machineId = options.machineId ?? 'wcrs_workflow';
  const addRecovery = options.addRecoveryStates ?? true;
  const includeMetadata = options.includeMetadata ?? true;

  // Build states map
  const xstateStates: Record<string, XStateNode> = {};

  for (const [stateId, state] of graph.states) {
    xstateStates[stateId] = buildXStateNode(state, includeMetadata);
  }

  // Build transitions for each state
  for (const transition of graph.transitions) {
    const fromNode = xstateStates[transition.from];
    if (!fromNode) continue;

    if (!fromNode.on) fromNode.on = {};

    const xsTransition: XStateTransition = {
      target: transition.to,
      guard: transition.guard_conditions.length > 0
        ? buildGuardName(transition)
        : undefined,
      actions: ['logTransition']
    };

    // Handle multiple transitions with the same event name (diverging paths)
    const eventName = transition.event;
    const existing = fromNode.on[eventName];
    if (existing) {
      const existingArr = Array.isArray(existing) ? existing : [existing];
      fromNode.on[eventName] = [...existingArr, xsTransition];
    } else {
      fromNode.on[eventName] = xsTransition;
    }
  }

  // Find initial state (highest-confidence starting point)
  const initialState = findInitialState(graph);

  const machine: StateMachineDefinition = {
    id: machineId,
    initial: initialState,
    context: buildContext(graph),
    states: xstateStates
  };

  // Inject recovery states
  if (addRecovery) {
    injectRecoveryStates(machine, {
      defaultTimeout: 60000,
      stateTimeouts: { mar_tar: 90000 },
      maxRetries: 2,
      addSkipTransitions: true
    });
  }

  return machine;
}

/**
 * Serialize a machine definition to JSON string (workflow_graph.json format).
 *
 * @param machine - Machine definition
 * @param pretty - Pretty-print (default: true)
 * @returns JSON string
 */
export function serializeMachine(machine: StateMachineDefinition, pretty = true): string {
  return JSON.stringify(machine, null, pretty ? 2 : 0);
}

/**
 * Generate a Stately.ai-compatible visualization URL for a machine.
 * (Opens the machine JSON in the Stately editor.)
 *
 * @param machine - Machine definition
 * @returns Stately.ai URL string
 */
export function generateStatelyUrl(machine: StateMachineDefinition): string {
  const json = encodeURIComponent(serializeMachine(machine, false));
  return `https://stately.ai/viz?machine=${json}`;
}

// ── Node Builder ───────────────────────────────────────────────────────────

function buildXStateNode(state: TraceState, includeMetadata: boolean): XStateNode {
  const node: XStateNode = {
    on: {}
  };

  if (includeMetadata) {
    node.meta = {
      url_pattern: state.url_pattern,
      title: state.title,
      confidence: state.recordings_seen > 0 ? Math.min(1, state.recordings_seen / 3) : 0,
      recordings_seen: state.recordings_seen
    };
  }

  return node;
}

function buildGuardName(transition: TraceTransition): string {
  // Generate a deterministic guard function name from the transition
  const parts = [
    transition.from.slice(0, 20).replace(/_+/g, '_'),
    transition.action_type,
    confidenceLabel(transition.confidence).toLowerCase()
  ];
  return `guard_${parts.join('_')}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60);
}

// ── Context Builder ────────────────────────────────────────────────────────

function buildContext(graph: StateGraph): Record<string, unknown> {
  return {
    // CU workflow context
    patient_id: null,
    cu_date: null,
    last_cu_date: null,
    pull_date: null,
    collected_docs: [],

    // Execution metadata
    current_step: 0,
    total_steps: graph.transitions.length,
    retry_count: 0,
    max_retries: 2,
    last_error: null,
    escalated: false
  };
}

// ── Initial State Detection ────────────────────────────────────────────────

function findInitialState(graph: StateGraph): string {
  if (graph.states.size === 0) return 'idle';

  // The initial state is the one with no incoming transitions
  const hasIncoming = new Set<string>();
  for (const t of graph.transitions) {
    hasIncoming.add(t.to);
  }

  // Find states with no incoming transitions (entry points)
  const entryStates = [...graph.states.keys()].filter(id => !hasIncoming.has(id));

  if (entryStates.length === 1) return entryStates[0]!;
  if (entryStates.length > 1) {
    // Prefer a login or home state
    const preferred = entryStates.find(id => /login|home|start|init/i.test(id));
    return preferred ?? entryStates[0]!;
  }

  // All states have incoming — return the one seen most often as first action
  return [...graph.states.entries()].sort(([, a], [, b]) => b.recordings_seen - a.recordings_seen)[0]?.[0] ?? 'state_0';
}
