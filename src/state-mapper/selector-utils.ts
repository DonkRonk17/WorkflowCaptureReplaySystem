/**
 * WCRS Selector Utilities (Module 2 — UI State Mapper)
 * Shared selector-merging logic used by graph-builder and state-differ.
 */

import type { SelectorCandidate } from '../types/index.js';

/**
 * Merge incoming selectors into an existing list (mutates `existing`).
 * - Deduplicates by exact selector string
 * - Keeps the highest-resilience candidate per strategy
 * - Sorts descending by resilience
 * - Caps the list at 5 total candidates
 */
export function mergeSelectors(
  existing: SelectorCandidate[],
  incoming: SelectorCandidate[]
): void {
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
