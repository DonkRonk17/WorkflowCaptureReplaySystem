/**
 * WCRS Document Deduplicator (Module 5 — Document Semantics Extractor)
 * Detects and removes duplicate documents by content hash and by (type + date).
 */

import type { DocumentMetadata } from '../types/index.js';

// ── Public Interfaces ──────────────────────────────────────────────────────

export interface DuplicateGroup {
  reason: 'same_hash' | 'same_type_date';
  docs: DocumentMetadata[];
}

export interface DuplicateReport {
  duplicates: DuplicateGroup[];
  unique: DocumentMetadata[];
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Detect duplicate documents by content hash and by (doc_type + document_date).
 *
 * @param docs - List of DocumentMetadata to analyse
 * @returns DuplicateReport with grouped duplicates and the unique list
 */
export function detectDuplicates(docs: DocumentMetadata[]): DuplicateReport {
  const duplicates: DuplicateGroup[] = [];

  // ── Pass 1: same content_hash ──────────────────────────────────────────
  const hashMap = new Map<string, DocumentMetadata[]>();
  for (const doc of docs) {
    if (!doc.content_hash) continue;
    const bucket = hashMap.get(doc.content_hash) ?? [];
    bucket.push(doc);
    hashMap.set(doc.content_hash, bucket);
  }
  for (const bucket of hashMap.values()) {
    if (bucket.length > 1) {
      duplicates.push({ reason: 'same_hash', docs: bucket });
    }
  }

  // ── Pass 2: same (doc_type + document_date) ────────────────────────────
  const typeDateMap = new Map<string, DocumentMetadata[]>();
  for (const doc of docs) {
    const key = `${doc.doc_type}::${doc.document_date.slice(0, 10)}`;
    const bucket = typeDateMap.get(key) ?? [];
    bucket.push(doc);
    typeDateMap.set(key, bucket);
  }
  for (const bucket of typeDateMap.values()) {
    if (bucket.length > 1) {
      // Avoid double-reporting docs already caught by hash match
      const alreadyReported = duplicates
        .filter(g => g.reason === 'same_hash')
        .flatMap(g => g.docs);

      const novel = bucket.filter(d => !alreadyReported.includes(d));
      if (novel.length > 1) {
        duplicates.push({ reason: 'same_type_date', docs: novel });
      }
    }
  }

  // ── Unique list: first occurrence wins ────────────────────────────────
  const unique = deduplicateDocs(docs);

  return { duplicates, unique };
}

/**
 * Return only unique documents (keeps first occurrence).
 * Removes both hash duplicates and (type + date) duplicates.
 *
 * @param docs - Full list of DocumentMetadata
 * @returns Deduplicated list
 */
export function deduplicateDocs(docs: DocumentMetadata[]): DocumentMetadata[] {
  const seen = new Set<string>();
  const result: DocumentMetadata[] = [];

  for (const doc of docs) {
    // Primary dedup key: content_hash (exact duplicate)
    if (doc.content_hash) {
      if (seen.has(`hash::${doc.content_hash}`)) continue;
      seen.add(`hash::${doc.content_hash}`);
    }

    // Secondary dedup key: type + date
    const typeDate = `type::${doc.doc_type}::${doc.document_date.slice(0, 10)}`;
    if (seen.has(typeDate)) continue;
    seen.add(typeDate);

    result.push(doc);
  }

  return result;
}
