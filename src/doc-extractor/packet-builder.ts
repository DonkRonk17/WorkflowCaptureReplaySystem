/**
 * WCRS CU Packet Builder (Module 5 — Document Semantics Extractor)
 * Assembles a Clinical Update document packet in the correct CU order.
 *
 * Bible spec:
 *   "COMBINE ORDER: FC → FS → [alphabetical by doc class]"
 *   "FC and FS are always required."
 */

import { v4 as uuidv4 } from 'uuid';
import type { DocumentMetadata } from '../types/index.js';
import type { DocumentType } from './classifier.js';
import { deduplicateDocs } from './dedup.js';

// ── Public Interfaces ──────────────────────────────────────────────────────

export interface CUPacket {
  packet_id: string;
  assembled_at: string;
  total_docs: number;
  total_pages: number;
  /** Documents sorted per CU rules: FC first, FS second, rest alphabetical */
  order: DocumentMetadata[];
  /** Required doc types that are absent from the packet */
  missing_required: DocumentType[];
  warnings: string[];
}

// Required document types for every CU packet
const REQUIRED_TYPES: DocumentType[] = ['FC', 'FS'];

// ── Sorting ────────────────────────────────────────────────────────────────

function sortKey(doc: DocumentMetadata): string {
  switch (doc.doc_type) {
    case 'FC': return '00_FC';
    case 'FS': return '01_FS';
    default:   return `02_${doc.doc_type}`;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Assemble a CU document packet in correct order.
 * Deduplicates before ordering. FC and FS are always required.
 *
 * @param docs - Unordered list of DocumentMetadata
 * @returns CUPacket with ordered documents and validation info
 */
export function buildPacket(docs: DocumentMetadata[]): CUPacket {
  const warnings: string[] = [];

  // Deduplicate first
  const unique = deduplicateDocs(docs);
  if (unique.length < docs.length) {
    warnings.push(`Removed ${docs.length - unique.length} duplicate document(s)`);
  }

  // Sort: FC (00) → FS (01) → alphabetical by doc_type (02_*)
  const ordered = [...unique].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // Check required types
  const presentTypes = new Set(ordered.map(d => d.doc_type));
  const missing_required: DocumentType[] = REQUIRED_TYPES.filter(t => !presentTypes.has(t));

  const total_pages = ordered.reduce((sum, d) => sum + (d.page_count ?? 0), 0);

  return {
    packet_id: uuidv4(),
    assembled_at: new Date().toISOString(),
    total_docs: ordered.length,
    total_pages,
    order: ordered,
    missing_required,
    warnings
  };
}
