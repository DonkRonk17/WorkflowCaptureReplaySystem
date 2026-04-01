/**
 * WCRS Workflow Executor (Sprint 3 — Module 10)
 * Main execution engine: drives Playwright through a StateMachineDefinition,
 * step by step, with verification and recovery at each step.
 *
 * Bible spec (Mission Statement):
 *   "human interaction → semantic action → app state transition →
 *    validation rule → document artifact check → recovery path"
 *
 * NOTE: Playwright's Page is accepted via ExecutorContext — NOT imported at
 * module level — so unit tests can mock it with plain jest.fn() objects.
 */

import type {
  StateMachineDefinition,
  TraceTransition,
  ActionEvent,
  SelectorCandidate,
  WorkflowContext
} from '../types/index.js';
import type { StateGraph } from '../state-mapper/graph-builder.js';
import { verifyState, type VerifierPage } from './state-verifier.js';
import {
  decideRecovery,
  buildRecoveryEvent,
  logRecoveryEvent,
  type RecoveryEvent,
  type FailureType
} from './recovery-handler.js';
import {
  createReport,
  addStepResult,
  finalizeReport,
  writeReport,
  type ExecutionReport,
  type StepResult
} from './reporter.js';
import { checkPdfAfterPrint, type PdfCheckOptions } from './pdf-hook.js';
import { checkRulesAfterStep } from './rules-hook.js';
import { notifyHandoff, type HandoffOptions } from './handoff-notifier.js';
import { validatePacket } from './packet-validator.js';

// ── Public interfaces ──────────────────────────────────────────────────────

export interface ExecutorOptions {
  maxRetries?: number;           // default 2
  stepTimeoutMs?: number;        // default 60000
  marTarTimeoutMs?: number;      // default 90000 (BH-007)
  screenshotOnFailure?: boolean; // default true
  outputDir?: string;            // for report + recovery log
  dryRun?: boolean;              // log actions but don't click
  pdfCheck?: PdfCheckOptions;    // Sprint 4: PDF fidelity check after print steps
  rulesCheck?: { enabled: boolean; rulesPath?: string };  // Sprint 4: rules eval after doc steps
  handoff?: HandoffOptions;      // Sprint 4: human handoff notification on escalation
}

/** Minimal subset of Playwright's Page that the executor needs. */
export interface ExecutorPage extends VerifierPage {
  goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  locator(selector: string): {
    click(opts?: Record<string, unknown>): Promise<void>;
    fill(value: string, opts?: Record<string, unknown>): Promise<void>;
    selectOption(value: string, opts?: Record<string, unknown>): Promise<unknown>;
    count(): Promise<number>;
  };
  keyboard: {
    press(key: string): Promise<void>;
  };
  waitForTimeout(ms: number): Promise<void>;
  screenshot(opts: { path: string }): Promise<Buffer | void>;
  evaluate<T>(fn: () => T): Promise<T>;
  pdf(): Promise<Buffer>;
}

export interface ExecutorContext {
  page: ExecutorPage;
  machine: StateMachineDefinition;
  graph: StateGraph;
  options: ExecutorOptions;
  workflowContext: WorkflowContext;
  actions?: ActionEvent[]; // original trace actions for input_value lookup
}

// ── Selector strategy ordering ─────────────────────────────────────────────

const STRATEGY_PRIORITY: Record<string, number> = {
  role: 5,
  testId: 4,
  text: 3,
  attribute: 2,
  css: 1
};

// ── WorkflowExecutor ───────────────────────────────────────────────────────

// Required base options (Sprint 3 fields with defaults)
type RequiredBaseOptions = Required<Pick<ExecutorOptions,
  'maxRetries' | 'stepTimeoutMs' | 'marTarTimeoutMs' | 'screenshotOnFailure' | 'outputDir' | 'dryRun'
>>;

export class WorkflowExecutor {
  private readonly ctx: ExecutorContext;
  private readonly opts: RequiredBaseOptions;

  constructor(ctx: ExecutorContext) {
    this.ctx = ctx;
    this.opts = {
      maxRetries: ctx.options.maxRetries ?? 2,
      stepTimeoutMs: ctx.options.stepTimeoutMs ?? 60_000,
      marTarTimeoutMs: ctx.options.marTarTimeoutMs ?? 90_000,
      screenshotOnFailure: ctx.options.screenshotOnFailure ?? true,
      outputDir: ctx.options.outputDir ?? './wcrs-output',
      dryRun: ctx.options.dryRun ?? false
    };
  }

  // ── Main entry point ─────────────────────────────────────────────────────

  async run(): Promise<ExecutionReport> {
    const startedAt = new Date().toISOString();
    const report = createReport({
      workflowId: this.ctx.machine.id,
      startedAt,
      context: this.ctx.workflowContext
    });

    const transitions = this.ctx.graph.transitions;
    let finalStateId: string | null = null;
    let escalationReason: string | undefined;

    for (let i = 0; i < transitions.length; i++) {
      const transition = transitions[i]!;
      const stepStarted = new Date().toISOString();
      const stepStartMs = Date.now();

      const stepResult = await this.executeStep(transition, i, stepStarted);
      stepResult.duration_ms = Date.now() - stepStartMs;
      stepResult.completed_at = new Date().toISOString();

      addStepResult(report, stepResult);
      finalStateId = transition.to;

      if (stepResult.status === 'escalated') {
        const lastRecov = stepResult.recovery_events[stepResult.recovery_events.length - 1];
        escalationReason = lastRecov
          ? `Step ${i}: ${lastRecov.failure_detail}`
          : `Step ${i} escalated`;
        report.escalation_reason = escalationReason;
        break;
      }
    }

    // ── Packet validation ────────────────────────────────────────────────
    try {
      report.packet_validation = validatePacket(this.ctx.workflowContext);
    } catch (_) {
      // packet validation failure should not crash the executor
    }

    finalizeReport(report, finalStateId);

    if (this.opts.outputDir) {
      try {
        await writeReport(report, this.opts.outputDir);
      } catch (_) {
        // report writing failure should not crash the executor
      }
    }

    // ── Human handoff notification ────────────────────────────────────────
    if (report.status === 'escalated' && this.ctx.options.handoff) {
      try {
        await notifyHandoff(report, this.ctx.options.handoff);
      } catch (_) {
        // notification failure should not crash the executor
      }
    }

    return report;
  }

  // ── Step execution with retry/recovery loop ──────────────────────────────

  private async executeStep(
    transition: TraceTransition,
    stepIndex: number,
    startedAt: string
  ): Promise<StepResult> {
    const recoveryEvents: RecoveryEvent[] = [];
    let retryCount = 0;
    let lastFailureDetail = '';
    let screenshotRef: string | undefined;

    while (retryCount <= this.opts.maxRetries) {
      // ── Execute action ─────────────────────────────────────────────────
      let actionError: Error | null = null;
      let failureType: FailureType = 'unknown';

      try {
        await this.executeAction(transition);
      } catch (err) {
        actionError = err instanceof Error ? err : new Error(String(err));
        lastFailureDetail = actionError.message;
        failureType = classifyError(actionError);

        if (this.opts.screenshotOnFailure && !this.opts.dryRun) {
          screenshotRef = await this.captureScreenshot(stepIndex);
        }
      }

      // ── Verify state (only when action succeeded) ──────────────────────
      let verificationResult = null;
      if (!actionError) {
        const expectedToState = this.ctx.graph.states.get(transition.to);
        if (expectedToState) {
          try {
            verificationResult = await verifyState(
              this.ctx.page,
              expectedToState,
              transition
            );
          } catch (err) {
            // verifyState should never throw, but be safe
            verificationResult = null;
          }

          if (verificationResult && !verificationResult.passed) {
            failureType = 'state_mismatch';
            lastFailureDetail = verificationResult.failure_reason ?? 'State verification failed';
            actionError = new Error(lastFailureDetail);

            if (this.opts.screenshotOnFailure && !this.opts.dryRun) {
              screenshotRef = screenshotRef ?? await this.captureScreenshot(stepIndex);
            }
          }
        }
      }

      // ── Success path ───────────────────────────────────────────────────
      if (!actionError) {
        const status: StepResult['status'] = recoveryEvents.length > 0 ? 'recovered' : 'success';
        const stepResult: StepResult = {
          step_index: stepIndex,
          transition_id: transition.id,
          action_type: transition.action_type,
          started_at: startedAt,
          completed_at: '',   // set by caller
          duration_ms: 0,     // set by caller
          status,
          verification: verificationResult,
          recovery_events: recoveryEvents,
          screenshot_ref: screenshotRef
        };

        // ── PDF check hook (after print actions) ─────────────────────────
        if (transition.action_type === 'print' && this.ctx.options.pdfCheck) {
          try {
            stepResult.pdf_check = await checkPdfAfterPrint(
              this.ctx.page,
              transition,
              this.ctx.options.pdfCheck
            );
          } catch (_) {
            // hook failure should not crash the executor
          }
        }

        // ── Rules check hook (after download/print actions) ──────────────
        if (
          (transition.action_type === 'download' || transition.action_type === 'print') &&
          this.ctx.options.rulesCheck?.enabled
        ) {
          try {
            stepResult.rules_check = checkRulesAfterStep(
              this.ctx.workflowContext,
              this.ctx.options.rulesCheck.rulesPath
            );
          } catch (_) {
            // hook failure should not crash the executor
          }
        }

        return stepResult;
      }

      // ── Recovery decision ──────────────────────────────────────────────
      const decision = decideRecovery(failureType, retryCount, this.opts.maxRetries);

      const recoveryEvent = buildRecoveryEvent({
        step_index: stepIndex,
        transition_id: transition.id,
        failure_type: failureType,
        failure_detail: lastFailureDetail,
        action_taken: decision.action,
        retry_count: retryCount
      });
      recoveryEvents.push(recoveryEvent);

      if (this.opts.outputDir) {
        try {
          logRecoveryEvent(recoveryEvent, this.opts.outputDir);
        } catch (_) { /* log failure should not crash */ }
      }

      if (decision.action === 'ESCALATE') {
        return {
          step_index: stepIndex,
          transition_id: transition.id,
          action_type: transition.action_type,
          started_at: startedAt,
          completed_at: '',
          duration_ms: 0,
          status: 'escalated',
          verification: null,
          recovery_events: recoveryEvents,
          screenshot_ref: screenshotRef
        };
      }

      if (decision.action === 'SKIP') {
        return {
          step_index: stepIndex,
          transition_id: transition.id,
          action_type: transition.action_type,
          started_at: startedAt,
          completed_at: '',
          duration_ms: 0,
          status: 'skipped',
          verification: null,
          recovery_events: recoveryEvents,
          screenshot_ref: screenshotRef
        };
      }

      // RETRY — wait then loop
      if (decision.delay_ms > 0 && !this.opts.dryRun) {
        await new Promise(resolve => setTimeout(resolve, decision.delay_ms));
      }
      retryCount++;
    }

    // Should not reach here (maxRetries path handled by decideRecovery), but be safe
    return {
      step_index: stepIndex,
      transition_id: transition.id,
      action_type: transition.action_type,
      started_at: startedAt,
      completed_at: '',
      duration_ms: 0,
      status: 'escalated',
      verification: null,
      recovery_events: recoveryEvents,
      screenshot_ref: screenshotRef
    };
  }

  // ── Action dispatch ──────────────────────────────────────────────────────

  /**
   * Dispatch to the correct Playwright call based on action_type.
   * Tries selectors in resilience order; throws if all fail.
   * In dryRun mode logs but does not call Playwright.
   */
  async executeAction(transition: TraceTransition): Promise<void> {
    const { action_type, selectors } = transition;

    // Resolve input_value from original actions if available
    const inputValue = this.resolveInputValue(transition);

    if (this.opts.dryRun) {
      const sel = selectors.length > 0 ? this.selectBestSelector(selectors) : '(no selector)';
      console.log(`[WCRS DRY RUN] Would ${action_type} [${sel}]${inputValue ? ` with "${inputValue}"` : ''}`);
      return;
    }

    const page = this.ctx.page;

    switch (action_type) {
      case 'navigate': {
        const url =
          inputValue ??
          transition.selectors[0]?.selector ??
          this.ctx.graph.states.get(transition.to)?.url_pattern ??
          '';
        if (!url) {
          throw new Error(
            'WCRS Executor: navigate action has no URL (missing input_value, selectors, and target state url_pattern)'
          );
        }
        await page.goto(url, { timeout: this.getStepTimeout(transition) });
        return;
      }

      case 'click': {
        const sel = this.selectBestSelector(selectors);
        await this.tryLocatorAction(selectors, async (selector) => {
          await page.locator(selector).click({ timeout: this.getStepTimeout(transition) });
        }, sel);
        return;
      }

      case 'type': {
        await this.tryLocatorAction(selectors, async (selector) => {
          await page.locator(selector).fill(inputValue ?? '', { timeout: this.getStepTimeout(transition) });
        });
        return;
      }

      case 'select': {
        await this.tryLocatorAction(selectors, async (selector) => {
          await page.locator(selector).selectOption(inputValue ?? '', { timeout: this.getStepTimeout(transition) });
        });
        return;
      }

      case 'keydown': {
        await page.keyboard.press(inputValue ?? '');
        return;
      }

      case 'wait': {
        const ms = parseInt(inputValue ?? '1000', 10);
        await page.waitForTimeout(isNaN(ms) ? 1000 : ms);
        return;
      }

      case 'print': {
        try {
          await page.pdf();
        } catch (_) {
          // pdf() may not be available in headed mode — fall back to window.print
          await page.evaluate(() => (globalThis as unknown as { window?: { print(): void } }).window?.print?.());
        }
        return;
      }

      default: {
        console.log(`[WCRS] Unsupported action_type "${action_type}" — skipping`);
        return;
      }
    }
  }

  // ── Selector helpers ─────────────────────────────────────────────────────

  /**
   * Return the selector string with the highest resilience score.
   * Prefers 'role' > 'testId' > 'text' > 'attribute' > 'css'.
   */
  selectBestSelector(selectors: SelectorCandidate[]): string {
    if (selectors.length === 0) return '';

    const sorted = [...selectors].sort((a, b) => {
      const priA = STRATEGY_PRIORITY[a.strategy] ?? 0;
      const priB = STRATEGY_PRIORITY[b.strategy] ?? 0;
      if (priB !== priA) return priB - priA;
      return b.resilience - a.resilience;
    });

    return sorted[0]!.selector;
  }

  /**
   * Try each selector candidate in order until one resolves; then run the action.
   * Throws if no selector resolves.
   */
  private async tryLocatorAction(
    selectors: SelectorCandidate[],
    action: (selector: string) => Promise<void>,
    _bestSel?: string
  ): Promise<void> {
    if (selectors.length === 0) {
      throw new Error('No selectors available for action');
    }

    const sorted = [...selectors].sort((a, b) => {
      const priA = STRATEGY_PRIORITY[a.strategy] ?? 0;
      const priB = STRATEGY_PRIORITY[b.strategy] ?? 0;
      if (priB !== priA) return priB - priA;
      return b.resilience - a.resilience;
    });

    const errors: string[] = [];
    for (const candidate of sorted) {
      try {
        const count = await this.ctx.page.locator(candidate.selector).count();
        if (count > 0) {
          await action(candidate.selector);
          return;
        }
      } catch (err) {
        errors.push(`${candidate.selector}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    throw new Error(`selector_not_found: tried ${sorted.length} selectors — ${errors.join(' | ')}`);
  }

  // ── Timeout helper ───────────────────────────────────────────────────────

  /**
   * Return marTarTimeoutMs for MAR/TAR transitions, else stepTimeoutMs.
   * BH-007: medication administration records need extra time.
   */
  getStepTimeout(transition: TraceTransition): number {
    if (/mar|tar|medication_administration/i.test(transition.id)) {
      return this.opts.marTarTimeoutMs;
    }
    return this.opts.stepTimeoutMs;
  }

  // ── Input value resolution ───────────────────────────────────────────────

  /**
   * Look up the input_value for a transition from the original ActionEvent array.
   * Matches by action_type; when multiple candidates share the same type, disambiguates
   * by matching the action's state_before URL against the from-state's url_pattern,
   * then falls back to the first candidate.
   */
  private resolveInputValue(transition: TraceTransition): string | null {
    const actions = this.ctx.actions;
    if (!actions || actions.length === 0) return null;

    const candidates = actions.filter(a => a.action_type === transition.action_type);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0]?.input_value ?? null;

    // Multiple candidates: try to disambiguate by matching the action's recorded
    // state_before URL against the from-state's url_pattern in the graph.
    const fromState = this.ctx.graph.states.get(transition.from);
    if (fromState?.url_pattern) {
      const byFromUrl = candidates.find(a => {
        const beforeUrl = a.state_before?.url ?? '';
        return (
          beforeUrl === fromState.url_pattern ||
          beforeUrl.includes(fromState.url_pattern)
        );
      });
      if (byFromUrl && byFromUrl.input_value != null) return byFromUrl.input_value;
    }

    // Last resort: preserve previous behavior and take the first candidate.
    return candidates[0]?.input_value ?? null;
  }

  // ── Screenshot ───────────────────────────────────────────────────────────

  private async captureScreenshot(stepIndex: number): Promise<string | undefined> {
    try {
      const screenshotPath = `${this.opts.outputDir}/step-${stepIndex}-fail.png`;
      await this.ctx.page.screenshot({ path: screenshotPath });
      return screenshotPath;
    } catch (_) {
      return undefined;
    }
  }
}

// ── Error classification ───────────────────────────────────────────────────

function classifyError(err: Error): FailureType {
  const msg = err.message.toLowerCase();
  if (msg.includes('selector_not_found') || msg.includes('no selectors')) return 'selector_not_found';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
  if (msg.includes('navigation') || msg.includes('net::err') || msg.includes('failed to navigate')) return 'navigation_error';
  if (msg.includes('popup') || msg.includes('dialog')) return 'unexpected_popup';
  if (msg.includes('state') || msg.includes('verification')) return 'state_mismatch';
  return 'unknown';
}
