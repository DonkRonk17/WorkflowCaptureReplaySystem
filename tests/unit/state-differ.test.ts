/**
 * Tests for src/state-mapper/state-differ.ts
 */

import { diffTraces, diffGraphs } from '../../src/state-mapper/state-differ.js';
import { buildGraph } from '../../src/state-mapper/graph-builder.js';
import type { WorkflowTrace } from '../../src/types/index.js';
import sampleTrace from '../fixtures/sample-trace.json';

// ── Helpers ────────────────────────────────────────────────────────────────

function cloneTrace(base: WorkflowTrace, newId: string): WorkflowTrace {
  return { ...base, trace_id: newId };
}

const t1 = sampleTrace as WorkflowTrace;
const t2 = cloneTrace(t1, 'trace-002');
const t3 = cloneTrace(t1, 'trace-003');

// ── Test Suite ─────────────────────────────────────────────────────────────

describe('diffTraces', () => {
  test('3 identical traces merged into 1 graph with recordings_seen = 3', () => {
    const result = diffTraces([t1, t2, t3]);

    expect(result.graph.states.size).toBeGreaterThan(0);
    expect(result.stats.valid_traces).toBe(3);
    expect(result.stats.skipped_traces).toBe(0);

    // All transitions confirmed in all 3 traces
    for (const t of result.graph.transitions) {
      expect(t.recordings_seen).toBe(3);
    }
  });

  test('single trace produces recordings_seen = 1 on all transitions', () => {
    const result = diffTraces([t1]);
    for (const t of result.graph.transitions) {
      expect(t.recordings_seen).toBe(1);
    }
  });

  test('diverging paths: 2 transitions from same state with different targets', () => {
    // Build a trace where same from-state goes to two different to-states
    const traceA: WorkflowTrace = {
      ...t1,
      trace_id: 'diverge-A',
      actions: [t1.actions[0]!]
    };
    // Trace B: same action_type but different state_after
    const modifiedAction = {
      ...t1.actions[0]!,
      state_after: {
        url: 'https://www31.pointclickcare.com/different/path',
        title: 'Different Page',
        dom_snapshot_hash: 'aaaa1111'
      }
    };
    const traceB: WorkflowTrace = {
      ...t1,
      trace_id: 'diverge-B',
      actions: [modifiedAction]
    };

    const result = diffTraces([traceA, traceB]);

    // Should have 2 separate transitions (different destinations)
    expect(result.graph.transitions.length).toBe(2);
    // Should detect diverging paths
    expect(result.diverging_paths.length).toBeGreaterThan(0);
    const divPath = result.diverging_paths[0]!;
    expect(divPath.to_states.length).toBe(2);
  });

  test('malformed trace is skipped; valid traces are still processed', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const malformed = { foo: 'bar' }; // missing trace_id, actions, etc.
    const result = diffTraces([malformed, t1]);

    expect(result.stats.total_traces).toBe(2);
    expect(result.stats.valid_traces).toBe(1);
    expect(result.stats.skipped_traces).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toMatch(/trace_id|actions|object/i);
    expect(result.graph.states.size).toBeGreaterThan(0);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  test('null/non-object traces are skipped gracefully', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = diffTraces([null, undefined, 42, t1]);

    expect(result.stats.valid_traces).toBe(1);
    expect(result.stats.skipped_traces).toBe(3);
    expect(result.skipped[0]!.trace_id).toBeNull();

    consoleSpy.mockRestore();
  });

  test('empty trace list returns empty graph', () => {
    const result = diffTraces([]);
    expect(result.graph.states.size).toBe(0);
    expect(result.graph.transitions).toHaveLength(0);
    expect(result.stats.total_traces).toBe(0);
    expect(result.stats.valid_traces).toBe(0);
  });

  test('MergeStats reflects merged vs new states and transitions', () => {
    const result = diffTraces([t1, t2, t3]);

    // After 3 identical traces, states are seen 3 times → all merged
    expect(result.stats.merged_states).toBeGreaterThan(0);
    expect(result.stats.merged_transitions).toBeGreaterThan(0);
    // new_states + merged_states should equal total state count
    expect(result.stats.new_states + result.stats.merged_states).toBe(result.graph.states.size);
    expect(result.stats.new_transitions + result.stats.merged_transitions).toBe(result.graph.transitions.length);
  });

  test('confidence scores are higher with 3 traces than with 1', () => {
    const single = diffTraces([t1]);
    const triple = diffTraces([t1, t2, t3]);

    if (single.graph.transitions.length > 0 && triple.graph.transitions.length > 0) {
      const singleConf = single.graph.transitions[0]!.confidence;
      const tripleConf = triple.graph.transitions[0]!.confidence;
      expect(tripleConf).toBeGreaterThan(singleConf);
    }
  });
});

describe('diffGraphs', () => {
  test('detects added and removed states', () => {
    const baseGraph = buildGraph([t1]);

    // Build updated graph with an extra trace that adds a new state
    const extraTrace: WorkflowTrace = {
      ...t1,
      trace_id: 'extra-trace',
      actions: [
        {
          seq: 1,
          timestamp: '2026-03-30T10:00:00.000Z',
          action_type: 'navigate',
          target: { selectors: [], visible_text: '', tag: '', frame_path: ['main'], bounding_rect: null },
          input_value: null,
          state_before: {
            url: 'https://www31.pointclickcare.com/newpage',
            title: 'New Page',
            dom_snapshot_hash: 'new0001'
          },
          state_after: {
            url: 'https://www31.pointclickcare.com/anotherpage',
            title: 'Another Page',
            dom_snapshot_hash: 'new0002'
          },
          network_events: []
        }
      ]
    };
    const updatedGraph = buildGraph([t1, extraTrace]);

    const diff = diffGraphs(baseGraph, updatedGraph);

    expect(diff.added_states.length).toBeGreaterThan(0);
  });

  test('detects removed states when updated graph has fewer states', () => {
    const fullGraph = buildGraph([t1]);

    // Simulate a "removed" state by building from a subset
    const reducedTrace: WorkflowTrace = {
      ...t1,
      trace_id: 'reduced',
      actions: [t1.actions[0]!]  // only first action
    };
    const reducedGraph = buildGraph([reducedTrace]);

    const diff = diffGraphs(fullGraph, reducedGraph);

    expect(diff.removed_states.length).toBeGreaterThan(0);
  });

  test('detects confidence deltas when same transition has more recordings', () => {
    const baseGraph = buildGraph([t1]);
    const updatedGraph = buildGraph([t1, t2]);

    const diff = diffGraphs(baseGraph, updatedGraph);

    // Confidence should increase with more recordings
    expect(diff.confidence_changes.length).toBeGreaterThan(0);
    for (const change of diff.confidence_changes) {
      expect(change.delta).toBeGreaterThan(0);
      expect(change.to).toBeGreaterThan(change.from);
    }
  });

  test('no differences when comparing identical graphs', () => {
    const graph = buildGraph([t1]);
    const diff = diffGraphs(graph, graph);

    expect(diff.added_states).toHaveLength(0);
    expect(diff.removed_states).toHaveLength(0);
    expect(diff.added_transitions).toHaveLength(0);
    expect(diff.removed_transitions).toHaveLength(0);
    expect(diff.confidence_changes).toHaveLength(0);
  });

  test('added_transitions detected for new transitions in updated graph', () => {
    const baseGraph = buildGraph([t1]);

    const newTransTrace: WorkflowTrace = {
      ...t1,
      trace_id: 'new-trans',
      actions: [
        {
          seq: 1,
          timestamp: '2026-03-30T10:00:00.000Z',
          action_type: 'click',
          target: { selectors: [], visible_text: 'foo', tag: 'button', frame_path: ['main'], bounding_rect: null },
          input_value: null,
          state_before: { url: 'https://www31.pointclickcare.com/unique1', title: 'Unique 1', dom_snapshot_hash: 'uniq0001' },
          state_after: { url: 'https://www31.pointclickcare.com/unique2', title: 'Unique 2', dom_snapshot_hash: 'uniq0002' },
          network_events: []
        }
      ]
    };

    const updatedGraph = buildGraph([t1, newTransTrace]);
    const diff = diffGraphs(baseGraph, updatedGraph);

    expect(diff.added_transitions.length).toBeGreaterThan(0);
  });
});
