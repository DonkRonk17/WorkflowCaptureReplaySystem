/**
 * Unit tests — Recovery Handler (Sprint 3)
 */

jest.mock('fs');

import * as fs from 'fs';
import * as path from 'path';
import { decideRecovery, buildRecoveryEvent, logRecoveryEvent } from '../../src/runtime/recovery-handler.js';
import type { FailureType, RecoveryEvent } from '../../src/runtime/recovery-handler.js';

// ── decideRecovery — decision matrix ─────────────────────────────────────

describe('decideRecovery — decision matrix', () => {
  const MAX = 2;

  it('timeout + retryCount=0 → RETRY with delay 2000', () => {
    const d = decideRecovery('timeout', 0, MAX);
    expect(d.action).toBe('RETRY');
    expect(d.delay_ms).toBe(2000);
  });

  it('timeout + retryCount=1 → RETRY with delay 4000', () => {
    const d = decideRecovery('timeout', 1, MAX);
    expect(d.action).toBe('RETRY');
    expect(d.delay_ms).toBe(4000);
  });

  it('timeout + retryCount=maxRetries → ESCALATE', () => {
    const d = decideRecovery('timeout', MAX, MAX);
    expect(d.action).toBe('ESCALATE');
  });

  it('selector_not_found + retryCount < max → RETRY with delay 1000', () => {
    const d = decideRecovery('selector_not_found', 0, MAX);
    expect(d.action).toBe('RETRY');
    expect(d.delay_ms).toBe(1000);
  });

  it('selector_not_found + retryCount < max (retry=1) → RETRY', () => {
    const d = decideRecovery('selector_not_found', 1, MAX);
    expect(d.action).toBe('RETRY');
    expect(d.delay_ms).toBe(1000);
  });

  it('selector_not_found + retryCount=maxRetries → ESCALATE', () => {
    const d = decideRecovery('selector_not_found', MAX, MAX);
    expect(d.action).toBe('ESCALATE');
  });

  it('state_mismatch + retryCount=0 → RETRY with delay 2000', () => {
    const d = decideRecovery('state_mismatch', 0, MAX);
    expect(d.action).toBe('RETRY');
    expect(d.delay_ms).toBe(2000);
  });

  it('state_mismatch + retryCount=1 → SKIP', () => {
    const d = decideRecovery('state_mismatch', 1, MAX);
    expect(d.action).toBe('SKIP');
    expect(d.delay_ms).toBe(0);
  });

  it('unexpected_popup + retryCount=0 → SKIP', () => {
    const d = decideRecovery('unexpected_popup', 0, MAX);
    expect(d.action).toBe('SKIP');
  });

  it('unexpected_popup + retryCount=1 → SKIP (any count)', () => {
    const d = decideRecovery('unexpected_popup', 1, MAX);
    expect(d.action).toBe('SKIP');
  });

  it('navigation_error + retryCount=0 → ESCALATE', () => {
    const d = decideRecovery('navigation_error', 0, MAX);
    expect(d.action).toBe('ESCALATE');
  });

  it('navigation_error + retryCount=1 → ESCALATE (any count)', () => {
    const d = decideRecovery('navigation_error', 1, MAX);
    expect(d.action).toBe('ESCALATE');
  });

  it('unknown → ESCALATE', () => {
    const d = decideRecovery('unknown', 0, MAX);
    expect(d.action).toBe('ESCALATE');
  });

  it('retryCount >= maxRetries overrides type-based logic → ESCALATE', () => {
    // Even a normally-retryable type escalates when retries are exhausted
    const d = decideRecovery('selector_not_found', 5, 2);
    expect(d.action).toBe('ESCALATE');
  });

  it('all decisions include a non-empty reason string', () => {
    const types: FailureType[] = [
      'timeout', 'selector_not_found', 'state_mismatch',
      'unexpected_popup', 'navigation_error', 'unknown'
    ];
    for (const t of types) {
      const d = decideRecovery(t, 0, MAX);
      expect(typeof d.reason).toBe('string');
      expect(d.reason.length).toBeGreaterThan(0);
    }
  });
});

// ── buildRecoveryEvent ─────────────────────────────────────────────────────

describe('buildRecoveryEvent', () => {
  it('returns a valid RecoveryEvent with uuid event_id', () => {
    const ev = buildRecoveryEvent({
      step_index: 3,
      transition_id: 'trans_003',
      failure_type: 'timeout',
      failure_detail: 'Page load timed out',
      action_taken: 'RETRY',
      retry_count: 0
    });
    expect(ev.event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('returns ISO-8601 timestamp', () => {
    const ev = buildRecoveryEvent({
      step_index: 0,
      transition_id: 't0',
      failure_type: 'unknown',
      failure_detail: 'err',
      action_taken: 'ESCALATE',
      retry_count: 0
    });
    expect(() => new Date(ev.timestamp)).not.toThrow();
    expect(new Date(ev.timestamp).toISOString()).toBe(ev.timestamp);
  });

  it('sets resolved=true for RETRY', () => {
    const ev = buildRecoveryEvent({
      step_index: 0, transition_id: 't0', failure_type: 'timeout',
      failure_detail: 'x', action_taken: 'RETRY', retry_count: 0
    });
    expect(ev.resolved).toBe(true);
  });

  it('sets resolved=true for SKIP', () => {
    const ev = buildRecoveryEvent({
      step_index: 0, transition_id: 't0', failure_type: 'unexpected_popup',
      failure_detail: 'x', action_taken: 'SKIP', retry_count: 0
    });
    expect(ev.resolved).toBe(true);
  });

  it('sets resolved=false for ESCALATE', () => {
    const ev = buildRecoveryEvent({
      step_index: 0, transition_id: 't0', failure_type: 'navigation_error',
      failure_detail: 'x', action_taken: 'ESCALATE', retry_count: 0
    });
    expect(ev.resolved).toBe(false);
  });

  it('preserves all provided fields', () => {
    const ev = buildRecoveryEvent({
      step_index: 7,
      transition_id: 'my_trans',
      failure_type: 'state_mismatch',
      failure_detail: 'wrong page',
      action_taken: 'SKIP',
      retry_count: 1
    });
    expect(ev.step_index).toBe(7);
    expect(ev.transition_id).toBe('my_trans');
    expect(ev.failure_type).toBe('state_mismatch');
    expect(ev.failure_detail).toBe('wrong page');
    expect(ev.action_taken).toBe('SKIP');
    expect(ev.retry_count).toBe(1);
  });
});

// ── logRecoveryEvent ───────────────────────────────────────────────────────

describe('logRecoveryEvent', () => {
  const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
  const mockMkdirSync = fs.mkdirSync as jest.MockedFunction<typeof fs.mkdirSync>;
  const mockAppendFileSync = fs.appendFileSync as jest.MockedFunction<typeof fs.appendFileSync>;

  const sampleEvent: RecoveryEvent = {
    event_id: 'test-uuid',
    timestamp: '2026-03-30T10:00:00.000Z',
    step_index: 1,
    transition_id: 'trans_001',
    failure_type: 'timeout',
    failure_detail: 'timed out',
    action_taken: 'RETRY',
    retry_count: 0,
    resolved: true
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => undefined as unknown as ReturnType<typeof fs.mkdirSync>);
    mockAppendFileSync.mockImplementation(() => undefined);
  });

  it('appends JSON line to recovery-log.jsonl in logDir', () => {
    logRecoveryEvent(sampleEvent, '/tmp/wcrs-logs');
    expect(mockAppendFileSync).toHaveBeenCalledWith(
      path.join('/tmp/wcrs-logs', 'recovery-log.jsonl'),
      JSON.stringify(sampleEvent) + '\n',
      'utf-8'
    );
  });

  it('writes valid JSON that can be parsed back', () => {
    let written = '';
    mockAppendFileSync.mockImplementation((_p: unknown, data: unknown) => {
      written = data as string;
    });
    logRecoveryEvent(sampleEvent, '/tmp/wcrs-logs');
    const parsed = JSON.parse(written.trim()) as RecoveryEvent;
    expect(parsed.event_id).toBe('test-uuid');
    expect(parsed.failure_type).toBe('timeout');
  });

  it('creates logDir if it does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    logRecoveryEvent(sampleEvent, '/tmp/new-dir');
    expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/new-dir', { recursive: true });
  });
});
