#!/usr/bin/env node
/**
 * WCRS CLI
 * Entry point for the wcrs command-line tool.
 *
 * Usage:
 *   wcrs map --traces ./traces/ --output ./graphs/cu_workflow.json
 *   wcrs validate --trace ./traces/cu_001.json
 *   wcrs merge --traces ./traces/ --output ./traces/merged.json
 */

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import type { WorkflowTrace } from './types/index.js';
import { buildAndExportXState, buildGraph } from './state-mapper/graph-builder.js';
import { serializeMachine, generateStatelyUrl } from './state-mapper/xstate-export.js';
import { WorkflowExecutor, type ExecutorPage } from './runtime/executor.js';

const VERSION = '1.0.0';

program
  .name('wcrs')
  .description('Workflow Capture + Replay System — CLI')
  .version(VERSION);

// ── map command ────────────────────────────────────────────────────────────

program
  .command('map')
  .description('Build a state graph from one or more workflow traces')
  .requiredOption('-t, --traces <path>', 'Path to trace file or directory containing trace files')
  .option('-o, --output <path>', 'Output path for workflow_graph.json', './workflow_graph.json')
  .option('--machine-id <id>', 'XState machine ID', 'cu_workflow')
  .option('--min-confidence <n>', 'Minimum edge confidence threshold (0-1)', '0.1')
  .option('--normalize-urls', 'Strip patient-specific URL params for state identity', false)
  .option('--no-recovery', 'Skip injecting recovery states')
  .option('--stately', 'Print Stately.ai visualization URL after build')
  .action(async (options) => {
    try {
      console.log('[WCRS] Loading traces...');
      const traces = loadTraces(options.traces);

      if (traces.length === 0) {
        console.error('[WCRS] Error: No valid trace files found at', options.traces);
        process.exit(1);
      }

      console.log(`[WCRS] Processing ${traces.length} trace(s)...`);

      const machine = buildAndExportXState(traces, {
        minConfidence: parseFloat(options.minConfidence),
        normalizeUrlParams: options.normalizeUrls ?? false,
      }, {
        machineId: options.machineId,
        addRecoveryStates: options.recovery !== false,
      });

      const outputPath = path.resolve(options.output);
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      fs.writeFileSync(outputPath, serializeMachine(machine), 'utf-8');

      console.log(`[WCRS] ✓ Graph written to: ${outputPath}`);
      console.log(`[WCRS]   States:      ${Object.keys(machine.states).length}`);

      if (options.stately) {
        const url = generateStatelyUrl(machine);
        console.log(`[WCRS]   Stately.ai:  ${url.slice(0, 80)}...`);
      }
    } catch (err) {
      console.error('[WCRS] Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ── validate command ───────────────────────────────────────────────────────

program
  .command('validate')
  .description('Validate a workflow trace JSON file')
  .requiredOption('-t, --trace <path>', 'Path to workflow_trace.json')
  .action((options) => {
    try {
      const tracePath = path.resolve(options.trace);
      if (!fs.existsSync(tracePath)) {
        console.error('[WCRS] Error: File not found:', tracePath);
        process.exit(1);
      }

      const raw = fs.readFileSync(tracePath, 'utf-8');
      const trace = JSON.parse(raw) as WorkflowTrace;

      const errors: string[] = [];
      if (!trace.trace_id) errors.push('Missing trace_id');
      if (!trace.recorded_at) errors.push('Missing recorded_at');
      if (!Array.isArray(trace.actions)) errors.push('actions must be an array');
      else {
        let i = 0;
        for (const action of trace.actions) {
          if (!action.seq) errors.push(`actions[${i}]: missing seq`);
          if (!action.timestamp) errors.push(`actions[${i}]: missing timestamp`);
          if (!action.action_type) errors.push(`actions[${i}]: missing action_type`);
          i++;
        }
      }

      if (errors.length === 0) {
        console.log(`[WCRS] ✓ Trace is valid: ${trace.trace_id}`);
        console.log(`[WCRS]   Actions: ${trace.actions?.length}`);
        console.log(`[WCRS]   App:     ${trace.target_app}`);
      } else {
        console.error('[WCRS] ✗ Trace validation failed:');
        errors.forEach(e => console.error('  -', e));
        process.exit(1);
      }
    } catch (err) {
      console.error('[WCRS] Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ── merge command ──────────────────────────────────────────────────────────

program
  .command('merge')
  .description('Merge multiple trace files into one')
  .requiredOption('-t, --traces <path>', 'Directory containing trace JSON files')
  .option('-o, --output <path>', 'Output path for merged trace', './merged_trace.json')
  .action((options) => {
    try {
      const traces = loadTraces(options.traces);
      if (traces.length === 0) {
        console.error('[WCRS] Error: No traces found');
        process.exit(1);
      }

      const merged: WorkflowTrace = {
        trace_id: `merged_${Date.now()}`,
        wcrs_version: VERSION,
        recorded_at: traces[0]!.recorded_at,
        stopped_at: traces[traces.length - 1]!.stopped_at ?? null,
        target_app: traces[0]!.target_app,
        action_count: 0,
        source_traces: traces.map(t => t.trace_id),
        errors: [],
        actions: []
      };

      let seq = 1;
      for (const trace of traces) {
        for (const action of trace.actions) {
          merged.actions.push({ ...action, seq: seq++ });
        }
      }
      merged.action_count = merged.actions.length;

      const outputPath = path.resolve(options.output);
      fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2), 'utf-8');
      console.log(`[WCRS] ✓ Merged ${traces.length} traces (${merged.action_count} actions) → ${outputPath}`);
    } catch (err) {
      console.error('[WCRS] Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ── run command ────────────────────────────────────────────────────────────

program
  .command('run')
  .description('Execute a recorded workflow trace against a live browser')
  .argument('<trace-file>', 'Path to workflow_trace.json to replay')
  .option('-o, --output <dir>', 'Output directory for report', './wcrs-output')
  .option('--dry-run', 'Log actions but do not interact with the browser', false)
  .option('--max-retries <n>', 'Max retries per step', '2')
  .option('--timeout <ms>', 'Step timeout in ms', '60000')
  .option('--pdf-check', 'Enable PDF fidelity check after print steps', false)
  .option('--rules-check', 'Enable CU rules evaluation after document steps', false)
  .option('--handoff-file', 'Write HANDOFF file on escalation (opt-in)')
  .option('--handoff-webhook <url>', 'POST escalation notification to webhook URL')
  .option('--supervisor [port]', 'Start real-time supervisor dashboard (default port: 9999)')
  .action(async (traceFile: string, options: {
    output: string;
    dryRun: boolean;
    maxRetries: string;
    timeout: string;
    pdfCheck: boolean;
    rulesCheck: boolean;
    handoffFile: boolean;
    handoffWebhook?: string;
    supervisor?: string | boolean;
  }) => {
    try {
      const tracePath = path.resolve(traceFile);
      if (!fs.existsSync(tracePath)) {
        console.error('[WCRS] Error: Trace file not found:', tracePath);
        process.exit(1);
      }

      const raw = fs.readFileSync(tracePath, 'utf-8');
      const trace = JSON.parse(raw) as WorkflowTrace;

      console.log(`[WCRS] Loading trace: ${trace.trace_id} (${trace.action_count} actions)`);

      const graph = buildGraph([trace]);
      console.log(`[WCRS] Graph: ${graph.states.size} states, ${graph.transitions.length} transitions`);

      const maxRetries = parseInt(options.maxRetries, 10);
      const stepTimeoutMs = parseInt(options.timeout, 10);
      const outputDir = path.resolve(options.output);

      // WorkflowExecutor requires a Playwright Page. Live execution (connecting to a
      // real browser) is not yet wired into the CLI. Fail fast unless --dry-run is set.
      if (!options.dryRun) {
        console.error('[WCRS] Error: Live execution requires an active Playwright browser session.');
        console.error('[WCRS] Live mode is not yet implemented in the CLI.');
        console.error('[WCRS] Use --dry-run to simulate workflow replay without a browser.');
        process.exit(1);
      }

      const stubPage: ExecutorPage = {
        url: () => '',
        title: async () => '',
        goto: async (_url: string, _opts?: Record<string, unknown>) => null,
        locator: (_selector: string) => ({
          click: async (_opts?: Record<string, unknown>) => {},
          fill: async (_value: string, _opts?: Record<string, unknown>) => {},
          selectOption: async (_value: string, _opts?: Record<string, unknown>) => {},
          count: async () => 0
        }),
        keyboard: { press: async (_key: string) => {} },
        waitForTimeout: async (_ms: number) => {},
        screenshot: async (_opts: { path: string }) => Buffer.from(''),
        evaluate: async <T>(_fn: () => T): Promise<T> => undefined as unknown as T,
        pdf: async () => Buffer.from('')
      };

      const machine = buildAndExportXState([trace]);

      // Determine handoff options
      let handoffOpts: import('./runtime/handoff-notifier.js').HandoffOptions | undefined;
      if (options.handoffWebhook) {
        handoffOpts = { channel: 'webhook', outputDir, webhookUrl: options.handoffWebhook };
      } else if (options.handoffFile) {
        handoffOpts = { channel: 'file', outputDir };
      }

      // Determine PDF check options
      const pdfCheckOpts = options.pdfCheck
        ? { outputDir, pullDate: new Date().toISOString().slice(0, 10), patientId: '' }
        : undefined;

      // Determine supervisor options
      let supervisorServer: import('./supervisor/server.js').SupervisorServer | undefined;
      if (options.supervisor !== undefined && options.supervisor !== false) {
        const port = typeof options.supervisor === 'string' ? parseInt(options.supervisor, 10) : 9999;
        const { SupervisorServer } = await import('./supervisor/server.js');
        supervisorServer = new SupervisorServer(isNaN(port) ? 9999 : port);
        await supervisorServer.listen();
      }

      const executor = new WorkflowExecutor({
        page: stubPage,
        machine,
        graph,
        options: {
          maxRetries: isNaN(maxRetries) ? 2 : maxRetries,
          stepTimeoutMs: isNaN(stepTimeoutMs) ? 60_000 : stepTimeoutMs,
          dryRun: options.dryRun,
          outputDir,
          screenshotOnFailure: !options.dryRun,
          pdfCheck: pdfCheckOpts,
          rulesCheck: options.rulesCheck ? { enabled: true } : undefined,
          handoff: handoffOpts,
          supervisor: supervisorServer
        },
        workflowContext: {
          patient_id: '',
          pull_date: new Date().toISOString().slice(0, 10),
          last_cu_date: '',
          collected_docs: []
        },
        actions: trace.actions
      });

      console.log(`[WCRS] Starting ${options.dryRun ? 'DRY RUN' : 'LIVE'} execution...`);
      const report = await executor.run(); // executor writes the report to outputDir internally

      console.log(`[WCRS] ✓ Execution complete`);
      console.log(`[WCRS]   Status:    ${report.status}`);
      console.log(`[WCRS]   Steps:     ${report.total_steps} total`);
      console.log(`[WCRS]   Succeeded: ${report.steps_succeeded}`);
      console.log(`[WCRS]   Recovered: ${report.steps_recovered}`);
      console.log(`[WCRS]   Skipped:   ${report.steps_skipped}`);
      console.log(`[WCRS]   Escalated: ${report.steps_escalated}`);
      console.log(`[WCRS]   Report:    ${outputDir}/${report.run_id}.json`);

      if (supervisorServer) {
        await supervisorServer.close();
      }

      if (report.status === 'escalated') {
        console.error(`[WCRS] ⚠ Escalated: ${report.escalation_reason}`);
        process.exit(2);
      }
    } catch (err) {
      console.error('[WCRS] Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ── Utilities ──────────────────────────────────────────────────────────────

function loadTraces(tracesPath: string): WorkflowTrace[] {
  const resolved = path.resolve(tracesPath);
  const traces: WorkflowTrace[] = [];

  if (fs.statSync(resolved).isDirectory()) {
    const files = glob.sync('**/*.json', { cwd: resolved, absolute: true });
    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, 'utf-8');
        const parsed = JSON.parse(raw) as WorkflowTrace;
        if (parsed.trace_id && Array.isArray(parsed.actions)) {
          traces.push(parsed);
        }
      } catch (_) { /* skip invalid files */ }
    }
  } else if (fs.existsSync(resolved)) {
    const raw = fs.readFileSync(resolved, 'utf-8');
    const parsed = JSON.parse(raw) as WorkflowTrace;
    if (parsed.trace_id) traces.push(parsed);
  }

  return traces;
}

program.parse(process.argv);
