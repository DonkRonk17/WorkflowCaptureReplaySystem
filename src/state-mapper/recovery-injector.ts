/**
 * WCRS Recovery Injector (Module 2 — UI State Mapper)
 * Augments a state machine definition with recovery paths, timeouts,
 * and a global human intervention state.
 *
 * Bible spec:
 *   "Every state in the graph MUST have a recovery path."
 *   "Recovery options: RETRY (try the action again), SKIP (move to next state),
 *    ESCALATE (stop and notify human)."
 *   "Log every recovery event for future graph improvement."
 *
 * Implementation note from Bug Hunt (BH-007):
 *   "Set step-specific timeout overrides in config, default 60s in runtime config."
 *   MAR/TAR steps need 90-second timeout to handle async report generation.
 */

import type { StateMachineDefinition, XStateNode } from '../types/index.js';

export interface RecoveryConfig {
  /** Default timeout per state in ms (default: 60000) */
  defaultTimeout?: number;
  /** Per-state timeout overrides: stateId -> timeout in ms */
  stateTimeouts?: Record<string, number>;
  /** Max retries before escalating to human (default: 2) */
  maxRetries?: number;
  /** Whether to add SKIP transitions to the next logical state */
  addSkipTransitions?: boolean;
}

/** States that are already recovery/terminal states and should not get additional recovery */
const SKIP_RECOVERY_TYPES = new Set(['human_intervention', 'error']);

/**
 * Inject recovery states, timeout transitions, and the global human
 * intervention state into a StateMachineDefinition.
 *
 * @param machine - The base machine to augment (mutated in place + returned)
 * @param config - Recovery configuration
 * @returns The augmented machine definition
 */
export function injectRecoveryStates(
  machine: StateMachineDefinition,
  config: RecoveryConfig = {}
): StateMachineDefinition {
  const defaultTimeout = config.defaultTimeout ?? 60000;
  const stateTimeouts = config.stateTimeouts ?? { mar_tar: 90000 };
  const maxRetries = config.maxRetries ?? 2;
  const addSkip = config.addSkipTransitions ?? true;

  // Add global human intervention state
  machine.states['human_intervention'] = buildHumanInterventionState();

  // Add context fields for retry tracking
  machine.context = {
    ...machine.context,
    retry_count: 0,
    max_retries: maxRetries,
    current_state: null,
    last_error: null
  };

  // Collect state IDs first (avoid modifying map while iterating)
  const stateIds = Object.keys(machine.states);

  for (const stateId of stateIds) {
    if (SKIP_RECOVERY_TYPES.has(stateId)) continue;
    const state = machine.states[stateId];
    if (state.type === 'final') continue;

    const timeout = stateTimeouts[stateId] ?? getTimeoutForState(stateId, stateTimeouts, defaultTimeout);
    const recoveryStateId = `${stateId}_recovery`;

    // Add timeout transition to recovery state
    state.after = {
      ...state.after,
      [timeout]: {
        target: recoveryStateId,
        actions: ['logTimeout', 'incrementRetryCount']
      }
    };

    // Add recovery state
    const nextStateId = getNextState(stateId, machine) || 'human_intervention';
    machine.states[recoveryStateId] = buildRecoveryState(stateId, nextStateId, addSkip, state);
  }

  return machine;
}

// ── State Builders ─────────────────────────────────────────────────────────

function buildRecoveryState(
  parentStateId: string,
  nextStateId: string,
  addSkip: boolean,
  parentState: XStateNode
): XStateNode {
  const displayTitle = parentState.meta?.title || parentStateId.replace(/_/g, ' ');

  const transitions: XStateNode['on'] = {
    RETRY: {
      target: parentStateId,
      actions: ['logRetry', 'resetRetryCount']
    },
    ESCALATE: {
      target: 'human_intervention',
      actions: ['logEscalation', 'notifyHuman']
    }
  };

  if (addSkip) {
    transitions['SKIP'] = {
      target: nextStateId,
      actions: ['logSkip']
    };
  }

  return {
    on: transitions,
    meta: {
      recovery: true,
      title: `Recovery: ${displayTitle}`,
      message: `Stuck at "${displayTitle}". Choose: RETRY to try again, SKIP to continue, or ESCALATE to notify a human supervisor.`,
      notify: false
    }
  };
}

function buildHumanInterventionState(): XStateNode {
  return {
    type: 'final',
    meta: {
      recovery: true,
      title: 'Human Intervention Required',
      message: 'Workflow paused. A human supervisor must review and resume or abort the workflow.',
      notify: true
    }
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Attempt to find the "next" state in the workflow after the given state.
 * Uses alphabetical ordering of state IDs as a proxy for sequence.
 * A more accurate implementation would use transition analysis.
 */
function getNextState(stateId: string, machine: StateMachineDefinition): string | null {
  // Find states reachable from the current state
  const reachable: string[] = [];
  for (const [sid, state] of Object.entries(machine.states)) {
    if (sid === stateId || sid.endsWith('_recovery') || sid === 'human_intervention') continue;
    if (state.on) {
      for (const transition of Object.values(state.on)) {
        const targets = Array.isArray(transition) ? transition : [transition];
        for (const t of targets) {
          if (t.target === stateId) {
            // This state transitions TO stateId, so we need states that stateId goes to
          }
        }
      }
    }
  }

  // Simpler: find any state that is a direct successor via transitions
  const current = machine.states[stateId];
  if (current?.on) {
    const targets = Object.values(current.on).flatMap(t => {
      const arr = Array.isArray(t) ? t : [t];
      return arr.map(x => x.target).filter((id): id is string => !!id && !id.endsWith('_recovery'));
    });
    if (targets.length > 0) return targets[0] ?? null;
  }

  return null;
}

/**
 * Resolve timeout for a state, checking for PCC-specific patterns.
 */
function getTimeoutForState(
  stateId: string,
  overrides: Record<string, number>,
  defaultTimeout: number
): number {
  // MAR/TAR states get extended timeout
  if (/mar|tar|medication_administration/i.test(stateId)) {
    return overrides['mar_tar'] ?? 90000;
  }
  // Report generation states get slightly more time
  if (/report|generate|print/i.test(stateId)) {
    return overrides['report'] ?? 75000;
  }
  return defaultTimeout;
}
