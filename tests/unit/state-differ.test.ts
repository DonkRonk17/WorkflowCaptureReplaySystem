/**
 * Unit tests: State Differ
 */

import { diffTraces, diffGraphs } from '../../src/state-mapper/state-differ';
import type { WorkflowTrace, SelectorCandidate } from '../../src/types/index';
import type { StateGraph } from '../../src/state-mapper/graph-builder';

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeTrace(
  id: string,
  steps: Array<{ fromUrl: string; toUrl: string; action?: string }>,
  overrides: Partial<WorkflowTrace> = {}
): WorkflowTrace {
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
    })),
    ...overrides
  };
}

function makeStateGraph(
  stateIds: string[],
  transitions: Array<{ from: string; to: string; confidence: number; recordings_seen?: number }>
): StateGraph {
  const states = new Map(stateIds.map(id => [id, {
    id,
    url_pattern: `https://app.example.com/${id}`,
    dom_signature: 'aabbccdd',
    title: id,
    recordings_seen: 1
  }]));

  return {
    states,
    transitions: transitions.map(t => ({
      id: `${t.from}--click--${t.to}`,
      from: t.from,
      to: t.to,
      event: 'CLICK',
      action_type: 'click' as const,
      selectors: [],
      guard_conditions: [],
      confidence: t.confidence,
      recordings_seen: t.recordings_seen ?? 1
    })),
    totalTraces: 1
  };
}

// ── diffTraces: malformed trace skipping ──────────────────────────────────

describe('diffTraces — malformed trace handling', () => {
  it('skips a trace with missing trace_id', () => {
    const bad = makeTrace('', [
      { fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/a' }
    ], { trace_id: '' });
    const good = makeTrace('t1', [
      { fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/a' }
    ]);

    const result = diffTraces([bad, good]);
    expect(result.skippedTraces).toHaveLength(1);
    expect(result.skippedTraces[0]!.reason).toMatch(/trace_id/);
    expect(result.mergeStats.validTraces).toBe(1);
    expect(result.mergeStats.skippedTraces).toBe(1);
  });

  it('skips a trace with a non-array actions field', () => {
    const bad = makeTrace('bad1', [], { actions: 'not-an-array' as any });

    const result = diffTraces([bad]);
    expect(result.skippedTraces).toHaveLength(1);
    expect(result.skippedTraces[0]!.traceId).toBe('bad1');
    expect(result.skippedTraces[0]!.reason).toMatch(/actions/);
  });

  it('skips a trace with an empty actions array', () => {
    const bad = makeTrace('empty1', []);

    const result = diffTraces([bad]);
    expect(result.skippedTraces).toHaveLength(1);
    expect(result.skippedTraces[0]!.reason).toMatch(/empty/);
  });

  it('uses "unknown" as traceId in skip record when trace_id is absent', () => {
    const bad = { actions: [] } as any;

    const result = diffTraces([bad]);
    expect(result.skippedTraces[0]!.traceId).toBe('unknown');
  });

  it('returns an empty graph when all traces are skipped', () => {
    const result = diffTraces([makeTrace('', [])]);
    expect(result.graph.states.size).toBe(0);
    expect(result.graph.transitions).toHaveLength(0);
  });
});

// ── diffTraces: core merging ───────────────────────────────────────────────

describe('diffTraces — core merging', () => {
  it('merges two valid traces with the same transition', () => {
    const t1 = makeTrace('t1', [{ fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/a' }]);
    const t2 = makeTrace('t2', [{ fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/a' }]);

    const result = diffTraces([t1, t2]);
    expect(result.mergeStats.validTraces).toBe(2);
    expect(result.graph.transitions).toHaveLength(1);
    expect(result.graph.transitions[0]!.recordings_seen).toBe(2);
  });

  it('produces two separate transitions for diverging paths', () => {
    const t1 = makeTrace('t1', [{ fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/path-a' }]);
    const t2 = makeTrace('t2', [{ fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/path-b' }]);

    const result = diffTraces([t1, t2]);
    expect(result.graph.transitions).toHaveLength(2);
    expect(result.mergeStats.divergingPaths).toBeGreaterThan(0);
  });

  it('counts diverging paths correctly', () => {
    const t1 = makeTrace('t1', [{ fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/path-a' }]);
    const t2 = makeTrace('t2', [{ fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/path-b' }]);
    const t3 = makeTrace('t3', [{ fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/path-c' }]);

    const result = diffTraces([t1, t2, t3]);
    // 3 destinations from same origin → 3 diverging path edges
    expect(result.mergeStats.divergingPaths).toBe(3);
  });

  it('filters transitions below minConfidence', () => {
    const t1 = makeTrace('t1', [{ fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/a' }]);
    const t2 = makeTrace('t2', [{ fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/a' }]);
    const t3 = makeTrace('t3', [{ fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/a' }]);

    // With 3 traces, a transition seen in 3/3 should pass any reasonable threshold
    const resultLow = diffTraces([t1, t2, t3], { minConfidence: 0.0 });
    expect(resultLow.graph.transitions).toHaveLength(1);

    const resultHigh = diffTraces([t1, t2, t3], { minConfidence: 0.99 });
    expect(resultHigh.graph.transitions).toHaveLength(0);
  });
});

// ── diffTraces: confidence calculation ────────────────────────────────────

describe('diffTraces — confidence calculation', () => {
  it('confidence reflects number of distinct traces, not occurrences within a trace', () => {
    // Build a single trace that loops back (same transition twice)
    const loopyTrace: WorkflowTrace = {
      trace_id: 'loop1',
      wcrs_version: '1.0.0',
      recorded_at: new Date().toISOString(),
      stopped_at: new Date().toISOString(),
      target_app: 'test',
      action_count: 2,
      errors: [],
      actions: [
        {
          seq: 1,
          timestamp: new Date().toISOString(),
          action_type: 'click',
          target: { selectors: [], visible_text: 'btn', tag: 'button', frame_path: ['main'], bounding_rect: null },
          input_value: null,
          state_before: { url: 'https://app.example.com/home', title: 'Home', dom_snapshot_hash: 'aabbccdd' },
          state_after:  { url: 'https://app.example.com/next', title: 'Next', dom_snapshot_hash: 'eeff0011' },
          network_events: []
        },
        {
          seq: 2,
          timestamp: new Date().toISOString(),
          action_type: 'click',
          target: { selectors: [], visible_text: 'btn', tag: 'button', frame_path: ['main'], bounding_rect: null },
          input_value: null,
          state_before: { url: 'https://app.example.com/home', title: 'Home', dom_snapshot_hash: 'aabbccdd' },
          state_after:  { url: 'https://app.example.com/next', title: 'Next', dom_snapshot_hash: 'eeff0011' },
          network_events: []
        }
      ]
    };

    // Two distinct traces both containing the same transition
    const normalTrace = makeTrace('normal1', [
      { fromUrl: 'https://app.example.com/home', toUrl: 'https://app.example.com/next' }
    ]);

    const resultLoopy  = diffTraces([loopyTrace], { minConfidence: 0 });
    const resultNormal = diffTraces([loopyTrace, normalTrace], { minConfidence: 0 });

    // recordings_seen for the loopy single-trace result should be 1 (not 2)
    expect(resultLoopy.graph.transitions[0]!.recordings_seen).toBe(1);

    // Two distinct traces → recordings_seen = 2, confidence higher
    expect(resultNormal.graph.transitions[0]!.recordings_seen).toBe(2);
    expect(resultNormal.graph.transitions[0]!.confidence)
      .toBeGreaterThan(resultLoopy.graph.transitions[0]!.confidence);
  });

  it('confidence is capped at 1.0 even when all traces contain transition', () => {
    const traces = [
      makeTrace('t1', [{ fromUrl: 'https://app.example.com/a', toUrl: 'https://app.example.com/b' }]),
      makeTrace('t2', [{ fromUrl: 'https://app.example.com/a', toUrl: 'https://app.example.com/b' }]),
      makeTrace('t3', [{ fromUrl: 'https://app.example.com/a', toUrl: 'https://app.example.com/b' }])
    ];
    const result = diffTraces(traces, { minConfidence: 0 });
    for (const t of result.graph.transitions) {
      expect(t.confidence).toBeLessThanOrEqual(1.0);
    }
  });
});

// ── diffTraces: selector merging ──────────────────────────────────────────

describe('diffTraces — selector merging', () => {
  function makeTraceWithSelectors(id: string, selectors: SelectorCandidate[]): WorkflowTrace {
    return {
      trace_id: id,
      wcrs_version: '1.0.0',
      recorded_at: new Date().toISOString(),
      stopped_at: new Date().toISOString(),
      target_app: 'test',
      action_count: 1,
      errors: [],
      actions: [{
        seq: 1,
        timestamp: new Date().toISOString(),
        action_type: 'click',
        target: {
          selectors,
          visible_text: 'btn',
          tag: 'button',
          frame_path: ['main'],
          bounding_rect: null
        },
        input_value: null,
        state_before: { url: 'https://app.example.com/home', title: 'Home', dom_snapshot_hash: 'aabb' },
        state_after:  { url: 'https://app.example.com/next', title: 'Next', dom_snapshot_hash: 'ccdd' },
        network_events: []
      }]
    };
  }

  it('deduplicates selectors with the same string across traces', () => {
    const sel: SelectorCandidate = { strategy: 'role', selector: '[role="button"]', resilience: 0.95 };
    const t1 = makeTraceWithSelectors('t1', [sel]);
    const t2 = makeTraceWithSelectors('t2', [sel]);

    const result = diffTraces([t1, t2], { minConfidence: 0 });
    const merged = result.graph.transitions[0]!.selectors;
    const dupes = merged.filter(s => s.selector === '[role="button"]');
    expect(dupes).toHaveLength(1);
  });

  it('keeps the highest-resilience selector per strategy', () => {
    const t1 = makeTraceWithSelectors('t1', [
      { strategy: 'attribute', selector: '#old-id', resilience: 0.50 }
    ]);
    const t2 = makeTraceWithSelectors('t2', [
      { strategy: 'attribute', selector: '#better-id', resilience: 0.75 }
    ]);

    const result = diffTraces([t1, t2], { minConfidence: 0 });
    const merged = result.graph.transitions[0]!.selectors;
    const attrSel = merged.find(s => s.strategy === 'attribute');
    expect(attrSel).toBeDefined();
    expect(attrSel!.selector).toBe('#better-id');
    expect(attrSel!.resilience).toBe(0.75);
  });

  it('caps merged selectors at 5', () => {
    const makeSelectors = (prefix: string): SelectorCandidate[] => [
      { strategy: 'role',      selector: `[role="${prefix}1"]`,  resilience: 0.95 },
      { strategy: 'testId',    selector: `[data-test="${prefix}2"]`, resilience: 0.90 },
      { strategy: 'text',      selector: `button:has-text("${prefix}3")`, resilience: 0.80 },
      { strategy: 'attribute', selector: `#${prefix}4`, resilience: 0.70 },
      { strategy: 'css',       selector: `.${prefix}5`, resilience: 0.30 }
    ];

    const t1 = makeTraceWithSelectors('t1', makeSelectors('a'));
    const t2 = makeTraceWithSelectors('t2', makeSelectors('b'));

    const result = diffTraces([t1, t2], { minConfidence: 0 });
    const merged = result.graph.transitions[0]!.selectors;
    expect(merged.length).toBeLessThanOrEqual(5);
  });
});

// ── diffGraphs ────────────────────────────────────────────────────────────

describe('diffGraphs', () => {
  it('reports added states', () => {
    const base    = makeStateGraph(['a', 'b'], []);
    const updated = makeStateGraph(['a', 'b', 'c'], []);

    const diff = diffGraphs(base, updated);
    expect(diff.addedStates).toContain('c');
    expect(diff.removedStates).toHaveLength(0);
  });

  it('reports removed states', () => {
    const base    = makeStateGraph(['a', 'b', 'c'], []);
    const updated = makeStateGraph(['a', 'b'], []);

    const diff = diffGraphs(base, updated);
    expect(diff.removedStates).toContain('c');
    expect(diff.addedStates).toHaveLength(0);
  });

  it('reports added transitions', () => {
    const base    = makeStateGraph(['a', 'b'], [{ from: 'a', to: 'b', confidence: 0.5 }]);
    const updated = makeStateGraph(['a', 'b', 'c'], [
      { from: 'a', to: 'b', confidence: 0.5 },
      { from: 'b', to: 'c', confidence: 0.8 }
    ]);

    const diff = diffGraphs(base, updated);
    expect(diff.addedTransitions).toHaveLength(1);
    expect(diff.addedTransitions[0]).toContain('b--click--c');
  });

  it('reports removed transitions', () => {
    const base    = makeStateGraph(['a', 'b'], [
      { from: 'a', to: 'b', confidence: 0.5 },
      { from: 'b', to: 'a', confidence: 0.3 }
    ]);
    const updated = makeStateGraph(['a', 'b'], [{ from: 'a', to: 'b', confidence: 0.5 }]);

    const diff = diffGraphs(base, updated);
    expect(diff.removedTransitions).toHaveLength(1);
  });

  it('reports confidence changes above threshold', () => {
    const base    = makeStateGraph(['a', 'b'], [{ from: 'a', to: 'b', confidence: 0.30 }]);
    const updated = makeStateGraph(['a', 'b'], [{ from: 'a', to: 'b', confidence: 0.80 }]);

    const diff = diffGraphs(base, updated);
    expect(diff.confidenceChanges).toHaveLength(1);
    expect(diff.confidenceChanges[0]!.before).toBeCloseTo(0.30);
    expect(diff.confidenceChanges[0]!.after).toBeCloseTo(0.80);
    expect(diff.confidenceChanges[0]!.delta).toBeGreaterThan(0);
  });

  it('does not report confidence change below the 0.05 threshold', () => {
    const base    = makeStateGraph(['a', 'b'], [{ from: 'a', to: 'b', confidence: 0.50 }]);
    const updated = makeStateGraph(['a', 'b'], [{ from: 'a', to: 'b', confidence: 0.53 }]);

    const diff = diffGraphs(base, updated);
    expect(diff.confidenceChanges).toHaveLength(0);
  });

  it('returns empty arrays when graphs are identical', () => {
    const g = makeStateGraph(['a', 'b'], [{ from: 'a', to: 'b', confidence: 0.7 }]);

    const diff = diffGraphs(g, g);
    expect(diff.addedStates).toHaveLength(0);
    expect(diff.removedStates).toHaveLength(0);
    expect(diff.addedTransitions).toHaveLength(0);
    expect(diff.removedTransitions).toHaveLength(0);
    expect(diff.confidenceChanges).toHaveLength(0);
  });
});
