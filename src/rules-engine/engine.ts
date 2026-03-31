/**
 * WCRS Rules Engine (Module 6 — Rules Engine)
 * Main public API — loads rules on construction and exposes evaluation methods.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  Rule,
  RuleType,
  DocumentMetadata,
  WorkflowContext,
  RuleEvaluationResult
} from '../types/index.js';
import { loadRules } from './loader.js';
import { evaluateRule, evaluateAllRules } from './evaluator.js';

// ── Public Interfaces ──────────────────────────────────────────────────────

export interface PacketEvaluationResult {
  packet_id: string;
  evaluated_at: string;
  all_passed: boolean;
  results: Array<{
    doc: DocumentMetadata;
    rule_results: RuleEvaluationResult[];
  }>;
  failed_rules: Array<{
    doc_filename: string;
    rule_id: string;
    message: string;
  }>;
  warnings: string[];
}

// ── RulesEngine Class ──────────────────────────────────────────────────────

export class RulesEngine {
  private rules: Rule[];

  constructor(rulesPath: string) {
    this.rules = loadRules(rulesPath);
  }

  /**
   * Evaluate all rules against a single document.
   */
  evaluate(doc: DocumentMetadata, context: WorkflowContext): RuleEvaluationResult[] {
    return evaluateAllRules(this.rules, doc, context);
  }

  /**
   * Evaluate all rules against every document in a packet (context.collected_docs).
   */
  evaluatePacket(docs: DocumentMetadata[], context: WorkflowContext): PacketEvaluationResult {
    const packetContext: WorkflowContext = { ...context, collected_docs: docs };
    const warnings: string[] = [];

    const results = docs.map(doc => ({
      doc,
      rule_results: evaluateAllRules(this.rules, doc, packetContext)
    }));

    const failed_rules = results.flatMap(({ doc, rule_results }) =>
      rule_results
        .filter(r => !r.passed)
        .map(r => ({
          doc_filename: doc.filename,
          rule_id: r.rule_id,
          message: r.message
        }))
    );

    if (failed_rules.length === 0 && docs.length === 0) {
      warnings.push('No documents provided to evaluate');
    }

    return {
      packet_id: uuidv4(),
      evaluated_at: new Date().toISOString(),
      all_passed: failed_rules.length === 0,
      results,
      failed_rules,
      warnings
    };
  }

  /**
   * Look up a rule by its id.
   */
  getRuleById(id: string): Rule | undefined {
    return this.rules.find(r => r.id === id);
  }

  /**
   * Get all rules of a given type.
   */
  getRulesByType(type: RuleType): Rule[] {
    return this.rules.filter(r => r.type === type);
  }

  /**
   * Get rules that are applicable to a specific document type.
   * Checks doc_type and doc_types fields on naming / date_filter / conditional rules.
   */
  getRulesByDocType(docType: string): Rule[] {
    return this.rules.filter(r => {
      if (r.doc_type === docType) return true;
      if (Array.isArray(r.doc_types) && r.doc_types.includes(docType)) return true;
      return false;
    });
  }

  /**
   * Return a summary of rule counts by type.
   */
  getSummary(): { totalRules: number; byType: Partial<Record<RuleType, number>> } {
    const byType: Partial<Record<RuleType, number>> = {};
    for (const r of this.rules) {
      byType[r.type] = (byType[r.type] ?? 0) + 1;
    }
    return {
      totalRules: this.rules.length,
      byType
    };
  }
}
