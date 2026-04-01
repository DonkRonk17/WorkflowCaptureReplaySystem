/**
 * Unit tests — PDF Hook (Sprint 4)
 * All file system operations and PDF comparator are mocked.
 */

jest.mock('fs', () => {
  const realFs = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...realFs,
    existsSync: jest.fn().mockReturnValue(false),
    mkdirSync: jest.fn().mockReturnValue(undefined),
    writeFileSync: jest.fn().mockReturnValue(undefined)
  };
});

jest.mock('../../src/pdf-verifier/comparator.js', () => ({
  comparePdfs: jest.fn()
}));

jest.mock('../../src/pdf-verifier/reporter.js', () => ({
  writeReport: jest.fn().mockResolvedValue(undefined)
}));

import * as fs from 'fs';
import { checkPdfAfterPrint, type PdfCheckOptions } from '../../src/runtime/pdf-hook.js';
import type { ExecutorPage } from '../../src/runtime/executor.js';
import type { TraceTransition } from '../../src/types/index.js';
import { comparePdfs } from '../../src/pdf-verifier/comparator.js';
import type { FidelityReport } from '../../src/pdf-verifier/comparator.js';

const mockComparePdfs = comparePdfs as jest.MockedFunction<typeof comparePdfs>;

function makeMockPage(overrides: Partial<{ pdfThrows: boolean; pdfBuffer: Buffer }> = {}): ExecutorPage {
  return {
    url: () => 'https://app.example.com',
    title: async () => 'Test Page',
    goto: jest.fn().mockResolvedValue(null),
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
      ? jest.fn().mockRejectedValue(new Error('PDF capture not available'))
      : jest.fn().mockResolvedValue(overrides.pdfBuffer ?? Buffer.from('%PDF-1.4 test content'))
  };
}

function makeTransition(id = 'print_step_001'): TraceTransition {
  return {
    id,
    from: 'state_000',
    to: 'state_001',
    event: 'PRINT',
    action_type: 'print',
    selectors: [],
    guard_conditions: [],
    confidence: 0.9,
    recordings_seen: 1
  };
}

function makeOptions(outputDir = '/tmp/wcrs-test'): PdfCheckOptions {
  return {
    outputDir,
    pullDate: '2026-03-30',
    patientId: 'P001'
  };
}

function makeFidelityReport(result: 'PASS' | 'WARN' | 'FAIL'): FidelityReport {
  return {
    comparison_id: 'cmp-001',
    generated_pdf: '/tmp/print-001.pdf',
    reference_pdf: '/tmp/baseline-001.pdf',
    result,
    overall_similarity: result === 'PASS' ? 1.0 : result === 'WARN' ? 0.85 : 0.5,
    checks: {
      page_count_match: true,
      orientation_match: true,
      text_content_similarity: result === 'PASS' ? 1.0 : 0.85,
      visual_similarity: null,
      margins_within_tolerance: null
    },
    discrepancies: result === 'FAIL'
      ? [{ page: 1, type: 'text_missing', description: 'Text similarity 50.0% is below 95% threshold' }]
      : [],
    is_two_up_layout: false,
    generated_at: '2026-03-30T00:00:00.000Z'
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('checkPdfAfterPrint — SKIPPED when page.pdf() throws', () => {
  it('returns fidelity_status=SKIPPED and checked=false when page.pdf() throws', async () => {
    const page = makeMockPage({ pdfThrows: true });
    const result = await checkPdfAfterPrint(page, makeTransition(), makeOptions());
    expect(result.checked).toBe(false);
    expect(result.fidelity_status).toBe('SKIPPED');
    expect(result.failure_reason).toContain('page.pdf() failed');
  });
});

describe('checkPdfAfterPrint — PASS on first run (baseline capture)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockImplementation((p: unknown) => {
      const pathStr = String(p);
      // outputDir exists, baseline does NOT exist
      if (pathStr.includes('baseline-')) return false;
      return true;
    });
  });

  it('returns PASS and writes baseline when no baseline exists', async () => {
    const page = makeMockPage();
    const result = await checkPdfAfterPrint(page, makeTransition(), makeOptions());
    expect(result.checked).toBe(true);
    expect(result.fidelity_status).toBe('PASS');
    // Should have written both the captured PDF and the baseline
    const writeFileSyncCalls = (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mock.calls;
    const baselineWrite = writeFileSyncCalls.find(c => String(c[0]).includes('baseline-'));
    expect(baselineWrite).toBeDefined();
  });

  it('does not call comparePdfs when baseline is missing', async () => {
    const page = makeMockPage();
    await checkPdfAfterPrint(page, makeTransition(), makeOptions());
    expect(mockComparePdfs).not.toHaveBeenCalled();
  });
});

describe('checkPdfAfterPrint — returns fidelity_status from comparator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Baseline exists
    (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockReturnValue(true);
  });

  it('returns PASS when comparator returns PASS', async () => {
    mockComparePdfs.mockResolvedValue(makeFidelityReport('PASS'));
    const page = makeMockPage();
    const result = await checkPdfAfterPrint(page, makeTransition(), makeOptions());
    expect(result.fidelity_status).toBe('PASS');
    expect(result.checked).toBe(true);
  });

  it('returns WARN when comparator returns WARN', async () => {
    mockComparePdfs.mockResolvedValue(makeFidelityReport('WARN'));
    const page = makeMockPage();
    const result = await checkPdfAfterPrint(page, makeTransition(), makeOptions());
    expect(result.fidelity_status).toBe('WARN');
    expect(result.checked).toBe(true);
  });

  it('returns FAIL with failure_reason when comparator returns FAIL', async () => {
    mockComparePdfs.mockResolvedValue(makeFidelityReport('FAIL'));
    const page = makeMockPage();
    const result = await checkPdfAfterPrint(page, makeTransition(), makeOptions());
    expect(result.fidelity_status).toBe('FAIL');
    expect(result.failure_reason).toBeDefined();
    expect(result.failure_reason!.length).toBeGreaterThan(0);
  });
});

describe('checkPdfAfterPrint — writes PDF buffer to correct path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockImplementation((p: unknown) => {
      return !String(p).includes('baseline-');
    });
  });

  it('writes captured PDF to print-<transition.id>.pdf', async () => {
    const page = makeMockPage();
    const transition = makeTransition('my_print_step');
    await checkPdfAfterPrint(page, transition, makeOptions('/output'));
    const writeFileSyncCalls = (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mock.calls;
    const capturedWrite = writeFileSyncCalls.find(c => String(c[0]).includes('print-my_print_step.pdf'));
    expect(capturedWrite).toBeDefined();
  });
});
