/**
 * Unit tests: Graph Builder
 */

import { buildGraph, buildAndExportXState } from '../../src/state-mapper/graph-builder';
import type { WorkflowTrace } from '../../src/types/index';

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeTrace(id: string, steps: Array<{ fromUrl: string; toUrl: string; action?: string }>): WorkflowTrace {
  return {
    trace_id: id,
    wcrs_version: '1.0.0',
    recorded_at: new Date().toISOString(),
    stopped_at: new Date().toISOString(),
    target_app: 'test_app',
    action_count: steps.length,
    errors: [],
    actions: steps.map((step, i) => ({
      seq: i + 1,
      timestamp: new Date().toISOString(),
      action_type: (step.action as any) ?? 'click',
      target: {
        selectors: [{ strategy: 'role', selector: '[role="button"]', resilience: 0.95 }],
        visible_text: `Button ${i + 1}`,
        tag: 'button',
        frame_path: ['main'],
        bounding_rect: null
      },
      input_value: null,
      state_before: {
        url: step.fromUrl,
        title: `Page at ${step.fromUrl}`,
        dom_snapshot_hash: 'aabbccdd'
      },
      state_after: {
        url: step.toUrl,
        title: `Page at ${step.toUrl}`,
        dom_snapshot_hash: 'eeff0011'
      },
      network_events: []
    }))
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('buildGraph', () => {
  it('creates states from trace actions', () => {
    const trace = makeTrace('t1', [
      { fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/patients' },
      { fromUrl: 'https://app.example.com/patients', toUrl: 'https://app.example.com/profile' }
    ]);

    const graph = buildGraph([trace]);

    expect(graph.states.size).toBeGreaterThan(0);
    expect(graph.transitions.length).toBeGreaterThan(0);
    expect(graph.totalTraces).toBe(1);
  });

  it('each transition has confidence score > 0', () => {
    const trace = makeTrace('t1', [
      { fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/patients' }
    ]);

    const graph = buildGraph([trace]);
    for (const t of graph.transitions) {
      expect(t.confidence).toBeGreaterThan(0);
    }
  });

  it('merges duplicate transitions from multiple traces', () => {
    const trace1 = makeTrace('t1', [
      { fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/patients' }
    ]);
    const trace2 = makeTrace('t2', [
      { fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/patients' }
    ]);

    const graph = buildGraph([trace1, trace2]);
    const transitions = graph.transitions;

    // Should have 1 merged transition with recordings_seen = 2
    expect(transitions.length).toBe(1);
    expect(transitions[0]!.recordings_seen).toBe(2);
    expect(transitions[0]!.confidence).toBeGreaterThan(calculateSingleConfidence(2));
  });

  it('builds diverging transitions when traces differ', () => {
    const trace1 = makeTrace('t1', [
      { fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/path-a' }
    ]);
    const trace2 = makeTrace('t2', [
      { fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/path-b' }
    ]);

    const graph = buildGraph([trace1, trace2]);
    expect(graph.transitions.length).toBe(2);
  });

  it('filters transitions below min confidence', () => {
    const trace = makeTrace('t1', [
      { fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/patients' }
    ]);

    const graphHigh = buildGraph([trace], { minConfidence: 0.99 });
    expect(graphHigh.transitions.length).toBe(0);

    const graphLow = buildGraph([trace], { minConfidence: 0.0 });
    expect(graphLow.transitions.length).toBe(1);
  });

  it('skips checkpoint-type actions', () => {
    const trace = makeTrace('t1', []);
    trace.actions = [
      {
        seq: 1,
        timestamp: new Date().toISOString(),
        action_type: 'checkpoint',
        annotation: 'test checkpoint',
        target: null,
        input_value: null,
        state_before: { url: 'https://app.example.com', title: '' },
        state_after: { url: 'https://app.example.com', title: '' },
        network_events: []
      }
    ];

    const graph = buildGraph([trace]);
    expect(graph.transitions.length).toBe(0);
  });
});

describe('buildAndExportXState', () => {
  it('produces valid XState machine definition', () => {
    const trace = makeTrace('t1', [
      { fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/patients' }
    ]);

    const machine = buildAndExportXState([trace]);

    expect(machine.id).toBeDefined();
    expect(machine.initial).toBeDefined();
    expect(typeof machine.states).toBe('object');
    expect(Object.keys(machine.states).length).toBeGreaterThan(0);
  });

  it('includes human_intervention state from recovery injection', () => {
    const trace = makeTrace('t1', [
      { fromUrl: 'https://app.example.com/a', toUrl: 'https://app.example.com/b' }
    ]);

    const machine = buildAndExportXState([trace]);
    expect(machine.states['human_intervention']).toBeDefined();
    expect(machine.states['human_intervention']!.type).toBe('final');
  });

  it('includes context with CU workflow fields', () => {
    const trace = makeTrace('t1', [
      { fromUrl: 'https://app.example.com/a', toUrl: 'https://app.example.com/b' }
    ]);

    const machine = buildAndExportXState([trace]);
    expect(machine.context).toBeDefined();
    expect(machine.context).toHaveProperty('patient_id');
    expect(machine.context).toHaveProperty('last_cu_date');
    expect(machine.context).toHaveProperty('collected_docs');
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function calculateSingleConfidence(seen: number): number {
  return (seen + 0.5) / (seen + 1 + 1);
}
