/**
 * WCRS Document Classifier (Module 5 — Document Semantics Extractor)
 * Classifies a filename into a CU document type using pattern matching.
 *
 * Bible spec:
 *   "pull_date types: FC, FS, OS, MAR, VS"
 *   "doc_date types: Lab, Rad, WO, COC, SW, PPN, OT, PT, ST"
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type DocumentType =
  | 'FC'
  | 'FS'
  | 'OS'
  | 'MAR'
  | 'VS'
  | 'Lab'
  | 'Rad'
  | 'WO'
  | 'COC'
  | 'SW'
  | 'PPN'
  | 'OT'
  | 'PT'
  | 'ST'
  | 'UNKNOWN';

export const ALL_DOC_TYPES: readonly DocumentType[] = [
  'FC', 'FS', 'OS', 'MAR', 'VS',
  'Lab', 'Rad', 'WO', 'COC', 'SW', 'PPN', 'OT', 'PT', 'ST'
];

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a regex that matches an abbreviation token that is bounded by
 * a non-alpha character (start, end, separator, digit, dot) — handles
 * the case where _ is treated as a word character by \b.
 */
function tokenRe(tok: string): RegExp {
  return new RegExp(`(?:^|[_\\-\\.\\s])${tok}(?=[_\\-\\.\\s\\d]|$)`, 'i');
}

// ── Classification Rules ───────────────────────────────────────────────────

// Order matters: more specific patterns first (SW before WO to avoid "wound" collision)
const RULES: Array<{ type: DocumentType; patterns: RegExp[] }> = [
  {
    type: 'FC',
    patterns: [/face[\s_-]?sheet/i, tokenRe('FC')]
  },
  {
    type: 'FS',
    patterns: [/formulary/i, tokenRe('FS')]
  },
  {
    type: 'OS',
    patterns: [/order[\s_-]?summary/i, tokenRe('OS')]
  },
  {
    type: 'MAR',
    patterns: [/medication[\s_-]?administration/i, tokenRe('MAR')]
  },
  {
    type: 'VS',
    patterns: [/vital[\s_-]?signs?/i, tokenRe('VS')]
  },
  {
    type: 'Lab',
    patterns: [/lab[\s_-]?result/i, /laboratory/i, tokenRe('Lab')]
  },
  {
    type: 'Rad',
    patterns: [/radiology/i, /imaging/i, tokenRe('Rad')]
  },
  {
    // SW must come before WO — "skin wound" / "skin/wound" must not fall into WO
    type: 'SW',
    patterns: [/skin[\s_/-]wound/i, /skin\/wound/i, tokenRe('SW')]
  },
  {
    type: 'WO',
    patterns: [/wound/i, tokenRe('WO')]
  },
  {
    type: 'COC',
    patterns: [/continuity[\s_-]?of[\s_-]?care/i, tokenRe('COC')]
  },
  {
    type: 'PPN',
    patterns: [/physician[\s_-]?progress/i, tokenRe('PPN')]
  },
  {
    type: 'OT',
    patterns: [/occupational[\s_-]?therapy/i, tokenRe('OT')]
  },
  {
    type: 'PT',
    patterns: [/physical[\s_-]?therapy/i, tokenRe('PT')]
  },
  {
    type: 'ST',
    patterns: [/speech[\s_-]?therapy/i, tokenRe('ST')]
  }
];

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Classify a filename into a DocumentType.
 *
 * @param filename - The document filename (may include path components)
 * @returns Matched DocumentType or 'UNKNOWN'
 */
export function classifyDocument(filename: string): DocumentType {
  // Work with the basename only
  const base = filename.split(/[/\\]/).pop() ?? filename;

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(base)) {
        return rule.type;
      }
    }
  }

  return 'UNKNOWN';
}
