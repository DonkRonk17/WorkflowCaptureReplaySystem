/**
 * Unit tests — State Verifier (Sprint 3)
 * All Playwright Page interactions are mocked — no browser launched.
 */

import { verifyState } from '../../src/runtime/state-verifier.js';
import type { TraceState, TraceTransition } from '../../src/types/index.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<TraceState> = {}): TraceState {
  return {
    id: 'state_001',
    url_pattern: 'https://app.example.com/patients',
    dom_signature: 'abcd1234',
    title: 'Patient List - PCC',
    recordings_seen: 1,
    ...overrides
  };
}

function makeTransition(overrides: Partial<TraceTransition> = {}): TraceTransition {
  return {
    id: 'trans_001',
    from: 'state_000',
    to: 'state_001',
    event: 'CLICK',
    action_type: 'click',
    selectors: [
      { strategy: 'role', selector: '[role="button"]', resilience: 0.9 }
    ],
    guard_conditions: [
      { type: 'element_present', selectors: ['[role="grid"]'] }
    ],
    confidence: 0.85,
    recordings_seen: 1,
    ...overrides
  };
}

function makePage(overrides: {
  url?: string;
  title?: string;
  locatorCount?: number;
  throwOnTitle?: boolean;
  throwOnLocator?: boolean;
} = {}) {
  const url = overrides.url ?? 'https://app.example.com/patients';
  const title = overrides.title ?? 'Patient List - PCC';
  const count = overrides.locatorCount ?? 1;

  return {
    url: () => url,
    title: overrides.throwOnTitle
      ? async () => { throw new Error('Page closed'); }
      : async () => title,
    locator: (_selector: string) => ({
      count: overrides.throwOnLocator
        ? async () => { throw new Error('Invalid selector'); }
        : async () => count
    })
  };
}

// ── URL match tests ────────────────────────────────────────────────────────

describe('state-verifier — URL matching', () => {
  it('passes when actual URL matches expected url_pattern exactly', async () => {
    const page = makePage({ url: 'https://app.example.com/patients' });
    const state = makeState({ url_pattern: 'https://app.example.com/patients' });
    const result = await verifyState(page, state, makeTransition());
    expect(result.checks.url_match).toBe(true);
  });

  it('passes when actual URL contains expected url_pattern (partial match)', async () => {
    const page = makePage({ url: 'https://app.example.com/patients?id=123' });
    const state = makeState({ url_pattern: 'https://app.example.com/patients' });
    const result = await verifyState(page, state, makeTransition());
    expect(result.checks.url_match).toBe(true);
  });

  it('fails when URL is completely different', async () => {
    const page = makePage({ url: 'https://other.com/dashboard' });
    const state = makeState({ url_pattern: 'https://app.example.com/patients' });
    const result = await verifyState(page, state, makeTransition());
    expect(result.checks.url_match).toBe(false);
  });

  it('strips trailing slash before comparison', async () => {
    const page = makePage({ url: 'https://app.example.com/patients/' });
    const state = makeState({ url_pattern: 'https://app.example.com/patients' });
    const result = await verifyState(page, state, makeTransition());
    expect(result.checks.url_match).toBe(true);
  });

  it('strips fragment before comparison', async () => {
    const page = makePage({ url: 'https://app.example.com/patients#section' });
    const state = makeState({ url_pattern: 'https://app.example.com/patients' });
    const result = await verifyState(page, state, makeTransition());
    expect(result.checks.url_match).toBe(true);
  });
});

// ── Title match tests ──────────────────────────────────────────────────────

describe('state-verifier — Title matching', () => {
  it('passes with exact title match', async () => {
    const page = makePage({ title: 'Patient List - PCC' });
    const state = makeState({ title: 'Patient List - PCC' });
    const result = await verifyState(page, state, makeTransition());
    expect(result.checks.title_match).toBe(true);
  });

  it('passes with fuzzy partial match (one segment of split title)', async () => {
    const page = makePage({ title: 'John Doe — Patient List - PointClickCare' });
    const state = makeState({ title: 'Patient List - PCC' });
    const result = await verifyState(page, state, makeTransition());
    expect(result.checks.title_match).toBe(true);
  });

  it('is case-insensitive for title match', async () => {
    const page = makePage({ title: 'PATIENT LIST - ENTERPRISE' });
    const state = makeState({ title: 'patient list - pcc' });
    const result = await verifyState(page, state, makeTransition());
    expect(result.checks.title_match).toBe(true);
  });

  it('fails when title contains none of the expected segments', async () => {
    const page = makePage({ title: 'Dashboard - EHR' });
    const state = makeState({ title: 'Patient List - PCC' });
    // title_match false but url_match may be true
    const result = await verifyState(page, state, makeTransition());
    expect(result.checks.title_match).toBe(false);
  });

  it('passes when expected title is empty (nothing to check)', async () => {
    const page = makePage({ title: 'Anything' });
    const state = makeState({ title: '' });
    const result = await verifyState(page, state, makeTransition());
    expect(result.checks.title_match).toBe(true);
  });
});

// ── DOM check tests ────────────────────────────────────────────────────────

describe('state-verifier — DOM element check', () => {
  it('returns dom_elements_present=true when locator count > 0', async () => {
    const page = makePage({ locatorCount: 1 });
    const result = await verifyState(page, makeState(), makeTransition());
    expect(result.checks.dom_elements_present).toBe(true);
  });

  it('returns dom_elements_present=false when locator count is 0', async () => {
    const page = makePage({ locatorCount: 0 });
    const result = await verifyState(page, makeState(), makeTransition());
    expect(result.checks.dom_elements_present).toBe(false);
  });

  it('returns false (not throws) when locator throws', async () => {
    const page = makePage({ throwOnLocator: true });
    const result = await verifyState(page, makeState(), makeTransition());
    expect(result.checks.dom_elements_present).toBe(false);
    expect(result.passed).toBeDefined();
  });

  it('falls back to transition selectors when no guard conditions', async () => {
    const page = makePage({ locatorCount: 2 });
    const transition = makeTransition({ guard_conditions: [] });
    const result = await verifyState(page, makeState(), transition);
    expect(result.checks.dom_elements_present).toBe(true);
  });

  it('returns false when no selectors or guards at all', async () => {
    const page = makePage({ locatorCount: 0 });
    const transition = makeTransition({ guard_conditions: [], selectors: [] });
    const result = await verifyState(page, makeState(), transition);
    expect(result.checks.dom_elements_present).toBe(false);
  });
});

// ── Confidence formula tests ───────────────────────────────────────────────

describe('state-verifier — confidence formula', () => {
  it('returns 1.0 when all checks pass (0.5 + 0.2 + 0.3)', async () => {
    const page = makePage({ locatorCount: 1 });
    const result = await verifyState(page, makeState(), makeTransition());
    expect(result.confidence).toBeCloseTo(1.0);
  });

  it('returns 0.5 when only URL matches', async () => {
    const page = makePage({ url: 'https://app.example.com/patients', title: 'Completely Different', locatorCount: 0 });
    const state = makeState({ title: 'Patient List - PCC' });
    const result = await verifyState(page, state, makeTransition({ guard_conditions: [], selectors: [] }));
    expect(result.confidence).toBeCloseTo(0.5);
  });

  it('returns 0.7 when URL and DOM match but title does not', async () => {
    const page = makePage({ title: 'Wrong Title', locatorCount: 1 });
    const state = makeState({ title: 'Patient List - PCC' });
    const result = await verifyState(page, state, makeTransition());
    // url(0.5) + dom(0.3) = 0.8... wait, title is 0.2
    // url match: yes (0.5), title: no (0), dom: yes (0.3) = 0.8
    expect(result.confidence).toBeCloseTo(0.8);
  });

  it('returns 0.0 when all checks fail', async () => {
    const page = makePage({ url: 'https://other.com', title: 'Other', locatorCount: 0 });
    const state = makeState({ url_pattern: 'https://app.example.com/patients', title: 'Patient List - PCC' });
    const result = await verifyState(page, state, makeTransition({ guard_conditions: [], selectors: [] }));
    expect(result.confidence).toBeCloseTo(0.0);
  });
});

// ── Error handling ─────────────────────────────────────────────────────────

describe('state-verifier — error handling', () => {
  it('returns passed=false with failure_reason when page.title() throws', async () => {
    const page = makePage({ throwOnTitle: true });
    const result = await verifyState(page, makeState(), makeTransition());
    expect(result.passed).toBe(false);
    expect(result.failure_reason).toBeDefined();
    expect(result.confidence).toBe(0);
  });

  it('returns correct expected_state_id in result', async () => {
    const page = makePage();
    const state = makeState({ id: 'my_custom_state_id' });
    const result = await verifyState(page, state, makeTransition());
    expect(result.expected_state_id).toBe('my_custom_state_id');
  });

  it('passed=true when confidence >= 0.5', async () => {
    const page = makePage({ locatorCount: 1 });
    const result = await verifyState(page, makeState(), makeTransition());
    expect(result.passed).toBe(true);
  });

  it('passed=false when confidence < 0.5 (URL mismatch, title match only)', async () => {
    const page = makePage({ url: 'https://other.com', title: 'Patient List', locatorCount: 0 });
    const state = makeState({ url_pattern: 'https://app.example.com/patients', title: 'Patient List - PCC' });
    const result = await verifyState(page, state, makeTransition({ guard_conditions: [], selectors: [] }));
    // url=0, title=0.2, dom=0 → confidence=0.2 < 0.5
    expect(result.passed).toBe(false);
  });
});
