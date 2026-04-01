/**
 * WCRS Supervisor UI — Message Types (B-007)
 * WebSocket message contract between the executor and the dashboard.
 *
 * Bible spec (BH-010):
 *   WebSocket messages carry typed payloads for real-time supervisor oversight.
 */

// ── Envelope ───────────────────────────────────────────────────────────────

export interface WSMessage<T = unknown> {
  type: WSMessageType;
  timestamp: string;
  payload: T;
}

export type WSMessageType =
  | 'status_update'
  | 'intervention_request'
  | 'human_response'
  | 'workflow_complete';

// ── Payload types ──────────────────────────────────────────────────────────

export interface StatusUpdate {
  step_number: number;
  step_name: string;
  state_id: string;
  action_type: string;
  confidence: number;
  status: 'success' | 'recovered' | 'skipped' | 'failed';
  docs_collected: string[];
  docs_remaining: string[];
  elapsed_ms: number;
}

export interface InterventionRequest {
  request_id: string;
  reason: 'timeout' | 'state_mismatch' | 'selector_not_found' | 'navigation_error' | 'unexpected_popup' | 'pdf_fidelity_fail' | 'unknown';
  current_state: string;
  expected_state: string;
  failure_detail: string;
  options: Array<'retry' | 'skip' | 'escalate'>;
  screenshot_url: string;
}

export interface HumanResponse {
  request_id: string;
  action: 'retry' | 'skip' | 'escalate' | 'override';
  override_selector?: string;
}

export interface WorkflowComplete {
  success: boolean;
  run_id: string;
  workflow_id: string;
  docs_collected: string[];
  docs_failed: string[];
  total_time_ms: number;
  escalation_reason?: string;
}
