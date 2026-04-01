/**
 * Integration tests — B-007 Supervisor UI wired into WorkflowExecutor
 * Uses a mock SupervisorEmitter (no real WS server).
 */

jest.mock('fs', () => {
  const real = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...real,
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    appendFileSync: jest.fn()
  };
});

jest.mock('../../src/pdf-verifier/comparator.js', () => ({ comparePdfs: jest.fn() }));
jest.mock('../../src/pdf-verifier/reporter.js', () => ({ writeReport: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../src/rules-engine/engine.js', () => ({ RulesEngine: jest.fn() }));

import { WorkflowExecutor } from '../../src/runtime/executor.js';
import type { ExecutorContext, ExecutorPage } from '../../src/runtime/executor.js';
import type { StateMachineDefinition, WorkflowContext } from '../../src/types/index.js';
import type { StateGraph } from '../../src/state-mapper/graph-builder.js';
import type { SupervisorEmitter } from '../../src/supervisor/emitter.js';
import type { StatusUpdate, WorkflowComplete, HumanResponse } from '../../src/supervisor/types.js';

jest.setTimeout(15000);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockSupervisor(interventionResponse: HumanResponse['action'] = 'escalate'): {
  emitter: SupervisorEmitter;
  statusUpdates: StatusUpdate[];
  completeEvents: WorkflowComplete[];
  interventionCount: number;
} {
  const statusUpdates: StatusUpdate[] = [];
  const completeEvents: WorkflowComplete[] = [];
  let interventionCount = 0;

  const emitter: SupervisorEmitter = {
    emitStatusUpdate: (u) => { statusUpdates.push(u); },
    emitInterventionRequest: async (_req) => {
      interventionCount++;
      return { request_id: 'mock-req-id', action: interventionResponse };
    },
    emitWorkflowComplete: (r) => { completeEvents.push(r); },
    close: async () => {}
  };

  return { emitter, statusUpdates, completeEvents, get interventionCount() { return interventionCount; } };
}

const BASE_URL = 'https://app.example.com';

function makeMockPage(overrides: { gotoFails?: boolean } = {}): ExecutorPage {
  return {
    url: () => BASE_URL,
    title: async () => 'Test',
    goto: overrides.gotoFails
      ? jest.fn().mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED failed to navigate'))
      : jest.fn().mockResolvedValue(null),
    locator: jest.fn().mockReturnValue({
      click: jest.fn().mockResolvedValue(undefined),
      fill: jest.fn().mockResolvedValue(undefined),
      selectOption: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(1)
    }),
    keyboard: { press: jest.fn().mockResolvedValue(undefined) },
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
    evaluate: jest.fn().mockResolvedValue(undefined),
    pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4'))
  };
}

/** Build a multi-step graph with N click steps — all states share BASE_URL so verification passes */
function makeMultiStepGraph(steps: number): StateGraph {
  const states = new Map<string, { id: string; url_pattern: string; dom_signature: string; title: string; recordings_seen: number }>();
  const transitions = [];
  for (let i = 0; i <= steps; i++) {
    states.set(`s${i}`, { id: `s${i}`, url_pattern: BASE_URL, dom_signature: `sig${i}`, title: `Page${i}`, recordings_seen: 1 });
  }
  for (let i = 0; i < steps; i++) {
    transitions.push({
      id: `click_00${i}`,
      from: `s${i}`,
      to: `s${i + 1}`,
      event: 'CLICK',
      action_type: 'click' as const,
      selectors: [{ strategy: 'css' as const, selector: '#btn', resilience: 0.8, playwright_locator: '#btn' }],
      guard_conditions: [],
      confidence: 0.9,
      recordings_seen: 1
    });
  }
  return { states, transitions, totalTraces: 1 };
}

function makeSingleNavigateGraph(): StateGraph {
  return {
    states: new Map([
      ['s0', { id: 's0', url_pattern: BASE_URL, dom_signature: 'x', title: 'A', recordings_seen: 1 }],
      ['s1', { id: 's1', url_pattern: BASE_URL, dom_signature: 'y', title: 'B', recordings_seen: 1 }]
    ]),
    transitions: [{
      id: 'nav_001',
      from: 's0',
      to: 's1',
      event: 'NAVIGATE',
      action_type: 'navigate',
      selectors: [],
      guard_conditions: [],
      confidence: 0.85,
      recordings_seen: 1
    }],
    totalTraces: 1
  };
}

function makeCtx(
  page: ExecutorPage,
  graph: StateGraph,
  supervisor: SupervisorEmitter,
  opts: Partial<ExecutorContext['options']> = {}
): ExecutorContext {
  const machine: StateMachineDefinition = { id: 'sup_test', initial: '', context: {}, states: {} };
  const wfCtx: WorkflowContext = {
    patient_id: 'P001',
    pull_date: '2026-03-30',
    last_cu_date: '2026-01-01',
    collected_docs: []
  };
  return {
    page,
    machine,
    graph,
    options: {
      dryRun: true,
      maxRetries: 0,
      screenshotOnFailure: false,
      outputDir: '/tmp/wcrs-sup-test',
      supervisor,
      ...opts
    },
    workflowContext: wfCtx
  };
}

// ── TEST 1 — emitStatusUpdate called after each successful step ────────────

describe('Supervisor Integration — TEST 1: emitStatusUpdate after each step', () => {
  it('emits one status_update per non-escalated step', async () => {
    const { emitter, statusUpdates } = makeMockSupervisor();
    const graph = makeMultiStepGraph(3);
    const ctx = makeCtx(makeMockPage(), graph, emitter, { dryRun: true });

    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();

    expect(statusUpdates.length).toBeGreaterThan(0);
    expect(statusUpdates[0]!.step_number).toBe(1);
    expect(typeof statusUpdates[0]!.action_type).toBe('string');
    expect(report.total_steps).toBeGreaterThan(0);
  });
});

// ── TEST 2 — Intervention → RETRY resumes execution ───────────────────────

describe('Supervisor Integration — TEST 2: Intervention RETRY resumes execution', () => {
  it('executor does not escalate when supervisor responds with retry then step succeeds', async () => {
    const { emitter } = makeMockSupervisor('retry');

    let gotoCalls = 0;
    const page = makeMockPage();
    (page.goto as jest.Mock).mockImplementation(() => {
      gotoCalls++;
      if (gotoCalls === 1) throw new Error('net::ERR_CONNECTION_REFUSED failed to navigate');
      return Promise.resolve(null);
    });

    const graph = makeSingleNavigateGraph();
    const ctx = makeCtx(page, graph, emitter, { dryRun: false, maxRetries: 0 });

    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();

    // After retry the goto succeeds → step should not be escalated
    expect(report.status).not.toBe('escalated');
  });
});

// ── TEST 3 — Intervention → SKIP marks step as skipped ────────────────────

describe('Supervisor Integration — TEST 3: Intervention SKIP marks step skipped', () => {
  it('step is marked skipped when supervisor responds with skip', async () => {
    const { emitter } = makeMockSupervisor('skip');
    const page = makeMockPage({ gotoFails: true });
    const graph = makeSingleNavigateGraph();
    const ctx = makeCtx(page, graph, emitter, { dryRun: false, maxRetries: 0 });

    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();

    const navStep = report.step_results.find(s => s.action_type === 'navigate');
    expect(navStep).toBeDefined();
    expect(navStep!.status).toBe('skipped');
    expect(report.status).not.toBe('escalated');
  });
});

// ── TEST 4 — Intervention → ESCALATE marks report escalated ───────────────

describe('Supervisor Integration — TEST 4: Intervention ESCALATE escalates report', () => {
  it('report.status is escalated when supervisor responds with escalate', async () => {
    const { emitter } = makeMockSupervisor('escalate');
    const page = makeMockPage({ gotoFails: true });
    const graph = makeSingleNavigateGraph();
    const ctx = makeCtx(page, graph, emitter, { dryRun: false, maxRetries: 0 });

    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();

    expect(report.status).toBe('escalated');
  });
});

// ── TEST 5 — emitWorkflowComplete called at end of run ────────────────────

describe('Supervisor Integration — TEST 5: emitWorkflowComplete at end of run', () => {
  it('emits workflow_complete with correct run_id', async () => {
    const { emitter, completeEvents } = makeMockSupervisor();
    const graph = makeMultiStepGraph(2);
    const ctx = makeCtx(makeMockPage(), graph, emitter, { dryRun: true });

    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();

    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0]!.run_id).toBe(report.run_id);
    expect(typeof completeEvents[0]!.total_time_ms).toBe('number');
  });
});
