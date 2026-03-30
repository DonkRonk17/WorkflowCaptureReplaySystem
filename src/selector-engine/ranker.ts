/**
 * WCRS Selector Ranker (Module 3 — Selector Resilience Engine)
 * Re-ranks selector candidates based on observed execution success rates.
 * As the system accumulates replay data, selectors that consistently work
 * get promoted; those that fail get demoted.
 *
 * Bible spec: "Selector Resilience Engine — produce ranked lists ordered
 * by expected durability."
 */

import type { SelectorCandidate, SelectorStrategy } from '../types/index.js';

/** Execution record for a selector across replays */
export interface SelectorExecutionRecord {
  selector: string;
  strategy: SelectorStrategy;
  successes: number;
  failures: number;
  last_seen: string;    // ISO-8601
}

/** In-memory execution history (can be persisted to JSON) */
export type ExecutionHistory = Map<string, SelectorExecutionRecord>;

/**
 * Calculate a combined resilience score using both static analysis
 * and observed execution success rate.
 *
 * Formula: score = staticWeight * (0.4) + successRate * (0.6)
 * where successRate = successes / (successes + failures)
 *
 * @param candidate - The selector candidate
 * @param history - Optional observed execution history
 * @returns Adjusted resilience score 0.0 – 1.0
 */
export function adjustedResilience(
  candidate: SelectorCandidate,
  history?: ExecutionHistory
): number {
  const staticScore = candidate.resilience;

  if (!history) return staticScore;

  const record = history.get(candidate.selector);
  if (!record || (record.successes + record.failures) === 0) {
    return staticScore;
  }

  const total = record.successes + record.failures;
  const successRate = record.successes / total;

  // Blend: static analysis carries 40%, observed data carries 60%
  // (trust data more once we have meaningful sample size)
  const dataWeight = Math.min(1.0, total / 10) * 0.6;  // ramp up with sample size
  const staticWeight = 1.0 - dataWeight;

  return (staticScore * staticWeight) + (successRate * dataWeight);
}

/**
 * Re-rank a list of selector candidates using execution history.
 *
 * @param candidates - Original candidates (from generator)
 * @param history - Observed execution history
 * @returns Re-ranked candidates with updated resilience scores
 */
export function rerankCandidates(
  candidates: SelectorCandidate[],
  history?: ExecutionHistory
): SelectorCandidate[] {
  const reranked = candidates.map(c => ({
    ...c,
    resilience: adjustedResilience(c, history)
  }));

  return reranked.sort((a, b) => b.resilience - a.resilience);
}

/**
 * Record a successful selector execution.
 *
 * @param selector - The selector string that worked
 * @param strategy - The strategy type
 * @param history - Mutable execution history map
 */
export function recordSuccess(
  selector: string,
  strategy: SelectorStrategy,
  history: ExecutionHistory
): void {
  const existing = history.get(selector);
  if (existing) {
    existing.successes++;
    existing.last_seen = new Date().toISOString();
  } else {
    history.set(selector, {
      selector,
      strategy,
      successes: 1,
      failures: 0,
      last_seen: new Date().toISOString()
    });
  }
}

/**
 * Record a failed selector execution.
 *
 * @param selector - The selector string that failed
 * @param strategy - The strategy type
 * @param history - Mutable execution history map
 */
export function recordFailure(
  selector: string,
  strategy: SelectorStrategy,
  history: ExecutionHistory
): void {
  const existing = history.get(selector);
  if (existing) {
    existing.failures++;
    existing.last_seen = new Date().toISOString();
  } else {
    history.set(selector, {
      selector,
      strategy,
      successes: 0,
      failures: 1,
      last_seen: new Date().toISOString()
    });
  }
}

/**
 * Serialize execution history to a plain object for JSON persistence.
 */
export function serializeHistory(history: ExecutionHistory): Record<string, SelectorExecutionRecord> {
  const out: Record<string, SelectorExecutionRecord> = {};
  for (const [key, value] of history) {
    out[key] = value;
  }
  return out;
}

/**
 * Deserialize execution history from a plain object.
 */
export function deserializeHistory(data: Record<string, SelectorExecutionRecord>): ExecutionHistory {
  const history: ExecutionHistory = new Map();
  for (const [key, value] of Object.entries(data)) {
    history.set(key, value);
  }
  return history;
}

/**
 * Get the best-performing selector for an element based on history.
 * Returns null if no history exists.
 *
 * @param candidates - Available candidates
 * @param history - Execution history
 * @returns Best candidate or null
 */
export function getBestSelector(
  candidates: SelectorCandidate[],
  history: ExecutionHistory
): SelectorCandidate | null {
  if (candidates.length === 0) return null;
  const reranked = rerankCandidates(candidates, history);
  return reranked[0] ?? null;
}
