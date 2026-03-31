/**
 * Tests for src/doc-extractor/
 */

import { classifyDocument, ALL_DOC_TYPES, type DocumentType } from '../../src/doc-extractor/classifier.js';
import { validateDocumentNaming, extractDateFromFilename } from '../../src/doc-extractor/validator.js';
import { buildPacket } from '../../src/doc-extractor/packet-builder.js';
import { detectDuplicates, deduplicateDocs } from '../../src/doc-extractor/dedup.js';
import type { DocumentMetadata, WorkflowContext } from '../../src/types/index.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const PULL_DATE = '2026-03-15';
const LAST_CU   = '2026-02-01';

const mockContext: WorkflowContext = {
  patient_id: 'patient-001',
  pull_date: PULL_DATE,
  last_cu_date: LAST_CU,
  collected_docs: []
};

function makeDoc(
  doc_type: string,
  filename: string,
  document_date = '2026-03-10',
  page_count = 2,
  content_hash?: string
): DocumentMetadata {
  return { filename, doc_type, document_date, patient_id: 'p001', page_count, content_hash };
}

// ── classifyDocument ───────────────────────────────────────────────────────

describe('classifyDocument', () => {
  const cases: Array<[string, DocumentType]> = [
    ['2026-03-15_FC_FaceSheet.pdf', 'FC'],
    ['FaceSheet_2026-03-15.pdf', 'FC'],
    ['facesheet_John_2026.pdf', 'FC'],
    ['FS_Formulary_2026-03-15.pdf', 'FS'],
    ['formulary_2026.pdf', 'FS'],
    ['OS_OrderSummary_2026-03-15.pdf', 'OS'],
    ['order_summary_2026.pdf', 'OS'],
    ['MAR_2026-03-15.pdf', 'MAR'],
    ['medication_administration_2026.pdf', 'MAR'],
    ['VS_VitalSigns_2026-03-15.pdf', 'VS'],
    ['vital_signs_2026.pdf', 'VS'],
    ['Lab_Results_2026-03-10.pdf', 'Lab'],
    ['laboratory_results_2026.pdf', 'Lab'],
    ['Rad_Radiology_2026-03-10.pdf', 'Rad'],
    ['imaging_report_2026.pdf', 'Rad'],
    ['WO_Wound_2026-03-10.pdf', 'WO'],
    ['wound_care_2026.pdf', 'WO'],
    ['COC_ContinuityOfCare_2026-03-10.pdf', 'COC'],
    ['continuity_of_care_2026.pdf', 'COC'],
    ['SW_SkinWound_2026-03-10.pdf', 'SW'],
    ['skin_wound_2026.pdf', 'SW'],
    ['PPN_PhysicianProgress_2026-03-10.pdf', 'PPN'],
    ['physician_progress_notes_2026.pdf', 'PPN'],
    ['OT_OccupationalTherapy_2026-03-10.pdf', 'OT'],
    ['occupational_therapy_2026.pdf', 'OT'],
    ['PT_PhysicalTherapy_2026-03-10.pdf', 'PT'],
    ['physical_therapy_2026.pdf', 'PT'],
    ['ST_SpeechTherapy_2026-03-10.pdf', 'ST'],
    ['speech_therapy_2026.pdf', 'ST']
  ];

  test.each(cases)('%s → %s', (filename, expected) => {
    expect(classifyDocument(filename)).toBe(expected);
  });

  test('unrecognized filename returns UNKNOWN', () => {
    expect(classifyDocument('random_document_2026.pdf')).toBe('UNKNOWN');
    expect(classifyDocument('some_file.pdf')).toBe('UNKNOWN');
  });

  test('ALL_DOC_TYPES contains all 14 types', () => {
    expect(ALL_DOC_TYPES).toHaveLength(14);
    const expected: DocumentType[] = ['FC','FS','OS','MAR','VS','Lab','Rad','WO','COC','SW','PPN','OT','PT','ST'];
    for (const t of expected) {
      expect(ALL_DOC_TYPES).toContain(t);
    }
  });
});

// ── extractDateFromFilename ────────────────────────────────────────────────

describe('extractDateFromFilename', () => {
  test('extracts YYYY-MM-DD', () => {
    expect(extractDateFromFilename('FC_2026-03-15.pdf')).toBe('2026-03-15');
  });

  test('extracts MM-DD-YYYY', () => {
    expect(extractDateFromFilename('FC_03-15-2026.pdf')).toBe('2026-03-15');
  });

  test('extracts YYYYMMDD', () => {
    expect(extractDateFromFilename('FC_20260315.pdf')).toBe('2026-03-15');
  });

  test('returns null for no date', () => {
    expect(extractDateFromFilename('NoDate.pdf')).toBeNull();
  });
});

// ── validateDocumentNaming ─────────────────────────────────────────────────

describe('validateDocumentNaming', () => {
  test('FC with pull_date in filename passes', () => {
    const doc = makeDoc('FC', `FC_${PULL_DATE}.pdf`);
    const result = validateDocumentNaming(doc, mockContext);
    expect(result.valid).toBe(true);
    expect(result.expectedDateType).toBe('pull_date');
    expect(result.errors).toHaveLength(0);
  });

  test('FC with doc_date (not pull_date) in filename fails', () => {
    const doc = makeDoc('FC', 'FC_2026-03-10.pdf'); // doc date, not pull date
    const result = validateDocumentNaming(doc, mockContext);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('FS with pull_date in filename passes', () => {
    const doc = makeDoc('FS', `FS_${PULL_DATE}_formulary.pdf`);
    const result = validateDocumentNaming(doc, mockContext);
    expect(result.valid).toBe(true);
  });

  test('OS with pull_date passes', () => {
    const doc = makeDoc('OS', `OS_OrderSummary_${PULL_DATE}.pdf`);
    const result = validateDocumentNaming(doc, mockContext);
    expect(result.valid).toBe(true);
  });

  test('Lab with document_date in filename passes', () => {
    const docDate = '2026-03-10';
    const doc = makeDoc('Lab', `Lab_Results_${docDate}.pdf`, docDate);
    const result = validateDocumentNaming(doc, mockContext);
    expect(result.valid).toBe(true);
    expect(result.expectedDateType).toBe('document_date');
    expect(result.errors).toHaveLength(0);
  });

  test('Lab with wrong date in filename fails', () => {
    const docDate = '2026-03-10';
    const doc = makeDoc('Lab', 'Lab_Results_2026-01-01.pdf', docDate);
    const result = validateDocumentNaming(doc, mockContext);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('Rad with document_date passes', () => {
    const docDate = '2026-03-05';
    const doc = makeDoc('Rad', `Rad_${docDate}.pdf`, docDate);
    const result = validateDocumentNaming(doc, mockContext);
    expect(result.valid).toBe(true);
  });

  test('SW with document_date passes', () => {
    const docDate = '2026-02-20';
    const doc = makeDoc('SW', `SW_SkinWound_${docDate}.pdf`, docDate);
    const result = validateDocumentNaming(doc, mockContext);
    expect(result.valid).toBe(true);
  });

  test('FC with wrong date type (doc_date instead of pull_date) fails', () => {
    const docDate = '2026-03-10';
    // Filename contains doc date but should contain pull date
    const doc = makeDoc('FC', `FC_${docDate}.pdf`, docDate);
    const result = validateDocumentNaming(doc, mockContext);
    expect(result.valid).toBe(false);
    expect(result.expectedDateType).toBe('pull_date');
  });
});

// ── buildPacket ────────────────────────────────────────────────────────────

describe('buildPacket', () => {
  const fc  = makeDoc('FC',  `FC_${PULL_DATE}.pdf`,  PULL_DATE, 3);
  const fs  = makeDoc('FS',  `FS_${PULL_DATE}.pdf`,  PULL_DATE, 2);
  const lab = makeDoc('Lab', 'Lab_2026-03-10.pdf',   '2026-03-10', 1);
  const os  = makeDoc('OS',  `OS_${PULL_DATE}.pdf`,  PULL_DATE, 4);
  const rad = makeDoc('Rad', 'Rad_2026-03-05.pdf',   '2026-03-05', 2);

  test('FC is first, FS is second', () => {
    const packet = buildPacket([lab, rad, os, fs, fc]);
    expect(packet.order[0]!.doc_type).toBe('FC');
    expect(packet.order[1]!.doc_type).toBe('FS');
  });

  test('remaining docs sorted alphabetically by doc_type', () => {
    const packet = buildPacket([lab, rad, os, fs, fc]);
    const rest = packet.order.slice(2).map(d => d.doc_type);
    const sorted = [...rest].sort();
    expect(rest).toEqual(sorted);
  });

  test('no missing_required when FC and FS are present', () => {
    const packet = buildPacket([fc, fs, lab]);
    expect(packet.missing_required).toHaveLength(0);
  });

  test('missing_required includes FC when FC is absent', () => {
    const packet = buildPacket([fs, lab]);
    expect(packet.missing_required).toContain('FC');
    expect(packet.missing_required).not.toContain('FS');
  });

  test('missing_required includes FS when FS is absent', () => {
    const packet = buildPacket([fc, lab]);
    expect(packet.missing_required).toContain('FS');
  });

  test('missing_required includes both FC and FS when neither present', () => {
    const packet = buildPacket([lab, rad]);
    expect(packet.missing_required).toContain('FC');
    expect(packet.missing_required).toContain('FS');
  });

  test('total_docs equals number of unique docs', () => {
    const packet = buildPacket([fc, fs, lab, os, rad]);
    expect(packet.total_docs).toBe(5);
  });

  test('total_pages sums page_count across all docs', () => {
    const packet = buildPacket([fc, fs, lab, os, rad]);
    expect(packet.total_pages).toBe(3 + 2 + 1 + 4 + 2);
  });

  test('packet_id is a non-empty string', () => {
    const packet = buildPacket([fc, fs]);
    expect(typeof packet.packet_id).toBe('string');
    expect(packet.packet_id.length).toBeGreaterThan(0);
  });
});

// ── detectDuplicates / deduplicateDocs ────────────────────────────────────

describe('detectDuplicates', () => {
  test('detects exact duplicates by content_hash', () => {
    const a = makeDoc('Lab', 'Lab_a.pdf', '2026-03-10', 1, 'hash-abc');
    const b = makeDoc('Lab', 'Lab_b.pdf', '2026-03-10', 1, 'hash-abc'); // same hash
    const c = makeDoc('Rad', 'Rad_a.pdf', '2026-03-05', 2, 'hash-xyz'); // unique

    const report = detectDuplicates([a, b, c]);
    const hashDups = report.duplicates.filter(g => g.reason === 'same_hash');
    expect(hashDups).toHaveLength(1);
    expect(hashDups[0]!.docs).toHaveLength(2);
  });

  test('detects same type+date duplicates', () => {
    const a = makeDoc('Lab', 'Lab_v1_2026-03-10.pdf', '2026-03-10', 1);
    const b = makeDoc('Lab', 'Lab_v2_2026-03-10.pdf', '2026-03-10', 1); // same type+date, no hash
    const c = makeDoc('Rad', 'Rad_2026-03-05.pdf',    '2026-03-05', 2);

    const report = detectDuplicates([a, b, c]);
    const typeDateDups = report.duplicates.filter(g => g.reason === 'same_type_date');
    expect(typeDateDups).toHaveLength(1);
    expect(typeDateDups[0]!.docs).toHaveLength(2);
  });

  test('unique list has no duplicates', () => {
    const a = makeDoc('Lab', 'Lab_a.pdf', '2026-03-10', 1, 'hash-aaa');
    const b = makeDoc('Lab', 'Lab_b.pdf', '2026-03-10', 1, 'hash-aaa');

    const report = detectDuplicates([a, b]);
    expect(report.unique).toHaveLength(1);
  });

  test('no duplicates → empty duplicates array', () => {
    const a = makeDoc('FC',  'FC_2026.pdf',  '2026-03-15', 1, 'hash-1');
    const b = makeDoc('FS',  'FS_2026.pdf',  '2026-03-15', 1, 'hash-2');
    const c = makeDoc('Lab', 'Lab_2026.pdf', '2026-03-10', 1, 'hash-3');

    const report = detectDuplicates([a, b, c]);
    expect(report.duplicates).toHaveLength(0);
    expect(report.unique).toHaveLength(3);
  });
});

describe('deduplicateDocs', () => {
  test('keeps first occurrence on hash collision', () => {
    const a = makeDoc('Lab', 'Lab_first.pdf', '2026-03-10', 1, 'hash-dup');
    const b = makeDoc('Lab', 'Lab_second.pdf', '2026-03-10', 1, 'hash-dup');

    const result = deduplicateDocs([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]!.filename).toBe('Lab_first.pdf');
  });

  test('keeps first occurrence on type+date collision', () => {
    const a = makeDoc('Rad', 'Rad_v1_2026-03-05.pdf', '2026-03-05');
    const b = makeDoc('Rad', 'Rad_v2_2026-03-05.pdf', '2026-03-05');

    const result = deduplicateDocs([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]!.filename).toBe('Rad_v1_2026-03-05.pdf');
  });
});
