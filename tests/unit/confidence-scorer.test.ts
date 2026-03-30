/**
 * Unit tests: Confidence Scorer
 */

import { calculateConfidence, confidenceLabel, scoreAllTransitions } from '../../src/state-mapper/confidence-scorer';
import type { TraceTransition } from '../../src/types/index';

describe('calculateConfidence', () => {
  it('returns 0 for 0 traces', () => {
    expect(calculateConfidence(0, 0)).toBe(0);
    expect(calculateConfidence(1, 0)).toBe(0);
  });

  it('returns near 1.0 when seen in all traces', () => {
    const score = calculateConfidence(5, 5);
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('returns lower score when seen in 1 of 5 traces', () => {
    const score = calculateConfidence(1, 5);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.5);
  });

  it('returns higher score when seen in 3 of 5 traces', () => {
    const score3 = calculateConfidence(3, 5);
    const score1 = calculateConfidence(1, 5);
    expect(score3).toBeGreaterThan(score1);
  });

  it('monotonically increases with recordings_seen', () => {
    const scores = [1, 2, 3, 4, 5].map(n => calculateConfidence(n, 5));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]!);
    }
  });
});

describe('confidenceLabel', () => {
  it('labels correctly', () => {
    expect(confidenceLabel(0.95)).toBe('VERY_HIGH');
    expect(confidenceLabel(0.75)).toBe('HIGH');
    expect(confidenceLabel(0.55)).toBe('MEDIUM');
    expect(confidenceLabel(0.35)).toBe('LOW');
    expect(confidenceLabel(0.10)).toBe('VERY_LOW');
  });
});

describe('scoreAllTransitions', () => {
  function makeTransition(id: string, seen: number): TraceTransition {
    return {
      id,
      from: 'a',
      to: 'b',
      event: 'CLICK',
      action_type: 'click',
      selectors: [],
      guard_conditions: [],
      confidence: 0,
      recordings_seen: seen
    };
  }

  it('updates confidence in-place', () => {
    const transitions = [makeTransition('t1', 3), makeTransition('t2', 1)];
    const summary = scoreAllTransitions(transitions, 5);
    expect(transitions[0]!.confidence).toBeGreaterThan(0);
    expect(transitions[1]!.confidence).toBeGreaterThan(0);
    expect(transitions[0]!.confidence).toBeGreaterThan(transitions[1]!.confidence);
    expect(summary.total_transitions).toBe(2);
  });
});
