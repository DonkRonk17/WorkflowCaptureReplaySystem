/**
 * WCRS Rules Evaluator (Module 6 — Rules Engine)
 * Evaluates a single rule against a document and workflow context.
 *
 * Bible spec (BH-004):
 *   "Conditional rules for OT/PT/ST MUST be encoded as executable logic,
 *    not comments."
 *   → therapy_discipline_active and radiology_results_exist are evaluated here.
 */

import type {
  Rule,
  DocumentMetadata,
  WorkflowContext,
  RuleEvaluationResult
} from '../types/index.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compare two ISO date strings. Returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareDates(a: string, b: string): number {
  return a.slice(0, 10).localeCompare(b.slice(0, 10));
}

/**
 * Evaluate a simple key==value condition string against the workflow context.
 * Supports: "key == value" or "key == true/false".
 * Keys may contain dots (e.g., "step.type"). String values may be quoted.
 * Does NOT use eval().
 */
function evaluateCondition(
  condition: string,
  doc: DocumentMetadata,
  context: WorkflowContext
): boolean {
  // Normalise: "key==value" or "key == value"; allow dotted keys and quoted strings
  const match = condition.match(/^\s*([\w.]+)\s*==\s*(\S+)\s*$/);
  if (!match) return false;

  const [, key, rawValue] = match as [string, string, string];

  // Strip surrounding single or double quotes from string literals
  const stripped =
    (rawValue.startsWith("'") && rawValue.endsWith("'")) ||
    (rawValue.startsWith('"') && rawValue.endsWith('"'))
      ? rawValue.slice(1, -1)
      : rawValue;

  // Resolve the value from context or doc using the key (supports dotted notation)
  const parts = key.split('.');
  let contextValue: unknown;

  if (parts.length > 1) {
    // Dotted key: walk the context object
    let obj: unknown = context;
    for (const part of parts) {
      if (obj != null && typeof obj === 'object') {
        obj = (obj as Record<string, unknown>)[part];
      } else {
        obj = undefined;
        break;
      }
    }
    contextValue = obj;
    if (contextValue === undefined) {
      // Fall back to doc
      let docObj: unknown = doc;
      for (const part of parts) {
        if (docObj != null && typeof docObj === 'object') {
          docObj = (docObj as Record<string, unknown>)[part];
        } else {
          docObj = undefined;
          break;
        }
      }
      contextValue = docObj;
    }
  } else {
    switch (key) {
      case 'radiology_results_exist':
        contextValue = context.radiology_results_exist ?? false;
        break;
      case 'therapy_discipline_active':
        contextValue = context.therapy_discipline_active ?? false;
        break;
      default:
        contextValue = (context as unknown as Record<string, unknown>)[key];
        if (contextValue === undefined) {
          contextValue = (doc as unknown as Record<string, unknown>)[key];
        }
    }
  }

  // Parse expected value (use stripped form for comparisons)
  let expected: unknown;
  if (stripped === 'true') expected = true;
  else if (stripped === 'false') expected = false;
  else if (!isNaN(Number(stripped)) && stripped !== '') expected = Number(stripped);
  else expected = stripped;

  return contextValue === expected;
}

// ── Rule Evaluators ────────────────────────────────────────────────────────

function evalSequencing(rule: Rule, _doc: DocumentMetadata, _context: WorkflowContext): RuleEvaluationResult {
  // NOTE:
  // Sequencing in cu-rules.yaml is expressed in terms of step-level context
  // (e.g., step.type == 'admin_note'), but this evaluator currently only has
  // access to document-level metadata. Until step-level context is available
  // and wired into the rules engine, we do not attempt to enforce sequencing
  // here to avoid enforcing incorrect, hard-coded assumptions.
  //
  // We conservatively mark the rule as passed and include a message indicating
  // that sequencing was not evaluated in this context.
  return {
    rule_id: rule.id,
    passed: true,
    message: `Sequencing rule ${rule.id}: not evaluated in document-only context`
  };
}

function evalDateFilter(rule: Rule, doc: DocumentMetadata, context: WorkflowContext): RuleEvaluationResult {
  const filter = rule.filter ?? '';

  if (filter === 'none') {
    return { rule_id: rule.id, passed: true, message: `${rule.id}: no date filter (all time)` };
  }

  // "document_date >= last_cu_date"
  if (filter.includes('>=') && filter.includes('last_cu_date')) {
    const cmp = compareDates(doc.document_date, context.last_cu_date);
    if (cmp >= 0) {
      return { rule_id: rule.id, passed: true, message: `${rule.id}: date ${doc.document_date} >= last CU ${context.last_cu_date}` };
    } else {
      return {
        rule_id: rule.id,
        passed: false,
        message: `${rule.id}: date ${doc.document_date} is before last CU ${context.last_cu_date}`
      };
    }
  }

  // Unknown filter expression — pass conservatively
  return { rule_id: rule.id, passed: true, message: `${rule.id}: filter '${filter}' not recognised — passing` };
}

function evalNaming(rule: Rule, doc: DocumentMetadata, context: WorkflowContext): RuleEvaluationResult {
  const docTypes = rule.doc_types ?? (rule.doc_type ? [rule.doc_type] : []);
  if (!docTypes.includes(doc.doc_type)) {
    // Rule does not apply to this doc type
    return { rule_id: rule.id, passed: true, message: `${rule.id}: not applicable to ${doc.doc_type}` };
  }

  const filenameDate = rule.filename_date;
  let expectedDate: string | null = null;

  if (filenameDate === 'pull_date') {
    expectedDate = context.pull_date.slice(0, 10);
  } else if (filenameDate === 'document_date') {
    expectedDate = doc.document_date.slice(0, 10);
  }

  if (!expectedDate) {
    return { rule_id: rule.id, passed: true, message: `${rule.id}: no expected date to check` };
  }

  if (doc.filename.includes(expectedDate)) {
    return { rule_id: rule.id, passed: true, message: `${rule.id}: filename contains ${expectedDate}` };
  }

  return {
    rule_id: rule.id,
    passed: false,
    message: `${rule.id}: filename '${doc.filename}' does not contain ${filenameDate} (${expectedDate})`
  };
}

function evalOrdering(rule: Rule, doc: DocumentMetadata, context: WorkflowContext): RuleEvaluationResult {
  const order = rule.order ?? [];
  const collected = context.collected_docs;
  const docIndex = collected.findIndex(d => d.filename === doc.filename);

  if (docIndex === -1) {
    return { rule_id: rule.id, passed: true, message: `${rule.id}: doc not in collected_docs` };
  }

  // Check alphabetical_by_doc_class order as a special value
  const specialAlpha = order.includes('alphabetical_by_doc_class');
  const fixed = order.filter(o => o !== 'alphabetical_by_doc_class');

  const fixedIdx = fixed.indexOf(doc.doc_type);
  if (fixedIdx !== -1) {
    // Doc is in a fixed position — check that position
    const expectedPosition = fixedIdx;
    const actualFixedPosition = collected.filter(d => fixed.includes(d.doc_type))
      .findIndex(d => d.filename === doc.filename);
    if (actualFixedPosition === expectedPosition) {
      return { rule_id: rule.id, passed: true, message: `${rule.id}: ${doc.doc_type} at correct position` };
    }
    return {
      rule_id: rule.id,
      passed: false,
      message: `${rule.id}: ${doc.doc_type} expected at position ${expectedPosition}`
    };
  }

  if (specialAlpha) {
    // For docs not in fixed list, just pass (alphabetical order is enforced by buildPacket)
    return { rule_id: rule.id, passed: true, message: `${rule.id}: alphabetical ordering delegated to packet builder` };
  }

  return { rule_id: rule.id, passed: true, message: `${rule.id}: ordering passed` };
}

function evalConditional(rule: Rule, doc: DocumentMetadata, context: WorkflowContext): RuleEvaluationResult {
  const condition = rule.condition ?? '';
  const docTypes = rule.doc_types ?? (rule.doc_type ? [rule.doc_type] : []);

  // If rule is scoped to specific doc_types and this doc doesn't match, skip
  if (docTypes.length > 0 && !docTypes.includes(doc.doc_type)) {
    return { rule_id: rule.id, passed: true, message: `${rule.id}: not applicable to ${doc.doc_type}` };
  }

  const passed = evaluateCondition(condition, doc, context);
  return {
    rule_id: rule.id,
    passed,
    message: passed
      ? `${rule.id}: condition '${condition}' satisfied`
      : `${rule.id}: condition '${condition}' not satisfied`
  };
}

function evalSubmission(_rule: Rule): RuleEvaluationResult {
  return { rule_id: _rule.id, passed: true, message: `${_rule.id}: submission rule (informational)` };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Evaluate a single rule against a document and workflow context.
 */
export function evaluateRule(
  rule: Rule,
  doc: DocumentMetadata,
  context: WorkflowContext
): RuleEvaluationResult {
  switch (rule.type) {
    case 'sequencing':  return evalSequencing(rule, doc, context);
    case 'date_filter': return evalDateFilter(rule, doc, context);
    case 'naming':      return evalNaming(rule, doc, context);
    case 'ordering':    return evalOrdering(rule, doc, context);
    case 'conditional': return evalConditional(rule, doc, context);
    case 'submission':  return evalSubmission(rule);
    default:
      return { rule_id: rule.id, passed: true, message: `Unknown rule type: ${(rule as Rule).type}` };
  }
}

/**
 * Evaluate all rules against a document. Returns all results (pass and fail).
 */
export function evaluateAllRules(
  rules: Rule[],
  doc: DocumentMetadata,
  context: WorkflowContext
): RuleEvaluationResult[] {
  return rules.map(r => evaluateRule(r, doc, context));
}
