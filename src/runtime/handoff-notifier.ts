/**
 * WCRS Handoff Notifier (Sprint 4 — Human Handoff)
 * Sends an escalation notification when the executor reaches an ESCALATE step.
 *
 * Supported channels:
 *   'file'    — Writes <outputDir>/HANDOFF-<run_id>.json
 *   'console' — Prints a formatted block to stdout
 *   'webhook' — POSTs JSON to webhookUrl (Node.js https; no new deps)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import type { ExecutionReport } from './reporter.js';

// ── Public interfaces ──────────────────────────────────────────────────────

export type NotificationChannel = 'file' | 'console' | 'webhook';

export interface HandoffOptions {
  channel: NotificationChannel;
  /** Required when channel === 'file'. */
  outputDir?: string;
  /** Required when channel === 'webhook'. */
  webhookUrl?: string;
}

export interface HandoffNotification {
  event: 'ESCALATED';
  run_id: string;
  workflow_id: string;
  escalation_reason: string;
  patient_id?: string;
  pull_date?: string;
  started_at: string;
  completed_at: string;
  total_steps: number;
  steps_succeeded: number;
  steps_escalated: number;
  final_state_id: string | null;
  notified_at: string;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Notify the configured channel that a workflow has been escalated to a human.
 * Never throws — errors are logged as warnings.
 */
export async function notifyHandoff(
  report: ExecutionReport,
  options: HandoffOptions
): Promise<void> {
  const notification: HandoffNotification = buildNotification(report);

  switch (options.channel) {
    case 'file':
      await notifyFile(notification, options.outputDir ?? './wcrs-output');
      break;
    case 'console':
      notifyConsole(notification);
      break;
    case 'webhook':
      if (options.webhookUrl) {
        await notifyWebhook(notification, options.webhookUrl);
      } else {
        console.warn('[WCRS] handoff-notifier: webhook channel selected but no webhookUrl provided');
      }
      break;
    default:
      console.warn(`[WCRS] handoff-notifier: unknown channel "${(options as HandoffOptions).channel}"`);
  }
}

// ── Private helpers ────────────────────────────────────────────────────────

function buildNotification(report: ExecutionReport): HandoffNotification {
  return {
    event: 'ESCALATED',
    run_id: report.run_id,
    workflow_id: report.workflow_id,
    escalation_reason: report.escalation_reason ?? 'Unknown reason',
    patient_id: report.patient_id,
    pull_date: report.pull_date,
    started_at: report.started_at,
    completed_at: report.completed_at,
    total_steps: report.total_steps,
    steps_succeeded: report.steps_succeeded,
    steps_escalated: report.steps_escalated,
    final_state_id: report.final_state_id,
    notified_at: new Date().toISOString()
  };
}

async function notifyFile(notification: HandoffNotification, outputDir: string): Promise<void> {
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const filePath = path.join(outputDir, `HANDOFF-${notification.run_id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(notification, null, 2), 'utf-8');
    console.log(`[WCRS] Handoff notification written to: ${filePath}`);
  } catch (err) {
    console.warn(`[WCRS] handoff-notifier: failed to write file — ${err instanceof Error ? err.message : String(err)}`);
  }
}

function notifyConsole(notification: HandoffNotification): void {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        WCRS WORKFLOW ESCALATED — HUMAN NEEDED               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Run ID:    ${notification.run_id}`);
  console.log(`  Workflow:  ${notification.workflow_id}`);
  console.log(`  Reason:    ${notification.escalation_reason}`);
  if (notification.patient_id) console.log(`  Patient:   ${notification.patient_id}`);
  if (notification.pull_date)  console.log(`  Pull Date: ${notification.pull_date}`);
  console.log(`  Steps:     ${notification.steps_succeeded}/${notification.total_steps} succeeded`);
  console.log(`  State:     ${notification.final_state_id ?? 'N/A'}`);
  console.log(`  Notified:  ${notification.notified_at}`);
  console.log('');
}

async function notifyWebhook(notification: HandoffNotification, webhookUrl: string): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      const body = JSON.stringify(notification);
      const url = new URL(webhookUrl);
      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const reqOptions: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      const req = transport.request(reqOptions, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 400) {
          console.warn(`[WCRS] handoff-notifier: webhook returned HTTP ${res.statusCode}`);
        } else {
          console.log(`[WCRS] Handoff notification posted to webhook (HTTP ${res.statusCode})`);
        }
        resolve();
      });

      req.on('error', (err) => {
        console.warn(`[WCRS] handoff-notifier: webhook request failed — ${err.message}`);
        resolve();
      });

      req.setTimeout(10_000, () => {
        console.warn('[WCRS] handoff-notifier: webhook request timed out');
        req.destroy();
        resolve();
      });

      req.write(body);
      req.end();
    } catch (err) {
      console.warn(`[WCRS] handoff-notifier: webhook setup failed — ${err instanceof Error ? err.message : String(err)}`);
      resolve();
    }
  });
}
