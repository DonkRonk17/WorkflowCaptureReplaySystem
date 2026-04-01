/**
 * WCRS Human Handoff Notifier (Sprint 4 — Module 13)
 * Emits a human handoff notification when a workflow run is escalated.
 *
 * Supports three channels:
 *   'file'    — write HANDOFF-<run_id>.json to outputDir
 *   'console' — print a formatted block to stdout
 *   'webhook' — POST notification JSON to webhookUrl (never throws)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import type { ExecutionReport } from './reporter.js';

// ── Public Interfaces ──────────────────────────────────────────────────────

export interface HandoffNotification {
  run_id: string;
  workflow_id: string;
  patient_id?: string;
  escalation_reason: string;
  step_index: number;
  timestamp: string;
  report_path: string;
}

export type NotificationChannel = 'file' | 'console' | 'webhook';

export interface HandoffOptions {
  channel: NotificationChannel;
  outputDir: string;
  webhookUrl?: string;   // for channel='webhook'
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Emit a human handoff notification for an escalated workflow run.
 *
 * @param report  - The escalated ExecutionReport
 * @param options - Channel and output configuration
 */
export async function notifyHandoff(
  report: ExecutionReport,
  options: HandoffOptions
): Promise<void> {
  const notification = buildNotification(report, options.outputDir);

  switch (options.channel) {
    case 'file':
      writeFileNotification(notification, options.outputDir);
      break;
    case 'console':
      printConsoleNotification(notification);
      break;
    case 'webhook':
      await postWebhookNotification(notification, options.webhookUrl);
      break;
  }
}

// ── Notification builder ───────────────────────────────────────────────────

function buildNotification(
  report: ExecutionReport,
  outputDir: string
): HandoffNotification {
  // Find the step index of the last escalated step
  let escalatedStep: (typeof report.step_results[number]) | undefined;
  for (let i = report.step_results.length - 1; i >= 0; i--) {
    if (report.step_results[i].status === 'escalated') {
      escalatedStep = report.step_results[i];
      break;
    }
  }
  const stepIndex = escalatedStep?.step_index ?? 0;

  const reportPath = path.join(outputDir, `${report.run_id}.json`);

  return {
    run_id: report.run_id,
    workflow_id: report.workflow_id,
    patient_id: report.patient_id,
    escalation_reason: report.escalation_reason ?? 'Unknown escalation reason',
    step_index: stepIndex,
    timestamp: new Date().toISOString(),
    report_path: reportPath
  };
}

// ── Channel implementations ────────────────────────────────────────────────

function writeFileNotification(
  notification: HandoffNotification,
  outputDir: string
): void {
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const filePath = path.join(outputDir, `HANDOFF-${notification.run_id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(notification, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[WCRS handoff] Failed to write handoff file: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function printConsoleNotification(notification: HandoffNotification): void {
  console.log([
    '',
    '╔══════════════════════════════════════════════════════════╗',
    '║              ⚠  HUMAN HANDOFF REQUIRED  ⚠               ║',
    '╠══════════════════════════════════════════════════════════╣',
    `║  Run ID:    ${notification.run_id.padEnd(44)} ║`,
    `║  Workflow:  ${notification.workflow_id.padEnd(44)} ║`,
    `║  Patient:   ${(notification.patient_id ?? 'N/A').padEnd(44)} ║`,
    `║  Step:      ${String(notification.step_index).padEnd(44)} ║`,
    `║  Time:      ${notification.timestamp.padEnd(44)} ║`,
    `║  Reason:    ${notification.escalation_reason.slice(0, 44).padEnd(44)} ║`,
    `║  Report:    ${notification.report_path.slice(0, 44).padEnd(44)} ║`,
    '╚══════════════════════════════════════════════════════════╝',
    ''
  ].join('\n'));
}

async function postWebhookNotification(
  notification: HandoffNotification,
  webhookUrl?: string
): Promise<void> {
  if (!webhookUrl) {
    console.warn('[WCRS handoff] webhook channel selected but no webhookUrl provided');
    return;
  }

  const body = JSON.stringify(notification);
  const TIMEOUT_MS = 10_000;

  return new Promise<void>((resolve) => {
    try {
      const url = new URL(webhookUrl);
      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const reqOptions = {
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
        // Drain response to free socket
        res.resume();
        resolve();
      });

      const timer = setTimeout(() => {
        req.destroy();
        console.warn('[WCRS handoff] Webhook POST timed out — skipping notification');
        resolve();
      }, TIMEOUT_MS);
      timer.unref(); // don't keep the event loop alive if this is the only active handle

      req.on('error', (err) => {
        clearTimeout(timer);
        console.warn(`[WCRS handoff] Webhook POST failed: ${err.message}`);
        resolve(); // never throw
      });

      req.on('close', () => {
        clearTimeout(timer);
      });

      req.write(body);
      req.end();
    } catch (err) {
      console.warn(`[WCRS handoff] Webhook POST error: ${err instanceof Error ? err.message : String(err)}`);
      resolve(); // never throw
    }
  });
}
