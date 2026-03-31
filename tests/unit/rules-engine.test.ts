/**
 * Tests for src/rules-engine/
 */

import * as path from 'path';
import { loadRules, RuleLoadError } from '../../src/rules-engine/loader.js';
import { evaluateRule } from '../../src/rules-engine/evaluator.js';
import { RulesEngine } from '../../src/rules-engine/engine.js';
import type { DocumentMetadata, WorkflowContext, Rule } from '../../src/types/index.js';

// ── Paths ──────────────────────────────────────────────────────────────────

const CU_RULES_PATH = path.join(__dirname, '../../config/cu-rules.yaml');
const SRC_RULES_PATH = path.join(__dirname, '../../src/rules-engine/rules/cu-rules.yaml');

// ── Helpers ────────────────────────────────────────────────────────────────

const PULL_DATE  = '2026-03-15';
const LAST_CU    = '2026-02-01';

const mockContext: WorkflowContext = {
  patient_id: 'p001',
  pull_date: PULL_DATE,
  last_cu_date: LAST_CU,
  collected_docs: [],
  radiology_results_exist: true,
  therapy_discipline_active: true
};

function makeDoc(doc_type: string, filename: string, document_date = '2026-03-10'): DocumentMetadata {
  return { filename, doc_type, document_date, patient_id: 'p001' };
}

// ── loadRules ──────────────────────────────────────────────────────────────

describe('loadRules', () => {
  test('successfully loads config/cu-rules.yaml', () => {
    const rules = loadRules(CU_RULES_PATH);
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  test('also loads from src/rules-engine/rules/cu-rules.yaml', () => {
    const rules = loadRules(SRC_RULES_PATH);
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  test('throws RuleLoadError when file does not exist', () => {
    expect(() => loadRules('/nonexistent/rules.yaml')).toThrow(RuleLoadError);
  });

  test('throws RuleLoadError for YAML missing required fields (no id)', () => {
    const tmpFile = path.join(require('os').tmpdir(), `wcrs-test-rules-${Date.now()}.yaml`);
    const invalidYaml = `rules:\n  - type: sequencing\n    description: "missing id field"\n`;
    require('fs').writeFileSync(tmpFile, invalidYaml, 'utf-8');
    try {
      let caughtError: unknown;
      try { loadRules(tmpFile); } catch (e) { caughtError = e; }
      expect(caughtError).toBeInstanceOf(RuleLoadError);
      expect((caughtError as RuleLoadError).validationErrors.length).toBeGreaterThan(0);
    } finally {
      require('fs').unlinkSync(tmpFile);
    }
  });

  test('all loaded rules have id, type, description', () => {
    const rules = loadRules(CU_RULES_PATH);
    for (const rule of rules) {
      expect(typeof rule.id).toBe('string');
      expect(typeof rule.type).toBe('string');
      expect(typeof rule.description).toBe('string');
    }
  });
});

// ── evaluateRule: naming rules ─────────────────────────────────────────────

describe('evaluateRule — naming', () => {
  let namingPullRule: Rule;
  let namingDocRule: Rule;

  beforeAll(() => {
    const rules = loadRules(CU_RULES_PATH);
    namingPullRule = rules.find(r => r.id === 'NAMING_PULL_DATE')!;
    namingDocRule  = rules.find(r => r.id === 'NAMING_DOC_DATE')!;
    expect(namingPullRule).toBeDefined();
    expect(namingDocRule).toBeDefined();
  });

  test('NAMING_PULL_DATE passes for FC with pull_date in filename', () => {
    const doc = makeDoc('FC', `FC_${PULL_DATE}.pdf`);
    const result = evaluateRule(namingPullRule!, doc, mockContext);
    expect(result.passed).toBe(true);
  });

  test('NAMING_PULL_DATE fails for FC with doc_date in filename', () => {
    const doc = makeDoc('FC', 'FC_2026-03-10.pdf'); // doc date, not pull date
    const result = evaluateRule(namingPullRule!, doc, mockContext);
    expect(result.passed).toBe(false);
  });

  test('NAMING_PULL_DATE passes for FS with pull_date', () => {
    const doc = makeDoc('FS', `FS_${PULL_DATE}_formulary.pdf`);
    const result = evaluateRule(namingPullRule!, doc, mockContext);
    expect(result.passed).toBe(true);
  });

  test('NAMING_PULL_DATE not applicable to Lab (passes trivially)', () => {
    const doc = makeDoc('Lab', 'Lab_2026-03-10.pdf', '2026-03-10');
    const result = evaluateRule(namingPullRule!, doc, mockContext);
    expect(result.passed).toBe(true); // not in doc_types for pull_date rule
  });

  test('NAMING_DOC_DATE passes for Lab with document_date in filename', () => {
    const docDate = '2026-03-10';
    const doc = makeDoc('Lab', `Lab_${docDate}.pdf`, docDate);
    const result = evaluateRule(namingDocRule!, doc, mockContext);
    expect(result.passed).toBe(true);
  });

  test('NAMING_DOC_DATE fails for Lab with wrong date in filename', () => {
    const doc = makeDoc('Lab', 'Lab_2026-01-01.pdf', '2026-03-10');
    const result = evaluateRule(namingDocRule!, doc, mockContext);
    expect(result.passed).toBe(false);
  });

  test('NAMING_DOC_DATE not applicable to FC (passes trivially)', () => {
    const doc = makeDoc('FC', `FC_${PULL_DATE}.pdf`);
    const result = evaluateRule(namingDocRule!, doc, mockContext);
    expect(result.passed).toBe(true);
  });
});

// ── evaluateRule: date_filter rules ───────────────────────────────────────

describe('evaluateRule — date_filter', () => {
  let rules: Rule[];
  beforeAll(() => { rules = loadRules(CU_RULES_PATH); });

  test('LABS_DATE_SCOPE passes when doc_date >= last_cu_date', () => {
    const rule = rules.find(r => r.id === 'LABS_DATE_SCOPE')!;
    const doc = makeDoc('Lab', 'Lab_2026-02-15.pdf', '2026-02-15'); // after last CU
    const result = evaluateRule(rule!, doc, mockContext);
    expect(result.passed).toBe(true);
  });

  test('LABS_DATE_SCOPE fails when doc_date < last_cu_date', () => {
    const rule = rules.find(r => r.id === 'LABS_DATE_SCOPE')!;
    const doc = makeDoc('Lab', 'Lab_2026-01-15.pdf', '2026-01-15'); // before last CU
    const result = evaluateRule(rule!, doc, mockContext);
    expect(result.passed).toBe(false);
  });

  test('LABS_DATE_SCOPE passes when doc_date == last_cu_date', () => {
    const rule = rules.find(r => r.id === 'LABS_DATE_SCOPE')!;
    const doc = makeDoc('Lab', `Lab_${LAST_CU}.pdf`, LAST_CU);
    const result = evaluateRule(rule!, doc, mockContext);
    expect(result.passed).toBe(true);
  });

  test('SW_ALL_TIME always passes regardless of date', () => {
    const rule = rules.find(r => r.id === 'SW_ALL_TIME')!;
    const oldDoc = makeDoc('SW', 'SW_2020-01-01.pdf', '2020-01-01');
    const result = evaluateRule(rule!, oldDoc, mockContext);
    expect(result.passed).toBe(true);
  });
});

// ── evaluateRule: conditional rules ───────────────────────────────────────

describe('evaluateRule — conditional', () => {
  let rules: Rule[];
  beforeAll(() => { rules = loadRules(CU_RULES_PATH); });

  test('RAD_CONDITIONAL passes when radiology_results_exist = true', () => {
    const rule = rules.find(r => r.id === 'RAD_CONDITIONAL')!;
    const doc = makeDoc('Rad', 'Rad_2026-03-05.pdf', '2026-03-05');
    const ctx = { ...mockContext, radiology_results_exist: true };
    const result = evaluateRule(rule!, doc, ctx);
    expect(result.passed).toBe(true);
  });

  test('RAD_CONDITIONAL fails when radiology_results_exist = false', () => {
    const rule = rules.find(r => r.id === 'RAD_CONDITIONAL')!;
    const doc = makeDoc('Rad', 'Rad_2026-03-05.pdf', '2026-03-05');
    const ctx = { ...mockContext, radiology_results_exist: false };
    const result = evaluateRule(rule!, doc, ctx);
    expect(result.passed).toBe(false);
  });

  test('THERAPY_CONDITIONAL passes for OT when therapy_discipline_active = true', () => {
    const rule = rules.find(r => r.id === 'THERAPY_CONDITIONAL')!;
    const doc = makeDoc('OT', 'OT_2026-03-10.pdf', '2026-03-10');
    const ctx = { ...mockContext, therapy_discipline_active: true };
    const result = evaluateRule(rule!, doc, ctx);
    expect(result.passed).toBe(true);
  });

  test('THERAPY_CONDITIONAL passes for PT when therapy_discipline_active = true', () => {
    const rule = rules.find(r => r.id === 'THERAPY_CONDITIONAL')!;
    const doc = makeDoc('PT', 'PT_2026-03-10.pdf', '2026-03-10');
    const ctx = { ...mockContext, therapy_discipline_active: true };
    const result = evaluateRule(rule!, doc, ctx);
    expect(result.passed).toBe(true);
  });

  test('THERAPY_CONDITIONAL fails for ST when therapy_discipline_active = false', () => {
    const rule = rules.find(r => r.id === 'THERAPY_CONDITIONAL')!;
    const doc = makeDoc('ST', 'ST_2026-03-10.pdf', '2026-03-10');
    const ctx = { ...mockContext, therapy_discipline_active: false };
    const result = evaluateRule(rule!, doc, ctx);
    expect(result.passed).toBe(false);
  });

  test('THERAPY_CONDITIONAL not applicable to FC (passes trivially)', () => {
    const rule = rules.find(r => r.id === 'THERAPY_CONDITIONAL')!;
    const doc = makeDoc('FC', `FC_${PULL_DATE}.pdf`);
    const ctx = { ...mockContext, therapy_discipline_active: false };
    const result = evaluateRule(rule!, doc, ctx);
    // FC is not in OT/PT/ST → not applicable → passes
    expect(result.passed).toBe(true);
  });
});

// ── RulesEngine class ──────────────────────────────────────────────────────

describe('RulesEngine', () => {
  let engine: RulesEngine;

  beforeAll(() => {
    engine = new RulesEngine(CU_RULES_PATH);
  });

  test('getSummary returns correct total rule count', () => {
    const summary = engine.getSummary();
    expect(summary.totalRules).toBeGreaterThan(0);
    const sumByType = Object.values(summary.byType).reduce((a, b) => a + b, 0);
    expect(sumByType).toBe(summary.totalRules);
  });

  test('getSummary byType contains all rule types present in cu-rules.yaml', () => {
    const summary = engine.getSummary();
    expect(summary.byType).toHaveProperty('naming');
    expect(summary.byType).toHaveProperty('date_filter');
    expect(summary.byType).toHaveProperty('conditional');
    expect(summary.byType).toHaveProperty('ordering');
    expect(summary.byType).toHaveProperty('submission');
  });

  test('getRuleById returns correct rule', () => {
    const rule = engine.getRuleById('NAMING_PULL_DATE');
    expect(rule).toBeDefined();
    expect(rule!.id).toBe('NAMING_PULL_DATE');
    expect(rule!.type).toBe('naming');
  });

  test('getRuleById returns undefined for unknown id', () => {
    expect(engine.getRuleById('NO_SUCH_RULE')).toBeUndefined();
  });

  test('getRulesByType returns only rules of that type', () => {
    const namingRules = engine.getRulesByType('naming');
    expect(namingRules.length).toBeGreaterThan(0);
    expect(namingRules.every(r => r.type === 'naming')).toBe(true);
  });

  test('getRulesByDocType returns Lab-applicable rules', () => {
    const labRules = engine.getRulesByDocType('Lab');
    expect(labRules.length).toBeGreaterThan(0);
    for (const r of labRules) {
      const appliesToLab = r.doc_type === 'Lab' ||
        (Array.isArray(r.doc_types) && r.doc_types.includes('Lab'));
      expect(appliesToLab).toBe(true);
    }
  });

  test('evaluatePacket all_passed when docs are valid', () => {
    const fcDoc  = makeDoc('FC',  `FC_${PULL_DATE}.pdf`,  PULL_DATE);
    const labDoc = makeDoc('Lab', 'Lab_2026-03-10.pdf',   '2026-03-10');
    const result = engine.evaluatePacket([fcDoc, labDoc], mockContext);

    expect(result).toHaveProperty('packet_id');
    expect(result).toHaveProperty('evaluated_at');
    expect(result).toHaveProperty('all_passed');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('failed_rules');
    expect(result).toHaveProperty('warnings');
  });
});
