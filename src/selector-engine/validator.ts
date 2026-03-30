/**
 * WCRS Selector Validator (Module 3 — Selector Resilience Engine)
 * Validates selector candidates against a live Playwright page.
 * Used during replay execution to confirm selectors still work,
 * and to update the execution history for the ranker.
 */

import type { SelectorCandidate } from '../types/index.js';
import type { Page } from 'playwright';
import { recordSuccess, recordFailure, type ExecutionHistory } from './ranker.js';

export interface ValidationResult {
  selector: string;
  strategy: string;
  found: boolean;
  count: number;         // number of matching elements
  visible: boolean;      // is the first match visible?
  error?: string;
}

export interface SelectorValidationReport {
  element_id: string;
  validated_at: string;
  results: ValidationResult[];
  best_selector: SelectorCandidate | null;
}

/**
 * Validate all candidates for an element against a live Playwright page.
 * Returns the best working selector and updates execution history.
 *
 * @param candidates - Ordered selector candidates to try
 * @param page - Live Playwright page instance
 * @param elementId - Human-readable identifier for logging
 * @param history - Mutable execution history (updated in place)
 * @returns Validation report
 */
export async function validateCandidates(
  candidates: SelectorCandidate[],
  page: Page,
  elementId: string,
  history?: ExecutionHistory
): Promise<SelectorValidationReport> {
  const results: ValidationResult[] = [];
  let bestSelector: SelectorCandidate | null = null;

  for (const candidate of candidates) {
    const result = await validateSingle(candidate, page);
    results.push(result);

    if (history) {
      if (result.found && result.count === 1) {
        recordSuccess(candidate.selector, candidate.strategy, history);
      } else if (!result.found) {
        recordFailure(candidate.selector, candidate.strategy, history);
      }
    }

    // First candidate that resolves to exactly 1 visible element wins
    if (!bestSelector && result.found && result.count === 1 && result.visible) {
      bestSelector = candidate;
    }
  }

  // Fallback: first that found anything
  if (!bestSelector) {
    const firstFound = results.find(r => r.found && r.count > 0);
    if (firstFound) {
      bestSelector = candidates.find(c => c.selector === firstFound.selector) || null;
    }
  }

  return {
    element_id: elementId,
    validated_at: new Date().toISOString(),
    results,
    best_selector: bestSelector
  };
}

/**
 * Validate a single selector candidate.
 *
 * @param candidate - Selector to validate
 * @param page - Playwright page
 * @returns ValidationResult
 */
async function validateSingle(
  candidate: SelectorCandidate,
  page: Page
): Promise<ValidationResult> {
  try {
    const locator = page.locator(candidate.selector);
    const count = await locator.count();

    if (count === 0) {
      return { selector: candidate.selector, strategy: candidate.strategy, found: false, count: 0, visible: false };
    }

    const visible = await locator.first().isVisible({ timeout: 500 }).catch(() => false);

    return {
      selector: candidate.selector,
      strategy: candidate.strategy,
      found: true,
      count,
      visible
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      selector: candidate.selector,
      strategy: candidate.strategy,
      found: false,
      count: 0,
      visible: false,
      error: message
    };
  }
}

/**
 * Try selectors in ranked order until one resolves.
 * Returns the first selector that finds exactly 1 visible element.
 *
 * @param candidates - Ranked candidates
 * @param page - Playwright page
 * @param timeout - Max wait per candidate in ms (default 2000)
 * @returns The working candidate or null
 */
export async function findWorkingSelector(
  candidates: SelectorCandidate[],
  page: Page,
  timeout = 2000
): Promise<SelectorCandidate | null> {
  for (const candidate of candidates) {
    try {
      const locator = page.locator(candidate.selector);
      await locator.first().waitFor({ state: 'visible', timeout });
      const count = await locator.count();
      if (count >= 1) return candidate;
    } catch (_) {
      // Try next candidate
    }
  }
  return null;
}
