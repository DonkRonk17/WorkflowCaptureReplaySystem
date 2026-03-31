/**
 * Sprint 2 Integration Tests
 * Tests the full pipeline across all Sprint 2 modules working together.
 */

import * as path from 'path';
import { jest } from '@jest/globals';

// ── Mock pdf-parse for TEST 2 ──────────────────────────────────────────────
jest.mock('pdf-parse', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jest.fn().mockImplementation((_buf: any, opts?: any) => {
    if (opts?.pagerender) {
      opts.pagerender({ view: [0, 0, 612, 792] }); // portrait
    }
    return Promise.resolve({
      numpages: 3,
      text: 'Clinical Update document text content.',
      info: { Author: 'WCRS', Title: 'CU Document' }
    });
  });
});

// Mock fs.readFileSync for PDF paths only
jest.mock('fs', () => {
  const real = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...real,
    readFileSync: jest.fn((p: unknown, ...args: unknown[]) => {
      if (typeof p === 'string' && p.endsWith('.pdf')) return Buffer.from('fake-pdf');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (real.readFileSync as any)(p, ...args);
    }),
    writeFileSync: jest.fn(),
    existsSync: jest.fn((p: unknown) => {
      if (typeof p === 'string' && p.endsWith('.pdf')) return true;
      return (real.existsSync as typeof real.existsSync)(p as string);
    }),
    mkdirSync: jest.fn(),
    readdirSync: jest.fn((p: unknown) => {
      if (typeof p === 'string' && p.includes('wcrs_')) return [] as string[];
      return (real.readdirSync as typeof real.readdirSync)(p as string);
    })
  };
});

// Mock child_process so pdftoppm is unavailable
jest.mock('child_process', () => ({
  execSync: jest.fn((_cmd: string) => {
    throw new Error('pdftoppm: not found');
  })
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────
import { diffTraces } from '../../src/state-mapper/state-differ.js';
import { buildAndExportXState } from '../../src/state-mapper/graph-builder.js';
import { comparePdfs } from '../../src/pdf-verifier/comparator.js';
import { buildPacket } from '../../src/doc-extractor/packet-builder.js';
import { RulesEngine } from '../../src/rules-engine/engine.js';
import type { WorkflowTrace, DocumentMetadata, WorkflowContext } from '../../src/types/index.js';
import sampleTrace from '../fixtures/sample-trace.json';

const CU_RULES_PATH = path.join(__dirname, '../../config/cu-rules.yaml');
const PULL_DATE = '2026-03-15';
const LAST_CU   = '2026-02-01';

// ── TEST 1: Multi-trace merge pipeline ────────────────────────────────────

describe('TEST 1 — Multi-trace merge pipeline', () => {
  const t1 = sampleTrace as WorkflowTrace;
  const t2: WorkflowTrace = { ...t1, trace_id: 'trace-s2-002' };
  const t3: WorkflowTrace = { ...t1, trace_id: 'trace-s2-003' };

  test('3 traces merged into single graph with states', () => {
    const result = diffTraces([t1, t2, t3]);
    expect(result.graph.states.size).toBeGreaterThan(0);
    expect(result.stats.valid_traces).toBe(3);
    expect(result.stats.skipped_traces).toBe(0);
  });

  test('transitions have recordings_seen = 3', () => {
    const result = diffTraces([t1, t2, t3]);
    for (const t of result.graph.transitions) {
      expect(t.recordings_seen).toBe(3);
    }
  });

  test('confidence scores are higher with 3 traces than single trace', () => {
    const single = diffTraces([t1]);
    const triple = diffTraces([t1, t2, t3]);

    if (single.graph.transitions.length > 0 && triple.graph.transitions.length > 0) {
      const singleMax = Math.max(...single.graph.transitions.map(t => t.confidence));
      const tripleMax = Math.max(...triple.graph.transitions.map(t => t.confidence));
      expect(tripleMax).toBeGreaterThan(singleMax);
    }
  });

  test('human_intervention recovery state is present in XState export', () => {
    const result = diffTraces([t1, t2, t3]);
    const machine = buildAndExportXState([t1, t2, t3], {}, { addRecoveryStates: true });
    expect(machine.states).toHaveProperty('human_intervention');
    expect(machine.states['human_intervention']!.type).toBe('final');
    expect(machine.states['human_intervention']!.meta?.recovery).toBe(true);
    // Make result usage count to avoid unused var warning
    expect(result.graph.states.size).toBeGreaterThan(0);
  });
});

// ── TEST 2: PDF FidelityReport structure ──────────────────────────────────

describe('TEST 2 — PDF FidelityReport structure', () => {
  test('FidelityReport has all required fields', async () => {
    const report = await comparePdfs('/fake/generated.pdf', '/fake/reference.pdf');

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

  test('result is one of PASS, WARN, FAIL', async () => {
    const report = await comparePdfs('/fake/gen.pdf', '/fake/ref.pdf');
    expect(['PASS', 'WARN', 'FAIL']).toContain(report.result);
  });

  test('calcTextSimilarity confirms heavily different text → below PASS threshold', () => {
    // Test the underlying similarity function directly to verify FAIL/WARN logic
    // (Integration: comparator's similarity function + the PASS threshold of 0.95)
    const { calcTextSimilarity } = require('../../src/pdf-verifier/comparator.js');
    const aaaa = 'AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA';
    const zzzz = 'ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ';
    const sim = calcTextSimilarity(aaaa, zzzz);
    // Completely different text → similarity = 0 → below 0.95 (PASS) and below 0.80 (WARN) → FAIL
    expect(sim).toBeLessThan(0.80);
  });
});

// ── TEST 3: Rules engine validates a CU document set ─────────────────────

describe('TEST 3 — Rules engine validates a CU document set', () => {
  let engine: RulesEngine;
  const context: WorkflowContext = {
    patient_id: 'p001',
    pull_date: PULL_DATE,
    last_cu_date: LAST_CU,
    collected_docs: [],
    radiology_results_exist: true,
    therapy_discipline_active: false
  };

  beforeAll(() => {
    engine = new RulesEngine(CU_RULES_PATH);
  });

  test('NAMING_PULL_DATE passes for FC with pull_date in filename', () => {
    const fcDoc: DocumentMetadata = {
      filename: `FC_${PULL_DATE}.pdf`,
      doc_type: 'FC',
      document_date: PULL_DATE,
      patient_id: 'p001'
    };
    const results = engine.evaluate(fcDoc, context);
    const namingResult = results.find(r => r.rule_id === 'NAMING_PULL_DATE');
    expect(namingResult).toBeDefined();
    expect(namingResult!.passed).toBe(true);
  });

  test('NAMING_DOC_DATE passes for Lab with document_date in filename', () => {
    const labDate = '2026-03-10';
    const labDoc: DocumentMetadata = {
      filename: `Lab_${labDate}.pdf`,
      doc_type: 'Lab',
      document_date: labDate,
      patient_id: 'p001'
    };
    const results = engine.evaluate(labDoc, context);
    const namingResult = results.find(r => r.rule_id === 'NAMING_DOC_DATE');
    expect(namingResult).toBeDefined();
    expect(namingResult!.passed).toBe(true);
  });

  test('mis-named FC doc (doc_date not pull_date) fails NAMING_PULL_DATE', () => {
    const fcDoc: DocumentMetadata = {
      filename: 'FC_2026-03-10.pdf', // wrong date
      doc_type: 'FC',
      document_date: '2026-03-10',
      patient_id: 'p001'
    };
    const results = engine.evaluate(fcDoc, context);
    const namingResult = results.find(r => r.rule_id === 'NAMING_PULL_DATE');
    expect(namingResult).toBeDefined();
    expect(namingResult!.passed).toBe(false);
  });
});

// ── TEST 4: Full doc-extractor packet assembly ────────────────────────────

describe('TEST 4 — Full doc-extractor packet assembly', () => {
  function makeDoc(
    doc_type: string,
    filename: string,
    document_date = '2026-03-10',
    page_count = 2
  ): DocumentMetadata {
    return { filename, doc_type, document_date, patient_id: 'p001', page_count };
  }

  const fc  = makeDoc('FC',  `FC_${PULL_DATE}.pdf`,  PULL_DATE, 3);
  const fs  = makeDoc('FS',  `FS_${PULL_DATE}.pdf`,  PULL_DATE, 2);
  const lab = makeDoc('Lab', 'Lab_2026-03-10.pdf',   '2026-03-10', 1);
  const os  = makeDoc('OS',  `OS_${PULL_DATE}.pdf`,  PULL_DATE, 4);
  const rad = makeDoc('Rad', 'Rad_2026-03-05.pdf',   '2026-03-05', 2);

  test('order[0].doc_type = FC', () => {
    const packet = buildPacket([lab, rad, os, fs, fc]);
    expect(packet.order[0]!.doc_type).toBe('FC');
  });

  test('order[1].doc_type = FS', () => {
    const packet = buildPacket([lab, rad, os, fs, fc]);
    expect(packet.order[1]!.doc_type).toBe('FS');
  });

  test('remaining docs are alphabetically sorted by doc_type', () => {
    const packet = buildPacket([lab, rad, os, fs, fc]);
    const rest = packet.order.slice(2).map(d => d.doc_type);
    expect(rest).toEqual([...rest].sort());
  });

  test('no missing_required when FC and FS are present', () => {
    const packet = buildPacket([fc, fs, lab, os, rad]);
    expect(packet.missing_required).toHaveLength(0);
  });

  test('missing_required includes FC when FC is absent', () => {
    const packet = buildPacket([fs, lab, os]);
    expect(packet.missing_required).toContain('FC');
    expect(packet.missing_required).not.toContain('FS');
  });

  test('packet has all required fields', () => {
    const packet = buildPacket([fc, fs, lab]);
    expect(packet).toHaveProperty('packet_id');
    expect(packet).toHaveProperty('assembled_at');
    expect(packet).toHaveProperty('total_docs');
    expect(packet).toHaveProperty('total_pages');
    expect(packet).toHaveProperty('order');
    expect(packet).toHaveProperty('missing_required');
    expect(packet).toHaveProperty('warnings');
  });
});
