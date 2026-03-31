/**
 * WCRS PDF Extractor (Module 4 — PDF Fidelity Verifier)
 * Extracts text content, page count, orientation, and metadata from PDF files.
 *
 * Bible spec (BH-005):
 *   "The 2-up print format for OS and MAR/TAR is especially tricky — verify
 *    page layout. Always compare against a human-approved 'Alpha' PDF."
 */

import * as fs from 'fs';
import * as path from 'path';

// pdf-parse is a CommonJS module
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

// ── Public Interfaces ──────────────────────────────────────────────────────

export interface PdfExtractResult {
  /** Full concatenated text content */
  text: string;
  /** Number of pages */
  pageCount: number;
  /** Dominant orientation based on first-page dimensions */
  orientation: 'portrait' | 'landscape' | 'unknown';
  /** True when width > height (landscape = possible 2-up candidate) */
  isLandscape: boolean;
  /** Document metadata (author, title, creation date) */
  metadata: PdfMetadata;
}

export interface PdfMetadata {
  author?: string;
  title?: string;
  creationDate?: string;
  producer?: string;
  creator?: string;
}

// ── Page dimension capture ─────────────────────────────────────────────────

interface PageDimensions {
  width: number;
  height: number;
}

/**
 * Build a pdf-parse pagerender option that captures the first page's
 * dimensions and returns empty text (text is extracted from the default pass).
 */
function buildPageDimensionCapture(dims: PageDimensions[]): (pageData: { view: number[] }) => string {
  return (pageData: { view: number[] }): string => {
    // view = [x, y, width, height] in PDF user units
    if (pageData.view && pageData.view.length >= 4) {
      const w = pageData.view[2] ?? 0;
      const h = pageData.view[3] ?? 0;
      dims.push({ width: w, height: h });
    }
    return '';
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract text, page count, orientation and metadata from a PDF file.
 *
 * @param pdfPath - Absolute path to the PDF file
 * @returns Extracted PDF data
 */
export async function extractPdfData(pdfPath: string): Promise<PdfExtractResult> {
  const absolutePath = path.resolve(pdfPath);
  const dataBuffer = fs.readFileSync(absolutePath);

  // First pass: capture page dimensions
  const dims: PageDimensions[] = [];
  await pdfParse(dataBuffer, {
    pagerender: buildPageDimensionCapture(dims)
  });

  // Second pass: extract text with default renderer
  const data = await pdfParse(dataBuffer);

  const pageCount: number = data.numpages ?? 0;
  const text: string = data.text ?? '';

  // Orientation from first page dimensions
  const firstPage = dims[0];
  let orientation: 'portrait' | 'landscape' | 'unknown' = 'unknown';
  let isLandscape = false;

  if (firstPage && firstPage.width > 0 && firstPage.height > 0) {
    isLandscape = firstPage.width > firstPage.height;
    orientation = isLandscape ? 'landscape' : 'portrait';
  }

  // Extract metadata
  const info = (data.info as Record<string, unknown>) ?? {};
  const metadata: PdfMetadata = {
    author: info['Author'] as string | undefined,
    title: info['Title'] as string | undefined,
    creationDate: info['CreationDate'] as string | undefined,
    producer: info['Producer'] as string | undefined,
    creator: info['Creator'] as string | undefined
  };

  return { text, pageCount, orientation, isLandscape, metadata };
}
