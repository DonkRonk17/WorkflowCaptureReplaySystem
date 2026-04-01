/**
 * WCRS Rules Check Hook (Sprint 4 — Pipeline Integration)
 * Invoked after a successful `download` or `print` action to evaluate
 * collected documents against CU business rules.
 */

import * as path from 'path';
import type { WorkflowContext } from '../types/index.js';
import { RulesEngine } from '../rules-engine/engine.js';

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_RULES_PATH = path.resolve('config/cu-rules.yaml');

// ── Public interfaces ──────────────────────────────────────────────────────

export interface RulesCheckResult {
  /** False when the rules engine threw an error */
  checked: boolean;
  passed: boolean;
  /** Human-readable violation strings, e.g. "RULE_ID: message" */
  violations: string[];
  rules_path: string;
  error?: string;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Evaluate all collected documents in the workflow context against CU rules.
 * Never throws.
 */
export function checkRulesAfterStep(
  context: WorkflowContext,
  rulesPath?: string
): RulesCheckResult {
  const resolvedPath = rulesPath ?? DEFAULT_RULES_PATH;

  try {
    const engine = new RulesEngine(resolvedPath);
    const packetResult = engine.evaluatePacket(
      context.collected_docs ?? [],
      context
    );

    const violations = packetResult.failed_rules.map(fr => fr.message);

    return {
      checked: true,
      passed: packetResult.all_passed,
      violations,
      rules_path: resolvedPath
    };
  } catch (err) {
    return {
      checked: false,
      passed: false,
      violations: [],
      rules_path: resolvedPath,
      error: `Rules engine failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}
