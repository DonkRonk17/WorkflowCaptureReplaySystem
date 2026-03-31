/**
 * WCRS State Differ (Module 2 — UI State Mapper)
 * Merges multiple workflow traces into a single state graph and computes
 * before/after diffs between two graph versions.
 *
 * Bible spec:
 *   "Multi-trace merge with confidence scoring."
 *   "diffTraces() merges N traces into one StateGraph."
 *   "Skips malformed traces with console.warn (not throws)."
 */

import type { WorkflowTrace } from '../types/index.js';
import { buildGraph, type StateGraph } from './graph-builder.js';

// ── Public Interfaces ──────────────────────────────────────────────────────

export interface MergeStats {
  total_traces: number;
  valid_traces: number;
  skipped_traces: number;
  /** States that appeared across multiple traces (recordings_seen > 1) */
  merged_states: number;
  /** States that only appeared in a single trace (recordings_seen === 1) */
  new_states: number;
  /** Transitions that appeared across multiple traces (recordings_seen > 1) */
  merged_transitions: number;
  /** Transitions that only appeared in a single trace (recordings_seen === 1) */
  new_transitions: number;
}

export interface SkippedTrace {
  trace_id: string | null;
  reason: string;
}

export interface ConfidenceChange {
  transition_id: string;
  from: number;
  to: number;
  delta: number;
}

export interface DivergingPath {
  from_state: string;
  event: string;
  to_states: string[];
}

export interface DiffResult {
  graph: StateGraph;
  stats: MergeStats;
  skipped: SkippedTrace[];
  diverging_paths: DivergingPath[];
}

export interface DiffOptions {
  minConfidence?: number;
}

export interface GraphDiff {
  added_states: string[];
  removed_states: string[];
  added_transitions: string[];
  removed_transitions: string[];
  confidence_changes: ConfidenceChange[];
}

// ── Validation ─────────────────────────────────────────────────────────────

function isValidTrace(trace: unknown): trace is WorkflowTrace {
  if (!trace || typeof trace !== 'object') return false;
  const t = trace as Record<string, unknown>;
  return (
    typeof t['trace_id'] === 'string' &&
    Array.isArray(t['actions']) &&
    typeof t['wcrs_version'] === 'string' &&
    typeof t['recorded_at'] === 'string'
  );
}

function describeInvalidReason(trace: unknown): string {
  if (!trace || typeof trace !== 'object') return 'not an object';
  const t = trace as Record<string, unknown>;
  if (typeof t['trace_id'] !== 'string') return 'missing or non-string trace_id';
  if (!Array.isArray(t['actions'])) return 'missing or non-array actions';
  if (typeof t['wcrs_version'] !== 'string') return 'missing wcrs_version';
  if (typeof t['recorded_at'] !== 'string') return 'missing recorded_at';
  return 'unknown validation failure';
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Merge N workflow traces into a single state graph.
 * Malformed traces are skipped with a console.warn (never throws).
 *
 * @param traces - Array of unknown trace objects (validated internally)
 * @param options - Merge options (minConfidence threshold)
 * @returns DiffResult with merged graph, stats, skipped list, and diverging paths
 */
export function diffTraces(traces: unknown[], options: DiffOptions = {}): DiffResult {
  const validTraces: WorkflowTrace[] = [];
  const skipped: SkippedTrace[] = [];

  for (const trace of traces) {
    if (!isValidTrace(trace)) {
      const rawTraceId =
        trace && typeof trace === 'object'
          ? (trace as Record<string, unknown>)['trace_id']
          : null;
      const traceId: string | null =
        typeof rawTraceId === 'string' ? rawTraceId : null;

      const reason = describeInvalidReason(trace);
      console.warn(`[WCRS state-differ] Skipping malformed trace (${traceId ?? 'unknown'}): ${reason}`);
      skipped.push({ trace_id: traceId ?? null, reason });
    } else {
      validTraces.push(trace);
    }
  }

  const graph = buildGraph(validTraces, { minConfidence: options.minConfidence });

  // Partition states into merged (seen > 1) vs new (seen == 1)
  let mergedStates = 0;
  let newStates = 0;
  for (const state of graph.states.values()) {
    if (state.recordings_seen > 1) mergedStates++;
    else newStates++;
  }

  // Partition transitions into merged vs new
  const mergedTransitions = graph.transitions.filter(t => t.recordings_seen > 1).length;
  const newTransitions = graph.transitions.filter(t => t.recordings_seen === 1).length;

  const stats: MergeStats = {
    total_traces: traces.length,
    valid_traces: validTraces.length,
    skipped_traces: skipped.length,
    merged_states: mergedStates,
    new_states: newStates,
    merged_transitions: mergedTransitions,
    new_transitions: newTransitions
  };

  // Detect diverging paths: same from_state + same event → multiple to_states
  const pathMap = new Map<string, Set<string>>();
  for (const t of graph.transitions) {
    const key = `${t.from}::${t.event}`;
    if (!pathMap.has(key)) pathMap.set(key, new Set());
    pathMap.get(key)!.add(t.to);
  }

  const diverging_paths: DivergingPath[] = [];
  for (const [key, toStates] of pathMap) {
    if (toStates.size > 1) {
      const colonIdx = key.indexOf('::');
      const from_state = key.slice(0, colonIdx);
      const event = key.slice(colonIdx + 2);
      diverging_paths.push({ from_state, event, to_states: [...toStates] });
    }
  }

  return { graph, stats, skipped, diverging_paths };
}

/**
 * Compare two state graphs and return the structural diff.
 *
 * @param base - The original state graph
 * @param updated - The updated state graph (after a new recording or rebuild)
 * @returns GraphDiff describing added/removed states and confidence changes
 */
export function diffGraphs(base: StateGraph, updated: StateGraph): GraphDiff {
  const baseStateIds = new Set(base.states.keys());
  const updatedStateIds = new Set(updated.states.keys());

  const added_states = [...updatedStateIds].filter(id => !baseStateIds.has(id));
  const removed_states = [...baseStateIds].filter(id => !updatedStateIds.has(id));

  const baseTransIds = new Set(base.transitions.map(t => t.id));
  const updatedTransIds = new Set(updated.transitions.map(t => t.id));

  const added_transitions = [...updatedTransIds].filter(id => !baseTransIds.has(id));
  const removed_transitions = [...baseTransIds].filter(id => !updatedTransIds.has(id));

  const confidence_changes: ConfidenceChange[] = [];
  const baseTransMap = new Map(base.transitions.map(t => [t.id, t]));

  for (const t of updated.transitions) {
    const baseTrans = baseTransMap.get(t.id);
    if (baseTrans && Math.abs(baseTrans.confidence - t.confidence) > 0.001) {
      confidence_changes.push({
        transition_id: t.id,
        from: baseTrans.confidence,
        to: t.confidence,
        delta: t.confidence - baseTrans.confidence
      });
    }
  }

  return {
    added_states,
    removed_states,
    added_transitions,
    removed_transitions,
    confidence_changes
  };
}
