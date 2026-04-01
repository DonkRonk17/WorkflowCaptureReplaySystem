/**
 * Unit tests — Packet Validator (Sprint 4)
 */

import { validatePacket } from '../../src/runtime/packet-validator.js';
import type { WorkflowContext, DocumentMetadata } from '../../src/types/index.js';

function makeDoc(overrides: Partial<DocumentMetadata> = {}): DocumentMetadata {
  return {
    filename: 'FC_2026-03-30.pdf',
    doc_type: 'FC',
    document_date: '2026-03-30',
    patient_id: 'P001',
    page_count: 2,
    ...overrides
  };
}

function makeContext(docs: DocumentMetadata[]): WorkflowContext {
  return {
    patient_id: 'P001',
    pull_date: '2026-03-30',
    last_cu_date: '2026-01-01',
    collected_docs: docs
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('validatePacket — valid=true for correctly ordered packet', () => {
  it('returns valid=true when FC and FS are present with correct naming', () => {
    const docs = [
      makeDoc({ filename: 'FC_2026-03-30.pdf', doc_type: 'FC' }),
      makeDoc({ filename: 'FS_2026-03-30.pdf', doc_type: 'FS' })
    ];
    const result = validatePacket(makeContext(docs));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns doc_count matching collected_docs length', () => {
    const docs = [
      makeDoc({ filename: 'FC_2026-03-30.pdf', doc_type: 'FC' }),
      makeDoc({ filename: 'FS_2026-03-30.pdf', doc_type: 'FS' }),
      makeDoc({ filename: 'Lab_2026-01-15.pdf', doc_type: 'Lab', document_date: '2026-01-15' })
    ];
    const result = validatePacket(makeContext(docs));
    expect(result.doc_count).toBe(3);
  });

  it('returns packet_order with FC first and FS second', () => {
    const docs = [
      makeDoc({ filename: 'FS_2026-03-30.pdf', doc_type: 'FS' }),
      makeDoc({ filename: 'FC_2026-03-30.pdf', doc_type: 'FC' })
    ];
    const result = validatePacket(makeContext(docs));
    expect(result.packet_order[0]).toBe('FC');
    expect(result.packet_order[1]).toBe('FS');
  });
});

describe('validatePacket — valid=false + errors for missing required docs', () => {
  it('returns valid=false and errors when FC is missing', () => {
    const docs = [
      makeDoc({ filename: 'FS_2026-03-30.pdf', doc_type: 'FS' })
    ];
    const result = validatePacket(makeContext(docs));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('FC'))).toBe(true);
  });

  it('reports both FC and FS missing for empty packet', () => {
    const result = validatePacket(makeContext([]));
    expect(result.valid).toBe(false);
    const errStr = result.errors.join(' ');
    expect(errStr).toContain('FC');
    expect(errStr).toContain('FS');
  });
});

describe('validatePacket — naming violations', () => {
  it('returns valid=false when FC filename does not contain pull_date', () => {
    const docs = [
      makeDoc({ filename: 'FC_WRONG_DATE.pdf', doc_type: 'FC' }),
      makeDoc({ filename: 'FS_2026-03-30.pdf', doc_type: 'FS' })
    ];
    const result = validatePacket(makeContext(docs));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('FC') || e.toLowerCase().includes('pull'))).toBe(true);
  });
});

describe('validatePacket — doc_count', () => {
  it('returns doc_count=0 for empty collected_docs', () => {
    const result = validatePacket(makeContext([]));
    expect(result.doc_count).toBe(0);
  });

  it('returns doc_count matching number of unique docs after deduplication', () => {
    const docs = Array.from({ length: 5 }, (_, i) =>
      makeDoc({
        filename: `DOC_2026-03-3${i}.pdf`,
        doc_type: i === 0 ? 'FC' : i === 1 ? 'FS' : `Lab${i}`,
        document_date: `2026-03-3${i}`
      })
    );
    const result = validatePacket(makeContext(docs));
    expect(result.doc_count).toBe(5);
  });
});
