/**
 * WCRS Execution Reporter (Sprint 3 — Module 9)
 * Builds, updates, and writes execution reports after a workflow run.
 *
 * Bible spec:
 *   "Full execution log with per-step status and final outcome."
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { WorkflowContext } from '../types/index.js';
import type { StateVerificationResult } from './state-verifier.js';
import type { RecoveryEvent } from './recovery-handler.js';

// ── Public interfaces ──────────────────────────────────────────────────────

export interface StepResult {
  step_index: number;
  transition_id: string;
  action_type: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  status: StepStatus;
  verification: StateVerificationResult | null;
  recovery_events: RecoveryEvent[];
  screenshot_ref?: string;
}

export type StepStatus = 'success' | 'recovered' | 'skipped' | 'failed' | 'escalated';

export interface ExecutionReport {
  run_id: string;                   // uuid
  workflow_id: string;              // from StateMachineDefinition.id
  started_at: string;               // ISO-8601
  completed_at: string;             // ISO-8601, set by finalizeReport
  total_duration_ms: number;        // set by finalizeReport
  status: RunStatus;
  total_steps: number;
  steps_succeeded: number;
  steps_recovered: number;
  steps_skipped: number;
  steps_failed: number;
  steps_escalated: number;
  step_results: StepResult[];
  recovery_events: RecoveryEvent[];
  final_state_id: string | null;
  escalation_reason?: string;
  patient_id?: string;
  pull_date?: string;
}

export type RunStatus = 'completed' | 'escalated' | 'failed';

// ── Factory / mutators ─────────────────────────────────────────────────────

/**
 * Initialise a new, empty ExecutionReport.
 */
export function createReport(params: {
  workflowId: string;
  startedAt: string;
  context?: Partial<WorkflowContext>;
}): ExecutionReport {
  return {
    run_id: randomUUID(),
    workflow_id: params.workflowId,
    started_at: params.startedAt,
    completed_at: '',
    total_duration_ms: 0,
    status: 'completed',
    total_steps: 0,
    steps_succeeded: 0,
    steps_recovered: 0,
    steps_skipped: 0,
    steps_failed: 0,
    steps_escalated: 0,
    step_results: [],
    recovery_events: [],
    final_state_id: null,
    patient_id: params.context?.patient_id,
    pull_date: params.context?.pull_date
  };
}

/**
 * Append a StepResult to the report and update all counters.
 * If any step is 'escalated', the overall status becomes 'escalated'.
 */
export function addStepResult(report: ExecutionReport, step: StepResult): void {
  report.step_results.push(step);
  report.total_steps++;

  switch (step.status) {
    case 'success':
      report.steps_succeeded++;
      break;
    case 'recovered':
      report.steps_recovered++;
      break;
    case 'skipped':
      report.steps_skipped++;
      break;
    case 'failed':
      report.steps_failed++;
      if (report.status === 'completed') report.status = 'failed';
      break;
    case 'escalated':
      report.steps_escalated++;
      report.status = 'escalated';
      break;
  }

  // Collect recovery events at the report level too
  if (step.recovery_events.length > 0) {
    report.recovery_events.push(...step.recovery_events);
  }
}

/**
 * Set completed_at, total_duration_ms, final_state_id and lock the final status.
 */
export function finalizeReport(report: ExecutionReport, finalStateId: string | null): void {
  report.final_state_id = finalStateId;
  report.completed_at = new Date().toISOString();

  const startMs = new Date(report.started_at).getTime();
  const endMs = new Date(report.completed_at).getTime();
  report.total_duration_ms = isNaN(endMs - startMs) ? 0 : endMs - startMs;
}

// ── Writers ────────────────────────────────────────────────────────────────

/**
 * Write <run_id>.json and <run_id>.md to outputDir.
 */
export async function writeReport(report: ExecutionReport, outputDir: string): Promise<void> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jsonPath = path.join(outputDir, `${report.run_id}.json`);
  const mdPath = path.join(outputDir, `${report.run_id}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(mdPath, formatMarkdown(report), 'utf-8');
}

// ── Markdown formatter ─────────────────────────────────────────────────────

/**
 * Render the execution report as GitHub-flavored Markdown.
 */
export function formatMarkdown(report: ExecutionReport): string {
  const badge = statusBadge(report.status);
  const durationSec = (report.total_duration_ms / 1000).toFixed(1);

  const lines: string[] = [
    `# WCRS Execution Report ${badge}`,
    '',
    `**Run ID:** \`${report.run_id}\`  `,
    `**Workflow:** \`${report.workflow_id}\`  `,
    `**Started:** ${report.started_at}  `,
    `**Completed:** ${report.completed_at}  `,
    `**Duration:** ${durationSec}s  `,
    `**Final State:** ${report.final_state_id ?? 'N/A'}  `,
  ];

  if (report.patient_id) lines.push(`**Patient ID:** ${report.patient_id}  `);
  if (report.pull_date) lines.push(`**Pull Date:** ${report.pull_date}  `);
  if (report.escalation_reason) lines.push(`**Escalation Reason:** ${report.escalation_reason}  `);

  lines.push('', '## Summary', '');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Steps | ${report.total_steps} |`);
  lines.push(`| Succeeded | ${report.steps_succeeded} |`);
  lines.push(`| Recovered | ${report.steps_recovered} |`);
  lines.push(`| Skipped | ${report.steps_skipped} |`);
  lines.push(`| Failed | ${report.steps_failed} |`);
  lines.push(`| Escalated | ${report.steps_escalated} |`);

  if (report.step_results.length > 0) {
    lines.push('', '## Step Results', '');
    lines.push('| # | Transition | Action | Status | Duration | Confidence |');
    lines.push('|---|------------|--------|--------|----------|------------|');
    for (const step of report.step_results) {
      const conf = step.verification ? step.verification.confidence.toFixed(2) : '-';
      const dur = `${step.duration_ms}ms`;
      lines.push(
        `| ${step.step_index} | \`${step.transition_id}\` | ${step.action_type} | ${step.status} | ${dur} | ${conf} |`
      );
    }
  }

  if (report.recovery_events.length > 0) {
    lines.push('', '## Recovery Events', '');
    for (const ev of report.recovery_events) {
      lines.push(`- **[${ev.action_taken}]** Step ${ev.step_index} — \`${ev.failure_type}\`: ${ev.failure_detail}`);
    }
  }

  return lines.join('\n') + '\n';
}

// ── Helpers ────────────────────────────────────────────────────────────────

function statusBadge(status: RunStatus): string {
  switch (status) {
    case 'completed': return '✅ COMPLETED';
    case 'escalated': return '🚨 ESCALATED';
    case 'failed':    return '❌ FAILED';
  }
}
