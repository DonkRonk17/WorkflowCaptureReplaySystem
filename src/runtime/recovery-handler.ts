/**
 * WCRS Recovery Handler (Sprint 3 — Module 8)
 * Handles off-script situations: state verification failure, selector not found,
 * timeout, unexpected popup, navigation error.
 *
 * Bible spec:
 *   "Recovery options: RETRY (try the action again), SKIP (move to next state),
 *    ESCALATE (stop and notify human)."
 *   "Log every recovery event for future graph improvement."
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

// ── Public interfaces ──────────────────────────────────────────────────────

export interface RecoveryEvent {
  event_id: string;               // uuid
  timestamp: string;              // ISO-8601
  step_index: number;
  transition_id: string;
  failure_type: FailureType;
  failure_detail: string;
  action_taken: RecoveryAction;
  retry_count: number;
  resolved: boolean;
}

export type FailureType =
  | 'state_mismatch'
  | 'selector_not_found'
  | 'timeout'
  | 'unexpected_popup'
  | 'navigation_error'
  | 'unknown';

export type RecoveryAction = 'RETRY' | 'SKIP' | 'ESCALATE';

export interface RecoveryDecision {
  action: RecoveryAction;
  reason: string;
  delay_ms: number; // wait before retry; 0 for SKIP/ESCALATE
}

// ── Decision logic ─────────────────────────────────────────────────────────

/**
 * Determine the best recovery action given the failure type and retry history.
 *
 * Decision matrix:
 *   timeout           + retryCount < maxRetries  → RETRY  (delay: 2000 * (retryCount+1))
 *   selector_not_found+ retryCount < maxRetries  → RETRY  (delay: 1000)
 *   state_mismatch    + retryCount === 0          → RETRY  (delay: 2000)
 *   state_mismatch    + retryCount > 0            → SKIP
 *   unexpected_popup  (any count)                 → SKIP
 *   navigation_error  (any count)                 → ESCALATE
 *   retryCount >= maxRetries (any type)            → ESCALATE
 *   unknown           (any count)                 → ESCALATE
 */
export function decideRecovery(
  failureType: FailureType,
  retryCount: number,
  maxRetries: number
): RecoveryDecision {
  // Hard escalation: exhausted retries
  if (retryCount >= maxRetries) {
    return {
      action: 'ESCALATE',
      reason: `Max retries (${maxRetries}) exhausted for ${failureType}`,
      delay_ms: 0
    };
  }

  switch (failureType) {
    case 'timeout':
      return {
        action: 'RETRY',
        reason: `Timeout — retrying (attempt ${retryCount + 1})`,
        delay_ms: 2000 * (retryCount + 1)
      };

    case 'selector_not_found':
      return {
        action: 'RETRY',
        reason: `Selector not found — retrying (attempt ${retryCount + 1})`,
        delay_ms: 1000
      };

    case 'state_mismatch':
      if (retryCount === 0) {
        return {
          action: 'RETRY',
          reason: 'State mismatch — retrying once to allow page to settle',
          delay_ms: 2000
        };
      }
      return {
        action: 'SKIP',
        reason: 'State mismatch after retry — skipping to next step',
        delay_ms: 0
      };

    case 'unexpected_popup':
      return {
        action: 'SKIP',
        reason: 'Unexpected popup — skipping (popup handler should resolve)',
        delay_ms: 0
      };

    case 'navigation_error':
      return {
        action: 'ESCALATE',
        reason: 'Navigation error — cannot continue without human intervention',
        delay_ms: 0
      };

    case 'unknown':
    default:
      return {
        action: 'ESCALATE',
        reason: 'Unknown failure type — escalating for human review',
        delay_ms: 0
      };
  }
}

// ── Event builder ──────────────────────────────────────────────────────────

/**
 * Build a RecoveryEvent with auto-generated uuid and ISO-8601 timestamp.
 */
export function buildRecoveryEvent(params: {
  step_index: number;
  transition_id: string;
  failure_type: FailureType;
  failure_detail: string;
  action_taken: RecoveryAction;
  retry_count: number;
}): RecoveryEvent {
  return {
    event_id: randomUUID(),
    timestamp: new Date().toISOString(),
    step_index: params.step_index,
    transition_id: params.transition_id,
    failure_type: params.failure_type,
    failure_detail: params.failure_detail,
    action_taken: params.action_taken,
    retry_count: params.retry_count,
    resolved: params.action_taken !== 'ESCALATE'
  };
}

// ── Logger ─────────────────────────────────────────────────────────────────

/**
 * Append a recovery event to <logDir>/recovery-log.jsonl (one JSON object per line).
 * Uses synchronous I/O to keep the logger simple and safe in error paths.
 */
export function logRecoveryEvent(event: RecoveryEvent, logDir: string): void {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const logPath = path.join(logDir, 'recovery-log.jsonl');
  fs.appendFileSync(logPath, JSON.stringify(event) + '\n', 'utf-8');
}
