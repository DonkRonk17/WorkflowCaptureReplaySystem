/**
 * Unit tests — SupervisorServer (B-007)
 * ws and http are mocked — no real network sockets opened.
 */

// ── Mock ws ────────────────────────────────────────────────────────────────

const mockClientSend = jest.fn();
const mockWssClients = new Set<{ readyState: number; send: jest.Mock }>();
const mockWssClose = jest.fn((cb?: () => void) => cb?.());
let wssMessageHandler: ((data: Buffer) => void) | null = null;

jest.mock('ws', () => {
  const WebSocketMock = {
    OPEN: 1
  };

  class WebSocketServerMock {
    clients = mockWssClients;
    close = mockWssClose;
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === 'connection') {
        // Simulate one connected client
        const fakeWs = {
          on: (evt: string, h: (data: Buffer) => void) => {
            if (evt === 'message') wssMessageHandler = h;
          }
        };
        handler(fakeWs);
      }
    }
  }

  return { WebSocketServer: WebSocketServerMock, WebSocket: WebSocketMock };
});

// ── Mock http ──────────────────────────────────────────────────────────────

const mockHttpListen = jest.fn((_port: number, cb?: () => void) => cb?.());
const mockHttpClose = jest.fn((cb?: () => void) => cb?.());

jest.mock('http', () => ({
  createServer: jest.fn(() => ({
    listen: mockHttpListen,
    close: mockHttpClose
  }))
}));

// ── Mock fs (dashboard HTML read) ─────────────────────────────────────────

jest.mock('fs', () => {
  const real = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...real,
    readFileSync: jest.fn((p: unknown, enc?: unknown) => {
      if (typeof p === 'string' && p.includes('index.html')) return '<html>dashboard</html>';
      return real.readFileSync(p as string, enc as BufferEncoding);
    })
  };
});

import { SupervisorServer } from '../../src/supervisor/server.js';
import type { StatusUpdate, WorkflowComplete } from '../../src/supervisor/types.js';

function makeStatusUpdate(): StatusUpdate {
  return {
    step_number: 1,
    step_name: 'nav_001',
    state_id: 's1',
    action_type: 'navigate',
    confidence: 0.9,
    status: 'success',
    docs_collected: [],
    docs_remaining: [],
    elapsed_ms: 500
  };
}

function makeWorkflowComplete(): WorkflowComplete {
  return {
    success: true,
    run_id: 'run-001',
    workflow_id: 'wf-001',
    docs_collected: ['FC_2026-03-30.pdf'],
    docs_failed: [],
    total_time_ms: 12000
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SupervisorServer — emitStatusUpdate broadcasts to connected clients', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWssClients.clear();
    mockWssClients.add({ readyState: 1, send: mockClientSend });
    wssMessageHandler = null;
  });

  it('broadcasts status_update message to all OPEN clients', async () => {
    const server = new SupervisorServer(9999);
    server.emitStatusUpdate(makeStatusUpdate());
    expect(mockClientSend).toHaveBeenCalledTimes(1);
    const msg = JSON.parse(mockClientSend.mock.calls[0]![0]);
    expect(msg.type).toBe('status_update');
    expect(msg.payload.step_number).toBe(1);
  });

  it('does NOT send to non-OPEN clients (readyState !== 1)', () => {
    const server = new SupervisorServer(9999);
    mockWssClients.clear();
    mockWssClients.add({ readyState: 3, send: mockClientSend }); // CLOSED
    server.emitStatusUpdate(makeStatusUpdate());
    expect(mockClientSend).not.toHaveBeenCalled();
  });
});

describe('SupervisorServer — emitWorkflowComplete broadcasts correctly', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWssClients.clear();
    mockWssClients.add({ readyState: 1, send: mockClientSend });
  });

  it('broadcasts workflow_complete message', () => {
    const server = new SupervisorServer(9999);
    server.emitWorkflowComplete(makeWorkflowComplete());
    const msg = JSON.parse(mockClientSend.mock.calls[0]![0]);
    expect(msg.type).toBe('workflow_complete');
    expect(msg.payload.success).toBe(true);
    expect(msg.payload.run_id).toBe('run-001');
  });
});

describe('SupervisorServer — emitInterventionRequest resolves on human_response', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWssClients.clear();
    mockWssClients.add({ readyState: 1, send: mockClientSend });
    wssMessageHandler = null;
  });

  it('resolves with the human response when response message arrives', async () => {
    const server = new SupervisorServer(9999, 60000);

    const promise = server.emitInterventionRequest({
      reason: 'state_mismatch',
      current_state: 's0',
      expected_state: 's1',
      failure_detail: 'DOM mismatch',
      options: ['retry', 'skip', 'escalate'],
      screenshot_url: ''
    });

    // Extract the request_id from the broadcast
    const broadcastMsg = JSON.parse(mockClientSend.mock.calls[0]![0]);
    expect(broadcastMsg.type).toBe('intervention_request');
    const requestId = broadcastMsg.payload.request_id;

    // Simulate human clicking Retry
    const responseMsg = JSON.stringify({
      type: 'human_response',
      timestamp: new Date().toISOString(),
      payload: { request_id: requestId, action: 'retry' }
    });
    wssMessageHandler!(Buffer.from(responseMsg));

    const response = await promise;
    expect(response.action).toBe('retry');
    expect(response.request_id).toBe(requestId);
  });

  it('resolves with escalate when timeout fires', async () => {
    jest.useFakeTimers();
    const server = new SupervisorServer(9999, 1000);

    const promise = server.emitInterventionRequest({
      reason: 'timeout',
      current_state: 's0',
      expected_state: 's1',
      failure_detail: 'timed out',
      options: ['escalate'],
      screenshot_url: ''
    });

    jest.advanceTimersByTime(2000);
    const response = await promise;
    expect(response.action).toBe('escalate');
    jest.useRealTimers();
  });
});

describe('SupervisorServer — close() resolves all pending requests and shuts down', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWssClients.clear();
    mockWssClients.add({ readyState: 1, send: mockClientSend });
  });

  it('resolves pending intervention requests as escalate on close()', async () => {
    const server = new SupervisorServer(9999, 60000);

    const promise = server.emitInterventionRequest({
      reason: 'unknown',
      current_state: 's0',
      expected_state: 's1',
      failure_detail: 'test',
      options: ['escalate'],
      screenshot_url: ''
    });

    await server.close();
    const response = await promise;
    expect(response.action).toBe('escalate');
    expect(mockWssClose).toHaveBeenCalled();
    expect(mockHttpClose).toHaveBeenCalled();
  });
});
