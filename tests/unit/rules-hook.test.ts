/**
 * Unit tests — Rules Hook (Sprint 4)
 * RulesEngine is mocked so no real YAML loading occurs.
 */

jest.mock('../../src/rules-engine/engine.js', () => ({
  RulesEngine: jest.fn()
}));

import { checkRulesAfterStep } from '../../src/runtime/rules-hook.js';
import { RulesEngine } from '../../src/rules-engine/engine.js';
import type { WorkflowContext } from '../../src/types/index.js';

const MockRulesEngine = RulesEngine as jest.MockedClass<typeof RulesEngine>;

function makeWorkflowContext(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    patient_id: 'P001',
    pull_date: '2026-03-30',
    last_cu_date: '2026-01-01',
    collected_docs: [],
    ...overrides
  };
}

function makePacketResult(allPassed: boolean, failedRules: Array<{ doc_filename: string; rule_id: string; message: string }> = []) {
  return {
    packet_id: 'pkt-001',
    evaluated_at: '2026-03-30T00:00:00.000Z',
    all_passed: allPassed,
    results: [],
    failed_rules: failedRules,
    warnings: []
  };
}

describe('checkRulesAfterStep — returns passed=true when all rules pass', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockRulesEngine.mockImplementation(() => ({
      evaluate: jest.fn(),
      evaluatePacket: jest.fn().mockReturnValue(makePacketResult(true)),
      getRuleById: jest.fn(),
      getRulesByType: jest.fn(),
      getRulesByDocType: jest.fn(),
      getSummary: jest.fn()
    } as unknown as InstanceType<typeof RulesEngine>));
  });

  it('returns passed=true and empty violations when all rules pass', () => {
    const context = makeWorkflowContext();
    const result = checkRulesAfterStep(context, '/some/rules.yaml');
    expect(result.checked).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

describe('checkRulesAfterStep — returns passed=false + violations when rules fail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockRulesEngine.mockImplementation(() => ({
      evaluate: jest.fn(),
      evaluatePacket: jest.fn().mockReturnValue(makePacketResult(false, [
        { doc_filename: 'FC_2026-03-30.pdf', rule_id: 'NAMING_PULL_DATE', message: 'NAMING_PULL_DATE: filename does not contain pull date' },
        { doc_filename: 'Lab_2025-12-01.pdf', rule_id: 'LABS_DATE_SCOPE', message: 'LABS_DATE_SCOPE: date 2025-12-01 is before last CU 2026-01-01' }
      ])),
      getRuleById: jest.fn(),
      getRulesByType: jest.fn(),
      getRulesByDocType: jest.fn(),
      getSummary: jest.fn()
    } as unknown as InstanceType<typeof RulesEngine>));
  });

  it('returns passed=false when rules fail', () => {
    const result = checkRulesAfterStep(makeWorkflowContext(), '/some/rules.yaml');
    expect(result.passed).toBe(false);
  });

  it('includes violations with rule_id and message', () => {
    const result = checkRulesAfterStep(makeWorkflowContext(), '/some/rules.yaml');
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]).toContain('NAMING_PULL_DATE');
    expect(result.violations[1]).toContain('LABS_DATE_SCOPE');
  });
});

describe('checkRulesAfterStep — uses default cu-rules.yaml when rulesPath not specified', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockRulesEngine.mockImplementation(() => ({
      evaluate: jest.fn(),
      evaluatePacket: jest.fn().mockReturnValue(makePacketResult(true)),
      getRuleById: jest.fn(),
      getRulesByType: jest.fn(),
      getRulesByDocType: jest.fn(),
      getSummary: jest.fn()
    } as unknown as InstanceType<typeof RulesEngine>));
  });

  it('instantiates RulesEngine with a path ending in cu-rules.yaml when no path given', () => {
    checkRulesAfterStep(makeWorkflowContext());
    expect(MockRulesEngine).toHaveBeenCalledTimes(1);
    const constructorArg = MockRulesEngine.mock.calls[0]![0];
    expect(constructorArg).toMatch(/cu-rules\.yaml$/);
  });
});
