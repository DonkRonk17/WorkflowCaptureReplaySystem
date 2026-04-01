/**
 * WCRS Packet Validator (Sprint 4 — Pipeline Integration)
 * Validates the assembled CU packet at the end of a workflow run.
 *
 * Checks:
 *   1. No required document types missing (FC, FS) — via buildPacket
 *   2. No document naming violations — via validateDocumentNaming
 */

import type { WorkflowContext } from '../types/index.js';
import { buildPacket } from '../doc-extractor/packet-builder.js';
import { validateDocumentNaming } from '../doc-extractor/validator.js';

// ── Public interfaces ──────────────────────────────────────────────────────

export interface PacketValidationResult {
  valid: boolean;
  /** All validation errors as human-readable strings */
  errors: string[];
  /** doc_types in assembled packet order (FC, FS, ...) */
  packet_order: string[];
  doc_count: number;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Validate the CU packet for the current workflow context.
 *
 * @param context - WorkflowContext containing collected_docs and pull_date
 * @returns PacketValidationResult
 */
export function validatePacket(context: WorkflowContext): PacketValidationResult {
  const docs = context.collected_docs ?? [];

  // 1. Build packet — checks ordering and required types
  const packet = buildPacket(docs);

  const errors: string[] = [];

  // Errors for missing required types
  for (const missing of packet.missing_required) {
    errors.push(`Missing required document type: ${missing}`);
  }

  // 2. Validate naming for each doc
  for (const doc of docs) {
    const result = validateDocumentNaming(doc, context);
    if (!result.valid) {
      for (const err of result.errors) {
        errors.push(err);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    packet_order: packet.order.map(d => d.doc_type),
    doc_count: docs.length
  };
}
