/**
 * WCRS Rules Loader (Module 6 — Rules Engine)
 * Loads a YAML rules file and validates it against the JSON Schema.
 *
 * Bible spec (BH-009 HIGH):
 *   "Rules engine YAML has no validation schema. Invalid YAML rules would
 *    silently fail." → Add JSON Schema validation with AJV on load.
 *    An invalid rule file must throw, not silently skip.
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import Ajv from 'ajv';
import type { Rule } from '../types/index.js';

// ── JSON Schema ────────────────────────────────────────────────────────────

/**
 * JSON Schema (draft-07) for the cu-rules.yaml format.
 * Embedded inline so the schema ships with the source and is always available.
 */
export const RULES_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['rules'],
  additionalProperties: false,
  properties: {
    rules: {
      type: 'array',
      items: { $ref: '#/definitions/rule' }
    }
  },
  definitions: {
    rule: {
      type: 'object',
      required: ['id', 'type', 'description'],
      additionalProperties: false,
      properties: {
        id:           { type: 'string' },
        type: {
          type: 'string',
          enum: ['sequencing', 'date_filter', 'naming', 'ordering', 'conditional', 'submission']
        },
        description:  { type: 'string' },
        condition:    { type: 'string' },
        must_precede: { type: 'array', items: { type: 'string' } },
        doc_type:     { type: 'string' },
        doc_types:    { type: 'array', items: { type: 'string' } },
        filter:       { type: 'string' },
        filename_date: {
          type: 'string',
          enum: ['pull_date', 'document_date']
        },
        order:        { type: 'array', items: { type: 'string' } },
        action:       { type: 'string' },
        recipients:   { type: 'array', items: { type: 'string' } }
      },
      // type-specific required fields
      if:   { properties: { type: { const: 'naming' } }, required: ['type'] },
      then: { required: ['doc_types', 'filename_date'] },
      else: {
        if:   { properties: { type: { const: 'date_filter' } }, required: ['type'] },
        then: { required: ['doc_type', 'filter'] },
        else: {
          if:   { properties: { type: { const: 'conditional' } }, required: ['type'] },
          then: { required: ['condition'] }
        }
      }
    }
  }
};

// ── Error Class ────────────────────────────────────────────────────────────

export class RuleLoadError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: string[]
  ) {
    super(message);
    this.name = 'RuleLoadError';
  }
}

// ── Loader ─────────────────────────────────────────────────────────────────

const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(RULES_JSON_SCHEMA);

/**
 * Load and validate a YAML rules file.
 * Throws RuleLoadError if the YAML is invalid or fails schema validation.
 *
 * @param rulesPath - Path to the YAML rules file
 * @returns Array of validated Rule objects
 */
export function loadRules(rulesPath: string): Rule[] {
  let raw: string;
  try {
    raw = fs.readFileSync(rulesPath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new RuleLoadError(`Cannot read rules file at ${rulesPath}: ${msg}`, [msg]);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new RuleLoadError(`YAML parse error in ${rulesPath}: ${msg}`, [msg]);
  }

  const valid = validateSchema(parsed);
  if (!valid) {
    const errors = (validateSchema.errors ?? []).map(
      e => `${e.instancePath || '(root)'} ${e.message ?? 'validation error'}`
    );
    throw new RuleLoadError(
      `Rules file ${rulesPath} failed schema validation (${errors.length} error(s))`,
      errors
    );
  }

  const data = parsed as { rules: Rule[] };
  return data.rules;
}
