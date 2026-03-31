/**
 * Tests for src/pdf-verifier/
 * All PDF I/O and pdftoppm are mocked — no real files required.
 */

import { jest } from '@jest/globals';

// ── Mock pdf-parse ─────────────────────────────────────────────────────────
// Must be hoisted before imports that use it
jest.mock('pdf-parse', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jest.fn().mockImplementation((_buf: any, opts?: any) => {
    // If a custom pagerender is provided, call it with a portrait-page stub
    if (opts?.pagerender) {
      opts.pagerender({ view: [0, 0, 612, 792] }); // 8.5×11 portrait
    }
    return Promise.resolve({
      numpages: 2,
      text: 'Sample PDF text content for testing.',
      info: {
        Author: 'Test Author',
        Title: 'Test Title',
        CreationDate: '2026-01-01'
      }
    });
  });
});

// ── Mock fs (for extractor + reporter) ────────────────────────────────────
jest.mock('fs', () => {
  const real = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...real,
    readFileSync: jest.fn((p: unknown) => {
      // Return a dummy buffer for PDF reads; real for PNG reads
      if (typeof p === 'string' && p.endsWith('.pdf')) return Buffer.from('fake-pdf');
      return real.readFileSync(p as string);
    }),
    writeFileSync: jest.fn(),
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn(),
    readdirSync: jest.fn(() => [] as string[])
  };
});

// ── Mock child_process (rasterizer) ───────────────────────────────────────
jest.mock('child_process', () => ({
  execSync: jest.fn((_cmd: string) => {
    // 'which pdftoppm' — simulate not found
    throw new Error('pdftoppm: command not found');
  })
}));

import { calcTextSimilarity, comparePdfs } from '../../src/pdf-verifier/comparator.js';
import { formatMarkdown } from '../../src/pdf-verifier/reporter.js';
import { isPdftoppmAvailable } from '../../src/pdf-verifier/rasterizer.js';

// ── calcTextSimilarity unit tests ──────────────────────────────────────────

describe('calcTextSimilarity', () => {
  test('identical texts return 1.0', () => {
    expect(calcTextSimilarity('hello world', 'hello world')).toBe(1.0);
  });

  test('completely different texts return 0.0', () => {
    expect(calcTextSimilarity('aaa', 'bbb')).toBe(0.0);
  });

  test('empty vs empty = 1.0', () => {
    expect(calcTextSimilarity('', '')).toBe(1.0);
  });

  test('empty vs non-empty = 0.0', () => {
    expect(calcTextSimilarity('', 'hello')).toBe(0.0);
  });

  test('partial overlap is between 0 and 1', () => {
    const sim = calcTextSimilarity('hello world', 'hello earth');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  test('high similarity text', () => {
    const base = 'The quick brown fox jumps over the lazy dog';
    const similar = 'The quick brown fox leaps over the lazy dog';
    const sim = calcTextSimilarity(base, similar);
    expect(sim).toBeGreaterThan(0.80);
  });

  test('low similarity text (>20% diff) returns < 0.80', () => {
    const base = 'abcdefghijklmnopqrstuvwxyz';
    const different = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // entirely different case
    const sim = calcTextSimilarity(base, different);
    expect(sim).toBeLessThan(0.80);
  });
});

// ── isPdftoppmAvailable ────────────────────────────────────────────────────

describe('isPdftoppmAvailable', () => {
  test('returns false when pdftoppm is not installed (mocked)', () => {
    expect(isPdftoppmAvailable()).toBe(false);
  });
});

// ── comparePdfs ────────────────────────────────────────────────────────────

describe('comparePdfs', () => {
  test('returns FidelityReport with all required fields', async () => {
    const report = await comparePdfs('/fake/gen.pdf', '/fake/ref.pdf');

    expect(report).toHaveProperty('comparison_id');
    expect(report).toHaveProperty('generated_pdf');
    expect(report).toHaveProperty('reference_pdf');
    expect(report).toHaveProperty('result');
    expect(report).toHaveProperty('overall_similarity');
    expect(report).toHaveProperty('checks');
    expect(report).toHaveProperty('discrepancies');
    expect(report).toHaveProperty('is_two_up_layout');
    expect(report).toHaveProperty('generated_at');

    expect(report.checks).toHaveProperty('page_count_match');
    expect(report.checks).toHaveProperty('orientation_match');
    expect(report.checks).toHaveProperty('text_content_similarity');
    expect(report.checks).toHaveProperty('visual_similarity');
    expect(report.checks).toHaveProperty('margins_within_tolerance');
  });

  test('identical mock data → result = PASS', async () => {
    const report = await comparePdfs('/fake/gen.pdf', '/fake/ref.pdf');

    expect(report.result).toBe('PASS');
    expect(report.checks.text_content_similarity).toBe(1.0);
    expect(report.checks.page_count_match).toBe(true);
  });

  test('overall_similarity is between 0 and 1', async () => {
    const report = await comparePdfs('/fake/gen.pdf', '/fake/ref.pdf');
    expect(report.overall_similarity).toBeGreaterThanOrEqual(0);
    expect(report.overall_similarity).toBeLessThanOrEqual(1);
  });

  test('comparison_id is a non-empty string (uuid)', async () => {
    const report = await comparePdfs('/fake/gen.pdf', '/fake/ref.pdf');
    expect(typeof report.comparison_id).toBe('string');
    expect(report.comparison_id.length).toBeGreaterThan(0);
  });

  test('generated_at is ISO-8601 timestamp', async () => {
    const report = await comparePdfs('/fake/gen.pdf', '/fake/ref.pdf');
    expect(() => new Date(report.generated_at)).not.toThrow();
    expect(new Date(report.generated_at).toISOString()).toBe(report.generated_at);
  });

  test('visual_similarity is null when pdftoppm unavailable', async () => {
    const report = await comparePdfs('/fake/gen.pdf', '/fake/ref.pdf');
    expect(report.checks.visual_similarity).toBeNull();
  });

  test('2-up layout detected for landscape + half expected page count', async () => {
    // Mock pdf-parse to return a landscape orientation result
    const pdfParse = require('pdf-parse');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const landscapeMock = (_buf: any, opts?: any) => {
      if (opts?.pagerender) opts.pagerender({ view: [0, 0, 792, 612] }); // landscape
      return Promise.resolve({ numpages: 1, text: 'landscape pdf', info: {} });
    };
    pdfParse.mockImplementationOnce(landscapeMock);
    pdfParse.mockImplementationOnce(landscapeMock);
    pdfParse.mockImplementationOnce(landscapeMock);
    pdfParse.mockImplementationOnce(landscapeMock);

    // expectedPageCount=2 with actual=1 landscape page → is_two_up_layout=true
    const report = await comparePdfs('/fake/gen.pdf', '/fake/ref.pdf', {
      expectedPageCount: 2
    });

    expect(report.is_two_up_layout).toBe(true);
    const twoUpDisc = report.discrepancies.find(d => d.type === 'two_up_layout');
    expect(twoUpDisc).toBeDefined();
  });
});

// ── formatMarkdown ─────────────────────────────────────────────────────────

describe('formatMarkdown', () => {
  const mockReport = {
    comparison_id: 'abc-123',
    generated_pdf: '/gen.pdf',
    reference_pdf: '/ref.pdf',
    result: 'PASS' as const,
    overall_similarity: 0.987,
    checks: {
      page_count_match: true,
      orientation_match: true,
      text_content_similarity: 0.99,
      visual_similarity: 0.98,
      margins_within_tolerance: null
    },
    discrepancies: [],
    is_two_up_layout: false,
    generated_at: '2026-03-31T12:00:00.000Z'
  };

  test('contains result badge', () => {
    const md = formatMarkdown(mockReport);
    expect(md).toMatch(/PASS/);
  });

  test('contains comparison_id', () => {
    const md = formatMarkdown(mockReport);
    expect(md).toContain('abc-123');
  });

  test('FAIL result shows FAIL badge', () => {
    const failReport = { ...mockReport, result: 'FAIL' as const };
    const md = formatMarkdown(failReport);
    expect(md).toMatch(/FAIL/);
  });

  test('WARN result shows WARN badge', () => {
    const warnReport = { ...mockReport, result: 'WARN' as const };
    const md = formatMarkdown(warnReport);
    expect(md).toMatch(/WARN/);
  });

  test('null visual_similarity renders as N/A', () => {
    const noVisual = {
      ...mockReport,
      checks: { ...mockReport.checks, visual_similarity: null }
    };
    const md = formatMarkdown(noVisual);
    expect(md).toContain('N/A');
  });

  test('discrepancies are listed when present', () => {
    const withDisc = {
      ...mockReport,
      discrepancies: [{ page: 1, type: 'visual_diff' as const, description: 'Test diff' }]
    };
    const md = formatMarkdown(withDisc);
    expect(md).toContain('visual_diff');
    expect(md).toContain('Test diff');
  });
});
