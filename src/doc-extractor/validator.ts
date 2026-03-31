/**
 * WCRS Document Naming Validator (Module 5 — Document Semantics Extractor)
 * Validates DocumentMetadata filename conventions against CU naming rules.
 *
 * Bible spec:
 *   pull_date types → FC, FS, OS, MAR, VS  (filename must contain pull_date)
 *   doc_date types  → Lab, Rad, WO, COC, SW, PPN, OT, PT, ST (filename must contain doc date)
 */

import type { DocumentMetadata, WorkflowContext } from '../types/index.js';

// ── Constants ──────────────────────────────────────────────────────────────

export const PULL_DATE_TYPES = new Set(['FC', 'FS', 'OS', 'MAR', 'VS']);
export const DOC_DATE_TYPES  = new Set(['Lab', 'Rad', 'WO', 'COC', 'SW', 'PPN', 'OT', 'PT', 'ST']);

// ── Interfaces ─────────────────────────────────────────────────────────────

export interface NamingValidationResult {
  valid: boolean;
  expectedDateType: 'pull_date' | 'document_date' | 'unknown';
  expectedDate: string | null;
  actualDate: string | null;
  filename: string;
  errors: string[];
}

// ── Date Parsing ───────────────────────────────────────────────────────────

// Date format regex with capture groups (YYYY-MM-DD, MM-DD-YYYY, YYYYMMDD, MMDDYYYY)
const DATE_PATTERNS: Array<{ re: RegExp; parse: (m: RegExpMatchArray) => string }> = [
  {
    // YYYY-MM-DD
    re: /(\d{4})-(\d{2})-(\d{2})/,
    parse: m => `${m[1]}-${m[2]}-${m[3]}`
  },
  {
    // MM-DD-YYYY
    re: /(\d{2})-(\d{2})-(\d{4})/,
    parse: m => `${m[3]}-${m[1]}-${m[2]}`
  },
  {
    // YYYYMMDD (8-digit run not preceded/followed by digits)
    re: /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/,
    parse: m => `${m[1]}-${m[2]}-${m[3]}`
  },
  {
    // MMDDYYYY (8-digit run, interpreted as MM DD YYYY)
    re: /(?<!\d)(\d{2})(\d{2})(\d{4})(?!\d)/,
    parse: m => `${m[3]}-${m[1]}-${m[2]}`
  }
];

/**
 * Extract the first parseable date string from a filename.
 *
 * @param filename - The document filename
 * @returns ISO date string (YYYY-MM-DD) or null if none found
 */
export function extractDateFromFilename(filename: string): string | null {
  for (const { re, parse } of DATE_PATTERNS) {
    const m = filename.match(re);
    if (m) {
      const parsed = parse(m);
      // Basic sanity check: valid date
      const d = new Date(parsed);
      if (!isNaN(d.getTime())) return parsed;
    }
  }
  return null;
}

/**
 * Normalise a date string to YYYY-MM-DD for comparison, stripping time parts.
 */
function normaliseDate(dateStr: string): string {
  return dateStr.slice(0, 10);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Validate a document's filename against CU naming conventions.
 *
 * @param doc     - The document metadata to validate
 * @param context - The workflow context (provides pull_date and last_cu_date)
 * @returns NamingValidationResult
 */
export function validateDocumentNaming(
  doc: DocumentMetadata,
  context: WorkflowContext
): NamingValidationResult {
  const errors: string[] = [];
  const filename = doc.filename;
  const actualDate = extractDateFromFilename(filename);

  let expectedDateType: NamingValidationResult['expectedDateType'] = 'unknown';
  let expectedDate: string | null = null;
  let valid = true;

  if (PULL_DATE_TYPES.has(doc.doc_type)) {
    expectedDateType = 'pull_date';
    expectedDate = normaliseDate(context.pull_date);

    if (!actualDate) {
      errors.push(`${doc.doc_type} filename must contain pull date (${expectedDate}) but no date found`);
      valid = false;
    } else if (normaliseDate(actualDate) !== expectedDate) {
      errors.push(
        `${doc.doc_type} filename uses ${actualDate} but pull date is ${expectedDate}`
      );
      valid = false;
    }
  } else if (DOC_DATE_TYPES.has(doc.doc_type)) {
    expectedDateType = 'document_date';
    expectedDate = normaliseDate(doc.document_date);

    if (!actualDate) {
      errors.push(`${doc.doc_type} filename must contain document date (${expectedDate}) but no date found`);
      valid = false;
    } else if (normaliseDate(actualDate) !== expectedDate) {
      errors.push(
        `${doc.doc_type} filename uses ${actualDate} but document date is ${expectedDate}`
      );
      valid = false;
    }
  }
  // For types not in either set (e.g., UNKNOWN), we don't validate

  return { valid, expectedDateType, expectedDate, actualDate, filename, errors };
}
