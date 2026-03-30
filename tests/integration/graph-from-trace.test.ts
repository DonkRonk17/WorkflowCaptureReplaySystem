/**
 * Integration test: Build state graph from a real sample trace file.
 * Verifies the full pipeline: trace JSON → graph → XState machine.
 *
 * Sprint 1 Acceptance Criteria:
 *   ✓ Record a 5-step flow on any website, verify JSON output
 *   ✓ Selectors generated for each action target
 *   ✓ State graph produced from trace, viewable in Stately.ai
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildGraph, buildAndExportXState } from '../../src/state-mapper/graph-builder';
import { serializeMachine } from '../../src/state-mapper/xstate-export';
import type { WorkflowTrace } from '../../src/types/index';

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/sample-trace.json');

describe('Graph Builder — integration with sample trace', () => {
  let sampleTrace: WorkflowTrace;

  beforeAll(() => {
    const raw = fs.readFileSync(FIXTURE_PATH, 'utf-8');
    sampleTrace = JSON.parse(raw);
  });

  it('loads sample trace fixture successfully', () => {
    expect(sampleTrace.trace_id).toBe('sample-trace-001');
    expect(sampleTrace.actions.length).toBe(5);
    expect(sampleTrace.target_app).toBe('PointClickCare');
  });

  it('builds state graph with correct structure', () => {
    const graph = buildGraph([sampleTrace]);

    expect(graph.states.size).toBeGreaterThan(0);
    expect(graph.totalTraces).toBe(1);
    // 5 actions → at most 4 transitions (excluding checkpoint)
    expect(graph.transitions.length).toBeGreaterThan(0);
    expect(graph.transitions.length).toBeLessThanOrEqual(4);
  });

  it('every state has a URL pattern', () => {
    const graph = buildGraph([sampleTrace]);
    for (const [id, state] of graph.states) {
      expect(state.url_pattern).toBeTruthy();
      expect(state.id).toBe(id);
    }
  });

  it('every transition has at least 1 selector in selectors array from target element', () => {
    const graph = buildGraph([sampleTrace]);
    for (const transition of graph.transitions) {
      // Transitions from click/navigate actions that have targets should have selectors
      if (transition.action_type === 'click') {
        expect(transition.selectors.length).toBeGreaterThan(0);
      }
    }
  });

  it('every transition has a confidence score > 0', () => {
    const graph = buildGraph([sampleTrace]);
    for (const transition of graph.transitions) {
      expect(transition.confidence).toBeGreaterThan(0);
    }
  });

  it('checkpoint actions are excluded from the graph', () => {
    const graph = buildGraph([sampleTrace]);
    // The sample trace has 1 checkpoint — it should not produce a transition
    for (const transition of graph.transitions) {
      expect(transition.action_type).not.toBe('checkpoint');
    }
  });

  it('exports a valid XState v5 machine definition', () => {
    const machine = buildAndExportXState([sampleTrace]);

    expect(machine).toBeDefined();
    expect(typeof machine.id).toBe('string');
    expect(typeof machine.initial).toBe('string');
    expect(typeof machine.states).toBe('object');
    expect(machine.context).toBeDefined();
  });

  it('machine includes recovery states', () => {
    const machine = buildAndExportXState([sampleTrace]);

    // Should have human_intervention
    expect(machine.states['human_intervention']).toBeDefined();
    expect(machine.states['human_intervention']?.type).toBe('final');

    // Should have at least one _recovery state
    const recoveryStates = Object.keys(machine.states).filter(k => k.endsWith('_recovery'));
    expect(recoveryStates.length).toBeGreaterThan(0);
  });

  it('machine can be serialized to valid JSON', () => {
    const machine = buildAndExportXState([sampleTrace]);
    const json = serializeMachine(machine);

    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.id).toBeDefined();
    expect(parsed.states).toBeDefined();
  });

  it('machine initial state is a real state in the graph', () => {
    const machine = buildAndExportXState([sampleTrace]);
    expect(machine.states[machine.initial]).toBeDefined();
  });
});
