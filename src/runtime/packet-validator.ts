/**
 * WCRS Packet Validator (Sprint 4 — Module 14)
 * Validates the collected document packet at workflow completion.
 *
 * Combines CU packet ordering (from packet-builder) and filename naming
 * convention validation (from doc-extractor/validator) into a single result.
 */

import type { WorkflowContext } from '../types/index.js';
import { buildPacket } from '../doc-extractor/packet-builder.js';
import { validateDocumentNaming } from '../doc-extractor/validator.js';

// ── Public Interfaces ──────────────────────────────────────────────────────

export interface PacketValidationResult {
  valid: boolean;
  doc_count: number;
  errors: string[];
  packet_order: string[];   // doc_type list in final order
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Validate the collected documents in the workflow context.
 *
 * Checks:
 *   1. Required doc types present (FC, FS)
 *   2. Document naming conventions (pull_date or doc_date in filename)
 *
 * @param context - The workflow context containing collected_docs
 * @returns PacketValidationResult
 */
export function validatePacket(context: WorkflowContext): PacketValidationResult {
  const errors: string[] = [];

  // ── 1. Build packet (ordering + missing required) ──────────────────────
  const packet = buildPacket(context.collected_docs);

  for (const missingType of packet.missing_required) {
    errors.push(`Missing required document type: ${missingType}`);
  }

  // ── 2. Validate naming conventions for each document ───────────────────
  for (const doc of context.collected_docs) {
    const namingResult = validateDocumentNaming(doc, context);
    if (!namingResult.valid) {
      errors.push(...namingResult.errors);
    }
  }

  // ── 3. Build packet_order from the ordered packet ─────────────────────
  const packetOrder = packet.order.map(d => d.doc_type);

  return {
    valid: errors.length === 0,
    doc_count: packet.total_docs,
    errors,
    packet_order: packetOrder
  };
}
