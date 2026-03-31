/**
 * WCRS State Verifier (Sprint 3 — Module 7)
 * Verifies that the live browser state matches the expected recorded state.
 *
 * Bible spec:
 *   "After each action, assert the expected post-condition state."
 *   "Compare URL pattern, DOM signature, and key element presence."
 *
 * NOTE: Playwright's Page is accepted as a parameter (not imported at module
 * level) so unit tests can mock it as a plain JS object with jest.fn() methods.
 */

import type { TraceState, TraceTransition } from '../types/index.js';

// ── Public interfaces ──────────────────────────────────────────────────────

export interface StateVerificationResult {
  passed: boolean;
  expected_state_id: string;
  actual_url: string;
  actual_title: string;
  checks: {
    url_match: boolean;
    title_match: boolean;         // fuzzy: actual contains key words from expected
    dom_elements_present: boolean; // at least one guard selector resolves
  };
  confidence: number;             // 0.0–1.0 weighted average of checks
  failure_reason?: string;
}

/** Minimal subset of Playwright's Page that the verifier needs. */
export interface VerifierPage {
  url(): string;
  title(): Promise<string>;
  locator(selector: string): { count(): Promise<number> };
}

export interface VerifyOptions {
  timeout?: number; // unused by verifier itself but kept for future use
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Check whether the live browser state matches the expected recorded state.
 *
 * Confidence formula: url_match*0.5 + title_match*0.2 + dom_match*0.3
 * Passed = confidence >= 0.5 (at minimum the URL must match).
 */
export async function verifyState(
  page: VerifierPage,
  expectedState: TraceState,
  expectedTransition: TraceTransition,
  options?: VerifyOptions
): Promise<StateVerificationResult> {
  let actual_url = '';
  let actual_title = '';
  let url_match = false;
  let title_match = false;
  let dom_elements_present = false;

  try {
    actual_url = page.url();
    actual_title = await page.title();

    // ── URL check ────────────────────────────────────────────────────────
    url_match = checkUrlMatch(actual_url, expectedState.url_pattern);

    // ── Title check (fuzzy) ──────────────────────────────────────────────
    title_match = checkTitleMatch(actual_title, expectedState.title);

    // ── DOM check ────────────────────────────────────────────────────────
    dom_elements_present = await checkDomElements(page, expectedTransition);

  } catch (err) {
    const failure_reason = err instanceof Error ? err.message : String(err);
    return {
      passed: false,
      expected_state_id: expectedState.id,
      actual_url,
      actual_title,
      checks: { url_match: false, title_match: false, dom_elements_present: false },
      confidence: 0,
      failure_reason
    };
  }

  const confidence = computeConfidence(url_match, title_match, dom_elements_present);
  const passed = url_match && confidence >= 0.5;

  const result: StateVerificationResult = {
    passed,
    expected_state_id: expectedState.id,
    actual_url,
    actual_title,
    checks: { url_match, title_match, dom_elements_present },
    confidence
  };

  if (!passed) {
    const failedChecks: string[] = [];
    if (!url_match) failedChecks.push(`url (expected pattern: ${expectedState.url_pattern}, got: ${actual_url})`);
    if (!title_match) failedChecks.push(`title (expected: ${expectedState.title}, got: ${actual_title})`);
    if (!dom_elements_present) failedChecks.push('dom elements not found');
    result.failure_reason = `State verification failed: ${failedChecks.join('; ')}`;
  }

  return result;
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Normalize a URL by stripping the fragment and trailing slash.
 * Falls back to the raw string if parsing fails.
 */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    let normalized = `${u.origin}${u.pathname}${u.search}`;
    if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized;
  } catch (_) {
    return url.split('#')[0]?.replace(/\/$/, '') ?? url;
  }
}

function checkUrlMatch(actualUrl: string, expectedPattern: string): boolean {
  if (!expectedPattern) return false;
  const normActual = normalizeUrl(actualUrl);
  const normExpected = normalizeUrl(expectedPattern);
  // Exact match first, then "actual contains expected" fallback (pattern may be partial)
  return normActual === normExpected || normActual.includes(normExpected);
}

/**
 * Fuzzy title check: split expected title on ' - ', check if actual title
 * contains at least one of the parts (PCC titles vary by patient).
 */
function checkTitleMatch(actualTitle: string, expectedTitle: string): boolean {
  if (!expectedTitle) return true; // nothing to check
  const parts = expectedTitle.split(' - ').map(p => p.trim()).filter(Boolean);
  const lowerActual = actualTitle.toLowerCase();
  return parts.some(part => lowerActual.includes(part.toLowerCase()));
}

/**
 * Check if at least one guard selector from the transition resolves to >0 elements.
 * Aggregates selectors from all 'element_present' guard conditions.
 * Never throws — returns false on any error.
 */
async function checkDomElements(
  page: VerifierPage,
  transition: TraceTransition
): Promise<boolean> {
  // Collect all 'element_present' guard selectors
  const selectors: string[] = [];
  for (const guard of transition.guard_conditions) {
    if (guard.type === 'element_present' && guard.selectors) {
      selectors.push(...guard.selectors);
    }
  }

  // Fall back to the transition's own selectors if no guard selectors
  if (selectors.length === 0) {
    for (const cand of transition.selectors) {
      selectors.push(cand.selector);
    }
  }

  if (selectors.length === 0) return false;

  for (const selector of selectors) {
    try {
      const count = await page.locator(selector).count();
      if (count > 0) return true;
    } catch (_) {
      // selector may be invalid — try next
    }
  }

  return false;
}

function computeConfidence(urlMatch: boolean, titleMatch: boolean, domMatch: boolean): number {
  return (urlMatch ? 0.5 : 0) + (titleMatch ? 0.2 : 0) + (domMatch ? 0.3 : 0);
}
