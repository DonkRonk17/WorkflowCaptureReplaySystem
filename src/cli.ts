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
import { buildAndExportXState } from './state-mapper/graph-builder.js';
import { serializeMachine, generateStatelyUrl } from './state-mapper/xstate-export.js';

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
