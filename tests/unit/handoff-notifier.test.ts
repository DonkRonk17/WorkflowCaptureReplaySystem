/**
 * Unit tests — Handoff Notifier (Sprint 4)
 * fs and https are mocked — no real file writes or network calls.
 */

jest.mock('fs', () => {
  const realFs = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...realFs,
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn().mockReturnValue(undefined),
    writeFileSync: jest.fn().mockReturnValue(undefined)
  };
});

jest.mock('https', () => ({
  request: jest.fn()
}));

jest.mock('http', () => ({
  request: jest.fn()
}));

import * as fs from 'fs';
import * as https from 'https';
import { notifyHandoff, type HandoffOptions } from '../../src/runtime/handoff-notifier.js';
import type { ExecutionReport } from '../../src/runtime/reporter.js';

const mockHttpsRequest = https.request as jest.MockedFunction<typeof https.request>;

function makeEscalatedReport(runId = 'run-001'): ExecutionReport {
  return {
    run_id: runId,
    workflow_id: 'cu_workflow',
    started_at: '2026-03-30T10:00:00.000Z',
    completed_at: '2026-03-30T10:01:00.000Z',
    total_duration_ms: 60000,
    status: 'escalated',
    total_steps: 3,
    steps_succeeded: 2,
    steps_recovered: 0,
    steps_skipped: 0,
    steps_failed: 0,
    steps_escalated: 1,
    step_results: [
      {
        step_index: 2,
        transition_id: 'nav_fail',
        action_type: 'navigate',
        started_at: '2026-03-30T10:00:58.000Z',
        completed_at: '2026-03-30T10:01:00.000Z',
        duration_ms: 2000,
        status: 'escalated',
        verification: null,
        recovery_events: []
      }
    ],
    recovery_events: [],
    final_state_id: null,
    escalation_reason: 'Step 2: navigation failed',
    patient_id: 'P001'
  };
}

function makeHandoffOptions(channel: HandoffOptions['channel'], outputDir = '/tmp/handoff-test'): HandoffOptions {
  return { channel, outputDir };
}

// ── channel='file' ─────────────────────────────────────────────────────────

describe('notifyHandoff — channel=file', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockReturnValue(true);
    (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mockReturnValue(undefined);
  });

  it('writes HANDOFF-<run_id>.json to outputDir', async () => {
    const report = makeEscalatedReport('my-run-id');
    await notifyHandoff(report, makeHandoffOptions('file', '/output'));

    const writeFileSyncCalls = (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mock.calls;
    const handoffWrite = writeFileSyncCalls.find(c => String(c[0]).includes('HANDOFF-my-run-id.json'));
    expect(handoffWrite).toBeDefined();
  });

  it('written JSON contains run_id and escalation_reason', async () => {
    const report = makeEscalatedReport('run-abc');
    let capturedJson = '';
    (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mockImplementation((_p: unknown, data: unknown) => {
      if (typeof data === 'string') capturedJson = data as string;
    });

    await notifyHandoff(report, makeHandoffOptions('file'));
    const parsed = JSON.parse(capturedJson);
    expect(parsed.run_id).toBe('run-abc');
    expect(parsed.escalation_reason).toBe('Step 2: navigation failed');
  });
});

// ── channel='console' ─────────────────────────────────────────────────────

describe('notifyHandoff — channel=console', () => {
  it('prints to stdout', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const report = makeEscalatedReport();
    await notifyHandoff(report, makeHandoffOptions('console'));
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('console output mentions run_id', async () => {
    let printed = '';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation((msg: unknown) => {
      printed += String(msg);
    });
    const report = makeEscalatedReport('RUN-XYZ');
    await notifyHandoff(report, makeHandoffOptions('console'));
    expect(printed).toContain('RUN-XYZ');
    consoleSpy.mockRestore();
  });
});

// ── channel='webhook' ─────────────────────────────────────────────────────

describe('notifyHandoff — channel=webhook', () => {
  function setupHttpsMock(_statusCode = 200): void {
    const mockReq = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn()
    };
    (mockHttpsRequest as jest.MockedFunction<(...args: unknown[]) => unknown>).mockImplementation((_opts: unknown, callback?: unknown) => {
      if (typeof callback === 'function') {
        // Simulate response
        const mockRes = { resume: jest.fn() };
        callback(mockRes);
      }
      return mockReq as unknown as ReturnType<typeof https.request>;
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setupHttpsMock();
  });

  it('calls https.request with the correct URL', async () => {
    const report = makeEscalatedReport();
    const opts: HandoffOptions = {
      channel: 'webhook',
      outputDir: '/tmp',
      webhookUrl: 'https://hooks.example.com/notify'
    };
    await notifyHandoff(report, opts);
    expect(mockHttpsRequest).toHaveBeenCalledTimes(1);
    const callArgs = mockHttpsRequest.mock.calls[0]![0] as unknown as { hostname: string; method: string };
    expect(callArgs.hostname).toBe('hooks.example.com');
    expect(callArgs.method).toBe('POST');
  });

  it('does NOT throw when webhook request fails', async () => {
    const mockReq = {
      on: jest.fn().mockImplementation(function(this: unknown, event: string, handler: (err: Error) => void) {
        if (event === 'error') {
          // Immediately call error handler
          setTimeout(() => handler(new Error('ECONNREFUSED')), 0);
        }
        return this;
      }),
      write: jest.fn(),
      end: jest.fn()
    };
    mockHttpsRequest.mockReturnValue(mockReq as unknown as ReturnType<typeof https.request>);

    const report = makeEscalatedReport();
    const opts: HandoffOptions = {
      channel: 'webhook',
      outputDir: '/tmp',
      webhookUrl: 'https://hooks.example.com/fail'
    };
    // Should resolve without throwing
    await expect(notifyHandoff(report, opts)).resolves.toBeUndefined();
  });

  it('does NOT throw when no webhookUrl is provided', async () => {
    const report = makeEscalatedReport();
    const opts: HandoffOptions = { channel: 'webhook', outputDir: '/tmp' };
    await expect(notifyHandoff(report, opts)).resolves.toBeUndefined();
  });
});
