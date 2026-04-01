/**
 * WCRS Supervisor Server (B-007)
 * WebSocket + HTTP server that implements SupervisorEmitter.
 * Broadcasts live executor events to the dashboard and awaits human responses.
 *
 * Bible spec (BH-010):
 *   "Human oversight dashboard — current step, confidence, docs, override controls."
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { SupervisorEmitter } from './emitter.js';
import type {
  WSMessage,
  StatusUpdate,
  InterventionRequest,
  HumanResponse,
  WorkflowComplete
} from './types.js';

// ── Constants ──────────────────────────────────────────────────────────────

const DASHBOARD_PATH = path.join(__dirname, 'dashboard', 'index.html');
const DEFAULT_INTERVENTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ── Pending intervention tracking ─────────────────────────────────────────

interface PendingRequest {
  resolve: (response: HumanResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── SupervisorServer ───────────────────────────────────────────────────────

export class SupervisorServer implements SupervisorEmitter {
  private readonly httpServer: http.Server;
  private readonly wss: WebSocketServer;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly interventionTimeoutMs: number;
  readonly port: number;

  constructor(port: number, interventionTimeoutMs = DEFAULT_INTERVENTION_TIMEOUT_MS) {
    this.port = port;
    this.interventionTimeoutMs = interventionTimeoutMs;

    // ── HTTP server: serve dashboard HTML ──────────────────────────────────
    this.httpServer = http.createServer((_req, res) => {
      try {
        const html = fs.readFileSync(DASHBOARD_PATH, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch {
        res.writeHead(404);
        res.end('Dashboard not found');
      }
    });

    // ── WebSocket server ───────────────────────────────────────────────────
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as WSMessage<HumanResponse>;
          if (msg.type === 'human_response') {
            this.handleHumanResponse(msg.payload);
          }
        } catch {
          // Ignore malformed messages
        }
      });
    });
  }

  // ── Start listening ────────────────────────────────────────────────────

  listen(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        console.log(`[WCRS] Supervisor dashboard: http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  // ── SupervisorEmitter implementation ──────────────────────────────────

  emitStatusUpdate(update: StatusUpdate): void {
    this.broadcast({ type: 'status_update', timestamp: new Date().toISOString(), payload: update });
  }

  async emitInterventionRequest(
    request: Omit<InterventionRequest, 'request_id'>
  ): Promise<HumanResponse> {
    const request_id = uuidv4();
    const full: InterventionRequest = { ...request, request_id };

    return new Promise<HumanResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request_id);
        console.warn(`[WCRS] Supervisor: intervention request ${request_id} timed out — escalating`);
        resolve({ request_id, action: 'escalate' });
      }, this.interventionTimeoutMs);

      this.pending.set(request_id, { resolve, timer });
      this.broadcast({ type: 'intervention_request', timestamp: new Date().toISOString(), payload: full });
    });
  }

  emitWorkflowComplete(result: WorkflowComplete): void {
    this.broadcast({ type: 'workflow_complete', timestamp: new Date().toISOString(), payload: result });
  }

  close(): Promise<void> {
    // Resolve all pending requests as escalate before closing
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ request_id: id, action: 'escalate' });
    }
    this.pending.clear();

    return new Promise((resolve) => {
      this.wss.close(() => {
        this.httpServer.close(() => resolve());
      });
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private broadcast(msg: WSMessage): void {
    const json = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(json);
        } catch {
          // Ignore send errors for disconnected clients
        }
      }
    }
  }

  private handleHumanResponse(response: HumanResponse): void {
    const pending = this.pending.get(response.request_id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(response.request_id);
      pending.resolve(response);
    }
  }
}
