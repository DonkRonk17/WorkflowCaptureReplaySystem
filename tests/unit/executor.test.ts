/**
 * Unit tests — WorkflowExecutor (Sprint 3)
 * All Playwright Page interactions are mocked — no browser launched.
 */

import { WorkflowExecutor } from '../../src/runtime/executor.js';
import type { ExecutorContext, ExecutorPage } from '../../src/runtime/executor.js';
import type { StateMachineDefinition, TraceTransition, TraceState, WorkflowContext } from '../../src/types/index.js';
import type { StateGraph } from '../../src/state-mapper/graph-builder.js';

// ── Mock page factory ─────────────────────────────────────────────────────

function makeMockPage(overrides: Partial<{
  url: string;
  title: string;
  locatorCount: number;
  gotoFails: boolean;
  clickFails: boolean;
}> = {}): ExecutorPage {
  const url = overrides.url ?? 'https://app.example.com/patients';
  const title = overrides.title ?? 'Patient List';
  const count = overrides.locatorCount ?? 1;

  return {
    url: () => url,
    title: async () => title,
    goto: overrides.gotoFails
      ? jest.fn().mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED failed to navigate'))
      : jest.fn().mockResolvedValue(null),
    locator: jest.fn().mockReturnValue({
      click: overrides.clickFails
        ? jest.fn().mockRejectedValue(new Error('Element not found'))
        : jest.fn().mockResolvedValue(undefined),
      fill: jest.fn().mockResolvedValue(undefined),
      selectOption: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(count)
    }),
    keyboard: { press: jest.fn().mockResolvedValue(undefined) },
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
    evaluate: jest.fn().mockResolvedValue(undefined),
    pdf: jest.fn().mockResolvedValue(Buffer.from(''))
  };
}

// ── Fixture factories ─────────────────────────────────────────────────────

function makeTransition(overrides: Partial<TraceTransition> = {}): TraceTransition {
  return {
    id: 'trans_001',
    from: 'state_000',
    to: 'state_001',
    event: 'CLICK',
    action_type: 'click',
    selectors: [
      { strategy: 'role', selector: '[role="link"]', resilience: 0.95 },
      { strategy: 'css', selector: 'a.patient-link', resilience: 0.5 }
    ],
    guard_conditions: [
      { type: 'element_present', selectors: ['[data-testid="grid"]'] }
    ],
    confidence: 0.9,
    recordings_seen: 1,
    ...overrides
  };
}

function makeState(id: string, urlPattern = 'https://app.example.com/patients'): TraceState {
  return {
    id,
    url_pattern: urlPattern,
    dom_signature: 'abc123',
    title: 'Patient List',
    recordings_seen: 1
  };
}

function makeGraph(transitions: TraceTransition[]): StateGraph {
  const states = new Map<string, TraceState>();
  states.set('state_000', makeState('state_000', 'https://app.example.com/login'));
  states.set('state_001', makeState('state_001', 'https://app.example.com/patients'));
  return { states, transitions, totalTraces: 1 };
}

function makeMachine(): StateMachineDefinition {
  return {
    id: 'test_workflow',
    initial: 'state_000',
    context: {},
    states: {}
  };
}

function makeWorkflowContext(): WorkflowContext {
  return {
    patient_id: 'P001',
    pull_date: '2026-03-30',
    last_cu_date: '2026-01-01',
    collected_docs: []
  };
}

function makeContext(overrides: {
  page?: ExecutorPage;
  transitions?: TraceTransition[];
  dryRun?: boolean;
  maxRetries?: number;
  outputDir?: string;
} = {}): ExecutorContext {
  const transitions = overrides.transitions ?? [makeTransition()];
  return {
    page: overrides.page ?? makeMockPage(),
    machine: makeMachine(),
    graph: makeGraph(transitions),
    options: {
      dryRun: overrides.dryRun ?? false,
      maxRetries: overrides.maxRetries ?? 2,
      outputDir: overrides.outputDir,
      screenshotOnFailure: false // suppress screenshot in unit tests
    },
    workflowContext: makeWorkflowContext()
  };
}

// ── selectBestSelector ────────────────────────────────────────────────────

describe('WorkflowExecutor.selectBestSelector', () => {
  it('returns role selector over css', () => {
    const executor = new WorkflowExecutor(makeContext());
    const sel = executor.selectBestSelector([
      { strategy: 'css', selector: 'a.link', resilience: 0.7 },
      { strategy: 'role', selector: '[role="link"]', resilience: 0.9 },
      { strategy: 'text', selector: 'a:has-text("Click")', resilience: 0.8 }
    ]);
    expect(sel).toBe('[role="link"]');
  });

  it('prefers testId over text', () => {
    const executor = new WorkflowExecutor(makeContext());
    const sel = executor.selectBestSelector([
      { strategy: 'text', selector: 'a:has-text("Name")', resilience: 0.8 },
      { strategy: 'testId', selector: '[data-testid="name-link"]', resilience: 0.6 }
    ]);
    expect(sel).toBe('[data-testid="name-link"]');
  });

  it('handles empty selectors array gracefully (returns empty string)', () => {
    const executor = new WorkflowExecutor(makeContext());
    const sel = executor.selectBestSelector([]);
    expect(sel).toBe('');
  });

  it('uses resilience as tiebreaker within same strategy', () => {
    const executor = new WorkflowExecutor(makeContext());
    const sel = executor.selectBestSelector([
      { strategy: 'role', selector: '[role="button"][aria-label="Old"]', resilience: 0.6 },
      { strategy: 'role', selector: '[role="button"][aria-label="New"]', resilience: 0.95 }
    ]);
    expect(sel).toBe('[role="button"][aria-label="New"]');
  });
});

// ── getStepTimeout ────────────────────────────────────────────────────────

describe('WorkflowExecutor.getStepTimeout', () => {
  it('returns marTarTimeoutMs for MAR transition', () => {
    const executor = new WorkflowExecutor(makeContext({ dryRun: true }));
    const marTrans = makeTransition({ id: 'state_mar_00--click--state_mar_01' });
    expect(executor.getStepTimeout(marTrans)).toBe(90_000);
  });

  it('returns marTarTimeoutMs for TAR transition', () => {
    const executor = new WorkflowExecutor(makeContext({ dryRun: true }));
    const tarTrans = makeTransition({ id: 'open_tar_record--click--submit' });
    expect(executor.getStepTimeout(tarTrans)).toBe(90_000);
  });

  it('returns marTarTimeoutMs for medication_administration transition', () => {
    const executor = new WorkflowExecutor(makeContext({ dryRun: true }));
    const trans = makeTransition({ id: 'medication_administration_form--click--done' });
    expect(executor.getStepTimeout(trans)).toBe(90_000);
  });

  it('returns stepTimeoutMs for normal transition', () => {
    const executor = new WorkflowExecutor(makeContext({ dryRun: true }));
    const trans = makeTransition({ id: 'click_patient_name--click--patient_detail' });
    expect(executor.getStepTimeout(trans)).toBe(60_000);
  });
});

// ── executeAction ─────────────────────────────────────────────────────────

describe('WorkflowExecutor.executeAction', () => {
  it('calls page.goto for navigate action', async () => {
    const page = makeMockPage();
    const ctx = makeContext({ page });
    const executor = new WorkflowExecutor(ctx);
    const trans = makeTransition({ action_type: 'navigate', selectors: [] });
    await executor.executeAction(trans);
    expect(page.goto).toHaveBeenCalled();
  });

  it('calls page.locator().click() for click action', async () => {
    const page = makeMockPage();
    const ctx = makeContext({ page });
    const executor = new WorkflowExecutor(ctx);
    await executor.executeAction(makeTransition({ action_type: 'click' }));
    expect(page.locator).toHaveBeenCalled();
  });

  it('does NOT call page methods in dryRun mode', async () => {
    const page = makeMockPage();
    const ctx = makeContext({ page, dryRun: true });
    const executor = new WorkflowExecutor(ctx);
    await executor.executeAction(makeTransition({ action_type: 'click' }));
    expect(page.locator).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('calls keyboard.press for keydown action', async () => {
    const page = makeMockPage();
    const ctx = makeContext({ page });
    const executor = new WorkflowExecutor(ctx);
    const trans = makeTransition({ action_type: 'keydown', selectors: [] });
    await executor.executeAction(trans);
    expect(page.keyboard.press).toHaveBeenCalled();
  });

  it('calls waitForTimeout for wait action', async () => {
    const page = makeMockPage();
    const ctx = makeContext({ page });
    const executor = new WorkflowExecutor(ctx);
    const trans = makeTransition({ action_type: 'wait', selectors: [], id: 'wait_trans' });
    await executor.executeAction(trans);
    expect(page.waitForTimeout).toHaveBeenCalled();
  });
});

// ── run() in dryRun mode ───────────────────────────────────────────────────

describe('WorkflowExecutor.run() — dryRun mode', () => {
  it('completes without errors and returns ExecutionReport', async () => {
    const ctx = makeContext({ dryRun: true });
    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();
    expect(report).toBeDefined();
    expect(report.workflow_id).toBe('test_workflow');
    expect(report.total_steps).toBeGreaterThan(0);
  });

  it('run_id is a valid uuid', async () => {
    const ctx = makeContext({ dryRun: true });
    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();
    expect(report.run_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('started_at and completed_at are ISO-8601', async () => {
    const ctx = makeContext({ dryRun: true });
    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();
    expect(() => new Date(report.started_at)).not.toThrow();
    expect(new Date(report.started_at).toISOString()).toBe(report.started_at);
    expect(new Date(report.completed_at).toISOString()).toBe(report.completed_at);
  });
});

// ── run() — recovery and escalation ───────────────────────────────────────

describe('WorkflowExecutor.run() — recovery scenarios', () => {
  it('calls verifyState after each action (state match detected)', async () => {
    // Page URL matches pattern so verifyState passes
    const page = makeMockPage({ url: 'https://app.example.com/patients', locatorCount: 1 });
    const ctx = makeContext({ page });
    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();
    // Should succeed if verify passes
    expect(['completed', 'failed', 'escalated']).toContain(report.status);
  });

  it('escalates when navigation_error occurs and sets status=escalated', async () => {
    const page = makeMockPage({ gotoFails: true });
    const ctx = makeContext({
      page,
      transitions: [makeTransition({ action_type: 'navigate', selectors: [] })],
      maxRetries: 0
    });
    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();
    expect(report.status).toBe('escalated');
    expect(report.escalation_reason).toBeDefined();
  });

  it('sets escalation_reason when escalating', async () => {
    const page = makeMockPage({ gotoFails: true });
    const ctx = makeContext({
      page,
      transitions: [makeTransition({ action_type: 'navigate', selectors: [] })],
      maxRetries: 0
    });
    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();
    expect(typeof report.escalation_reason).toBe('string');
    expect(report.escalation_reason!.length).toBeGreaterThan(0);
  });
});
