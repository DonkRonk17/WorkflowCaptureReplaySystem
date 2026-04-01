/**
 * WCRS Rules Hook (Sprint 4 — Module 12)
 * Post-step CU rules evaluation hook.
 *
 * After each step that produces a document (download or print), evaluates
 * the CU business rules against the current workflow context.
 */

import * as path from 'path';
import type { WorkflowContext } from '../types/index.js';
import { RulesEngine } from '../rules-engine/engine.js';

// ── Public Interfaces ──────────────────────────────────────────────────────

export interface RulesCheckResult {
  checked: boolean;
  passed: boolean;
  violations: string[];   // rule_id + message for each failed rule
}

// ── Default rules path ─────────────────────────────────────────────────────

const DEFAULT_RULES_PATH = path.resolve(process.cwd(), 'config/cu-rules.yaml');

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Evaluate CU rules against the current workflow context.
 * Called after download/print steps when rulesCheck is enabled.
 *
 * @param workflowContext - Current workflow context with collected_docs
 * @param rulesPath       - Optional path to rules YAML (defaults to config/cu-rules.yaml)
 */
export function checkRulesAfterStep(
  workflowContext: WorkflowContext,
  rulesPath?: string
): RulesCheckResult {
  const resolvedPath = rulesPath ?? DEFAULT_RULES_PATH;

  try {
    const engine = new RulesEngine(resolvedPath);
    const packetResult = engine.evaluatePacket(
      workflowContext.collected_docs,
      workflowContext
    );

    const violations = packetResult.failed_rules.map(
      f => `${f.rule_id}: ${f.message}`
    );

    return {
      checked: true,
      passed: packetResult.all_passed,
      violations
    };
  } catch (err) {
    // If rules cannot be loaded (e.g., file not found), return a safe result
    return {
      checked: false,
      passed: false,
      violations: [`Rules evaluation error: ${err instanceof Error ? err.message : String(err)}`]
    };
  }
}
