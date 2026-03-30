/**
 * WCRS Selector Strategy: Test ID
 * High-resilience strategy based on data-test / data-testid / data-qa / data-cy attributes.
 * These are developer-placed and highly stable across UI refactors.
 * Playwright equivalent: page.getByTestId('order-summary-btn')
 */

import type { SelectorCandidate } from '../../types/index.js';

/** Test ID attributes searched in priority order */
export const TEST_ID_ATTRIBUTES = ['data-test', 'data-testid', 'data-qa', 'data-cy', 'data-automation-id', 'data-e2e'];

export interface TestIdInfo {
  attributes: Record<string, string | null>;  // attr name -> value
}

/**
 * Generate test ID selector candidates.
 *
 * @param info - Attribute values for known test ID attributes
 * @returns Array of SelectorCandidate
 */
export function generateTestIdSelectors(info: TestIdInfo): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = [];

  for (const attr of TEST_ID_ATTRIBUTES) {
    const value = info.attributes[attr];
    if (!value) continue;

    candidates.push({
      strategy: 'testId',
      selector: `[${attr}="${escapeCss(value)}"]`,
      resilience: 0.90,
      playwright_locator: attr === 'data-testid'
        ? `page.getByTestId('${escapeJs(value)}')`
        : `page.locator('[${attr}="${escapeJs(value)}"]')`
    });
    // Only use the first (highest-priority) test ID attribute found
    break;
  }

  return candidates;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeCss(value: string): string {
  return value.replace(/"/g, '\\"');
}

function escapeJs(value: string): string {
  return value.replace(/'/g, "\\'");
}
