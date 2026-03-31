/**
 * Unit tests — Execution Reporter (Sprint 3)
 */

jest.mock('fs');

import * as fs from 'fs';
import * as path from 'path';
import {
  createReport,
  addStepResult,
  finalizeReport,
  formatMarkdown,
  writeReport,
  type StepResult,
  type ExecutionReport
} from '../../src/runtime/reporter.js';
import type { RecoveryEvent } from '../../src/runtime/recovery-handler.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeStep(overrides: Partial<StepResult> = {}): StepResult {
  return {
    step_index: 0,
    transition_id: 'trans_001',
    action_type: 'click',
    started_at: '2026-03-30T10:00:00.000Z',
    completed_at: '2026-03-30T10:00:01.000Z',
    duration_ms: 1000,
    status: 'success',
    verification: null,
    recovery_events: [],
    ...overrides
  };
}

function makeRecoveryEvent(overrides: Partial<RecoveryEvent> = {}): RecoveryEvent {
  return {
    event_id: 'ev-001',
    timestamp: '2026-03-30T10:00:00.000Z',
    step_index: 0,
    transition_id: 'trans_001',
    failure_type: 'timeout',
    failure_detail: 'timed out',
    action_taken: 'RETRY',
    retry_count: 0,
    resolved: true,
    ...overrides
  };
}

// ── createReport ───────────────────────────────────────────────────────────

describe('createReport', () => {
  it('returns ExecutionReport with all required fields', () => {
    const report = createReport({
      workflowId: 'cu_workflow',
      startedAt: '2026-03-30T10:00:00.000Z'
    });
    expect(report.run_id).toBeDefined();
    expect(report.workflow_id).toBe('cu_workflow');
    expect(report.started_at).toBe('2026-03-30T10:00:00.000Z');
    expect(report.status).toBe('completed');
    expect(report.total_steps).toBe(0);
    expect(report.steps_succeeded).toBe(0);
    expect(report.steps_recovered).toBe(0);
    expect(report.steps_skipped).toBe(0);
    expect(report.steps_failed).toBe(0);
    expect(report.steps_escalated).toBe(0);
    expect(Array.isArray(report.step_results)).toBe(true);
    expect(Array.isArray(report.recovery_events)).toBe(true);
    expect(report.final_state_id).toBeNull();
  });

  it('run_id is a valid uuid', () => {
    const report = createReport({ workflowId: 'wf', startedAt: '2026-01-01T00:00:00.000Z' });
    expect(report.run_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('populates patient_id and pull_date from context', () => {
    const report = createReport({
      workflowId: 'wf',
      startedAt: '2026-01-01T00:00:00.000Z',
      context: { patient_id: 'P001', pull_date: '2026-03-30' }
    });
    expect(report.patient_id).toBe('P001');
    expect(report.pull_date).toBe('2026-03-30');
  });
});

// ── addStepResult ──────────────────────────────────────────────────────────

describe('addStepResult', () => {
  let report: ExecutionReport;

  beforeEach(() => {
    report = createReport({ workflowId: 'wf', startedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('increments steps_succeeded and total_steps on success', () => {
    addStepResult(report, makeStep({ status: 'success' }));
    expect(report.steps_succeeded).toBe(1);
    expect(report.total_steps).toBe(1);
    expect(report.status).toBe('completed');
  });

  it('increments steps_recovered on recovered', () => {
    addStepResult(report, makeStep({ status: 'recovered' }));
    expect(report.steps_recovered).toBe(1);
    expect(report.status).toBe('completed');
  });

  it('increments steps_skipped on skipped', () => {
    addStepResult(report, makeStep({ status: 'skipped' }));
    expect(report.steps_skipped).toBe(1);
  });

  it('increments steps_failed and sets status=failed on failed', () => {
    addStepResult(report, makeStep({ status: 'failed' }));
    expect(report.steps_failed).toBe(1);
    expect(report.status).toBe('failed');
  });

  it('increments steps_escalated and sets status=escalated on escalated', () => {
    addStepResult(report, makeStep({ status: 'escalated' }));
    expect(report.steps_escalated).toBe(1);
    expect(report.status).toBe('escalated');
  });

  it('escalated status is sticky (cannot be overridden by later success)', () => {
    addStepResult(report, makeStep({ status: 'escalated' }));
    addStepResult(report, makeStep({ status: 'success' }));
    expect(report.status).toBe('escalated');
  });

  it('collects recovery_events from step to report level', () => {
    const ev = makeRecoveryEvent();
    addStepResult(report, makeStep({ status: 'recovered', recovery_events: [ev] }));
    expect(report.recovery_events).toHaveLength(1);
    expect(report.recovery_events[0]!.event_id).toBe('ev-001');
  });

  it('appends step to step_results', () => {
    addStepResult(report, makeStep({ step_index: 0 }));
    addStepResult(report, makeStep({ step_index: 1 }));
    expect(report.step_results).toHaveLength(2);
  });
});

// ── finalizeReport ────────────────────────────────────────────────────────

describe('finalizeReport', () => {
  it('sets completed_at and total_duration_ms', () => {
    const report = createReport({ workflowId: 'wf', startedAt: '2026-01-01T00:00:00.000Z' });
    finalizeReport(report, 'state_final');
    expect(report.completed_at).not.toBe('');
    expect(report.total_duration_ms).toBeGreaterThanOrEqual(0);
    expect(report.final_state_id).toBe('state_final');
  });

  it('sets final_state_id to null when passed null', () => {
    const report = createReport({ workflowId: 'wf', startedAt: '2026-01-01T00:00:00.000Z' });
    finalizeReport(report, null);
    expect(report.final_state_id).toBeNull();
  });

  it('completed_at is a valid ISO-8601 timestamp', () => {
    const report = createReport({ workflowId: 'wf', startedAt: '2026-01-01T00:00:00.000Z' });
    finalizeReport(report, null);
    expect(() => new Date(report.completed_at)).not.toThrow();
    expect(new Date(report.completed_at).toISOString()).toBe(report.completed_at);
  });
});

// ── formatMarkdown ────────────────────────────────────────────────────────

describe('formatMarkdown', () => {
  let report: ExecutionReport;

  beforeEach(() => {
    report = createReport({
      workflowId: 'cu_workflow',
      startedAt: '2026-03-30T10:00:00.000Z',
      context: { patient_id: 'P001', pull_date: '2026-03-30' }
    });
    addStepResult(report, makeStep({ status: 'success', step_index: 0 }));
    addStepResult(report, makeStep({ status: 'recovered', step_index: 1, recovery_events: [makeRecoveryEvent()] }));
    finalizeReport(report, 'state_done');
  });

  it('contains the run_id', () => {
    const md = formatMarkdown(report);
    expect(md).toContain(report.run_id);
  });

  it('contains a status badge', () => {
    const md = formatMarkdown(report);
    expect(md).toMatch(/COMPLETED|ESCALATED|FAILED/);
  });

  it('contains the step count in the summary table', () => {
    const md = formatMarkdown(report);
    expect(md).toContain('Total Steps');
    expect(md).toContain('2');
  });

  it('contains per-step table entries', () => {
    const md = formatMarkdown(report);
    expect(md).toContain('trans_001');
    expect(md).toContain('click');
  });

  it('contains recovery events section when events exist', () => {
    const md = formatMarkdown(report);
    expect(md).toContain('Recovery Events');
    expect(md).toContain('RETRY');
  });

  it('contains workflow_id', () => {
    const md = formatMarkdown(report);
    expect(md).toContain('cu_workflow');
  });
});

// ── writeReport ───────────────────────────────────────────────────────────

describe('writeReport', () => {
  const mockWriteFileSync = fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>;
  const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
  const mockMkdirSync = fs.mkdirSync as jest.MockedFunction<typeof fs.mkdirSync>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => undefined as unknown as ReturnType<typeof fs.mkdirSync>);
    mockWriteFileSync.mockImplementation(() => undefined);
  });

  it('writes JSON and Markdown files', async () => {
    const report = createReport({ workflowId: 'wf', startedAt: '2026-01-01T00:00:00.000Z' });
    finalizeReport(report, null);
    await writeReport(report, '/tmp/output');
    const calls = mockWriteFileSync.mock.calls.map((c: unknown[]) => c[0] as string);
    const jsonFile = calls.find((p: string) => p.endsWith('.json'));
    const mdFile = calls.find((p: string) => p.endsWith('.md'));
    expect(jsonFile).toBeDefined();
    expect(mdFile).toBeDefined();
  });

  it('files are named <run_id>.json and <run_id>.md', async () => {
    const report = createReport({ workflowId: 'wf', startedAt: '2026-01-01T00:00:00.000Z' });
    finalizeReport(report, null);
    await writeReport(report, '/tmp/output');
    const calls = mockWriteFileSync.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((p: string) => p === path.join('/tmp/output', `${report.run_id}.json`))).toBe(true);
    expect(calls.some((p: string) => p === path.join('/tmp/output', `${report.run_id}.md`))).toBe(true);
  });

  it('creates outputDir if it does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const report = createReport({ workflowId: 'wf', startedAt: '2026-01-01T00:00:00.000Z' });
    await writeReport(report, '/tmp/new-output');
    expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/new-output', { recursive: true });
  });
});
