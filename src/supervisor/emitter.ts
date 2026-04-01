/**
 * WCRS Supervisor Emitter Interface (B-007)
 * Defines the contract the executor uses to communicate with the supervisor.
 * Keeping this as an interface makes the executor unit-testable without
 * a real WebSocket server — tests inject a mock implementation.
 */

import type {
  StatusUpdate,
  InterventionRequest,
  HumanResponse,
  WorkflowComplete
} from './types.js';

// ── Public Interface ───────────────────────────────────────────────────────

export interface SupervisorEmitter {
  /**
   * Broadcast a step status update to all connected dashboard clients.
   * Fire-and-forget — never throws.
   */
  emitStatusUpdate(update: StatusUpdate): void;

  /**
   * Broadcast an intervention request and wait for a human response.
   * Resolves with the HumanResponse when the operator clicks a button.
   * If the timeout expires before a response, resolves with { action: 'escalate' }.
   */
  emitInterventionRequest(
    request: Omit<InterventionRequest, 'request_id'>
  ): Promise<HumanResponse>;

  /**
   * Broadcast workflow completion to all connected dashboard clients.
   * Fire-and-forget — never throws.
   */
  emitWorkflowComplete(result: WorkflowComplete): void;

  /**
   * Shut down the WebSocket + HTTP server.
   */
  close(): Promise<void>;
}
