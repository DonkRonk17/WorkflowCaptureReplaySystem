/**
 * Integration tests — Sprint 4 Pipeline
 * Tests all four hooks wired into WorkflowExecutor.
 * All Playwright interactions, fs, https, RulesEngine, and PDF verifier are mocked.
 */

// Hoist the mock so it applies before any imports resolve fs
jest.mock('fs', () => {
  const realFs = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...realFs,
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn().mockReturnValue(undefined),
    writeFileSync: jest.fn().mockReturnValue(undefined),
    appendFileSync: jest.fn().mockReturnValue(undefined)
  };
});

jest.mock('https', () => ({
  request: jest.fn()
}));

jest.mock('../../src/pdf-verifier/comparator.js', () => ({
  comparePdfs: jest.fn()
}));

jest.mock('../../src/pdf-verifier/reporter.js', () => ({
  writeReport: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../src/rules-engine/engine.js', () => ({
  RulesEngine: jest.fn()
}));

import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import { buildGraph } from '../../src/state-mapper/graph-builder.js';
import { WorkflowExecutor } from '../../src/runtime/executor.js';
import type { ExecutorContext, ExecutorPage } from '../../src/runtime/executor.js';
import type { WorkflowTrace, TraceTransition, StateMachineDefinition, WorkflowContext } from '../../src/types/index.js';
import type { StateGraph } from '../../src/state-mapper/graph-builder.js';
import { comparePdfs } from '../../src/pdf-verifier/comparator.js';
import { RulesEngine } from '../../src/rules-engine/engine.js';
import type { FidelityReport } from '../../src/pdf-verifier/comparator.js';

jest.setTimeout(30000);

const SAMPLE_TRACE_PATH = path.join(__dirname, '../fixtures/sample-trace.json');
const sampleTrace: WorkflowTrace = JSON.parse(
  (jest.requireActual<typeof import('fs')>('fs')).readFileSync(SAMPLE_TRACE_PATH, 'utf-8')
);

const MockRulesEngine = RulesEngine as jest.MockedClass<typeof RulesEngine>;
const mockComparePdfs = comparePdfs as jest.MockedFunction<typeof comparePdfs>;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockPage(overrides: Partial<{
  pdfThrows: boolean;
  gotoFails: boolean;
  url?: string;
}> = {}): ExecutorPage {
  return {
    url: () => overrides.url ?? 'https://app.example.com',
    title: async () => 'A',
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
    pdf: overrides.pdfThrows
      ? jest.fn().mockRejectedValue(new Error('PDF not available in headed mode'))
      : jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4'))
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

function makeSingleTransitionGraph(
  action_type: TraceTransition['action_type'],
  gotoFails = false
): StateGraph {
  return {
    states: new Map([
      ['s0', { id: 's0', url_pattern: 'https://app.example.com', dom_signature: 'x', title: 'A', recordings_seen: 1 }],
      ['s1', { id: 's1', url_pattern: 'https://app.example.com', dom_signature: 'y', title: 'B', recordings_seen: 1 }]
    ]),
    transitions: [{
      id: `step_001_${action_type}`,
      from: 's0',
      to: 's1',
      event: 'ACTION',
      action_type,
      selectors: [],
      guard_conditions: [],
      confidence: 0.9,
      recordings_seen: 1
    }],
    totalTraces: 1
  };
}

function makeCtx(
  page: ExecutorPage,
  graph: StateGraph,
  opts: Partial<ExecutorContext['options']> = {}
): ExecutorContext {
  const machine: StateMachineDefinition = {
    id: 'sprint4_test_workflow',
    initial: '',
    context: {},
    states: {}
  };
  return {
    page,
    machine,
    graph,
    options: {
      dryRun: opts.dryRun ?? true,
      maxRetries: opts.maxRetries ?? 0,
      screenshotOnFailure: false,
      outputDir: '/tmp/wcrs-sprint4-test',
      ...opts
    },
    workflowContext: makeWorkflowContext()
  };
}

function makePassingFidelityReport(): FidelityReport {
  return {
    comparison_id: 'cmp-pass-001',
    generated_pdf: '/tmp/print-001.pdf',
    reference_pdf: '/tmp/baseline-001.pdf',
    result: 'PASS',
    overall_similarity: 1.0,
    checks: {
      page_count_match: true,
      orientation_match: true,
      text_content_similarity: 1.0,
      visual_similarity: null,
      margins_within_tolerance: null
    },
    discrepancies: [],
    is_two_up_layout: false,
    generated_at: '2026-03-30T00:00:00.000Z'
  };
}

// ── TEST 1 — Full pipeline dryRun with PDF check SKIPPED (page.pdf throws) ──

describe('Sprint 4 Integration — TEST 1: dryRun with PDF check SKIPPED', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockReturnValue(true);
    (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mockReturnValue(undefined);
  });

  it('StepResult has pdf_check.checked=false when page.pdf throws on print step', async () => {
    const page = makeMockPage({ pdfThrows: true });
    const graph = makeSingleTransitionGraph('print');
    const ctx = makeCtx(page, graph, {
      dryRun: false,
      pdfCheck: { outputDir: '/tmp/wcrs-sprint4-test', pullDate: '2026-03-30', patientId: 'P001' }
    });

    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();

    expect(report).toBeDefined();
    const printStep = report.step_results.find(s => s.action_type === 'print');
    expect(printStep).toBeDefined();
    expect(printStep!.pdf_check).toBeDefined();
    expect(printStep!.pdf_check!.checked).toBe(false);
    expect(printStep!.pdf_check!.fidelity_status).toBe('SKIPPED');
  });
});

// ── TEST 2 — Rules violations detected mid-run ────────────────────────────

describe('Sprint 4 Integration — TEST 2: Rules violations detected', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockReturnValue(true);
    (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mockReturnValue(undefined);

    MockRulesEngine.mockImplementation(() => ({
      evaluate: jest.fn(),
      evaluatePacket: jest.fn().mockReturnValue({
        packet_id: 'pkt-001',
        evaluated_at: '2026-03-30T00:00:00.000Z',
        all_passed: false,
        results: [],
        failed_rules: [
          { doc_filename: 'FC_bad.pdf', rule_id: 'NAMING_PULL_DATE', message: 'NAMING_PULL_DATE: filename wrong' }
        ],
        warnings: []
      }),
      getRuleById: jest.fn(),
      getRulesByType: jest.fn(),
      getRulesByDocType: jest.fn(),
      getSummary: jest.fn()
    } as unknown as InstanceType<typeof RulesEngine>));
  });

  it('StepResult has rules_check.passed=false and violations.length > 0 on download step', async () => {
    const page = makeMockPage();
    const graph = makeSingleTransitionGraph('download');
    const ctx = makeCtx(page, graph, {
      dryRun: false,
      rulesCheck: { enabled: true, rulesPath: '/fake/cu-rules.yaml' }
    });

    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();

    const downloadStep = report.step_results.find(s => s.action_type === 'download');
    expect(downloadStep).toBeDefined();
    expect(downloadStep!.rules_check).toBeDefined();
    expect(downloadStep!.rules_check!.passed).toBe(false);
    expect(downloadStep!.rules_check!.violations.length).toBeGreaterThan(0);
  });
});

// ── TEST 3 — Escalation triggers file handoff notification ────────────────

describe('Sprint 4 Integration — TEST 3: Escalation triggers file handoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockReturnValue(true);
    (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mockReturnValue(undefined);
  });

  it('HANDOFF-*.json is written when report status is escalated', async () => {
    const page = makeMockPage({ gotoFails: true });
    const graph = makeSingleTransitionGraph('navigate', true);
    const ctx = makeCtx(page, graph, {
      dryRun: false,
      maxRetries: 0,
      handoff: { channel: 'file', outputDir: '/tmp/wcrs-sprint4-test' }
    });

    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();

    expect(report.status).toBe('escalated');

    const writeFileSyncCalls = (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mock.calls;
    const handoffWrite = writeFileSyncCalls.find(c => String(c[0]).includes('HANDOFF-'));
    expect(handoffWrite).toBeDefined();
  });
});

// ── TEST 4 — Packet validation runs at completion ─────────────────────────

describe('Sprint 4 Integration — TEST 4: Packet validation at completion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockReturnValue(true);
    (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mockReturnValue(undefined);
  });

  it('ExecutionReport.packet_validation is defined after run', async () => {
    const page = makeMockPage();
    const graph = buildGraph([sampleTrace]);
    const ctx = makeCtx(page, graph, { dryRun: true });

    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();

    expect(report.packet_validation).toBeDefined();
    expect(typeof report.packet_validation!.valid).toBe('boolean');
    expect(typeof report.packet_validation!.doc_count).toBe('number');
    expect(Array.isArray(report.packet_validation!.errors)).toBe(true);
    expect(Array.isArray(report.packet_validation!.packet_order)).toBe(true);
  });
});

// ── TEST 5 — End-to-end over sample-trace in dryRun ──────────────────────

describe('Sprint 4 Integration — TEST 5: End-to-end dryRun over sample-trace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockReturnValue(true);
    (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mockReturnValue(undefined);

    MockRulesEngine.mockImplementation(() => ({
      evaluate: jest.fn(),
      evaluatePacket: jest.fn().mockReturnValue({
        packet_id: 'pkt-e2e',
        evaluated_at: '2026-03-30T00:00:00.000Z',
        all_passed: true,
        results: [],
        failed_rules: [],
        warnings: []
      }),
      getRuleById: jest.fn(),
      getRulesByType: jest.fn(),
      getRulesByDocType: jest.fn(),
      getSummary: jest.fn()
    } as unknown as InstanceType<typeof RulesEngine>));

    mockComparePdfs.mockResolvedValue(makePassingFidelityReport());
  });

  it('all 4 hooks wired and no exceptions thrown', async () => {
    const page = makeMockPage();
    const graph = buildGraph([sampleTrace]);
    const ctx = makeCtx(page, graph, {
      dryRun: true,
      pdfCheck: { outputDir: '/tmp/wcrs-sprint4-test', pullDate: '2026-03-30', patientId: 'P001' },
      rulesCheck: { enabled: true, rulesPath: '/fake/cu-rules.yaml' },
      handoff: { channel: 'file', outputDir: '/tmp/wcrs-sprint4-test' }
    });

    const executor = new WorkflowExecutor(ctx);
    const report = await executor.run();

    // Should complete without exceptions
    expect(report).toBeDefined();
    expect(report.total_steps).toBeGreaterThan(0);
    // packet_validation always runs
    expect(report.packet_validation).toBeDefined();
  });
});
