/**
 * WCRS PDF Check Hook (Sprint 4 — Pipeline Integration)
 * Invoked after a successful `print` action to verify PDF fidelity.
 *
 * NOTE: ExecutorPage is accepted as a parameter — never imported at module level.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TraceTransition } from '../types/index.js';
import type { ExecutorPage } from './executor.js';
import { comparePdfs, type FidelityReport } from '../pdf-verifier/comparator.js';

// ── Public interfaces ──────────────────────────────────────────────────────

export interface PdfCheckOptions {
  /** Directory to store generated and baseline PDFs */
  outputDir: string;
  /** Pull date (YYYY-MM-DD) */
  pullDate: string;
  /** Patient/resident ID */
  patientId: string;
  /** Visual similarity tolerance (0–1, default 0.02) */
  visualTolerance?: number;
}

export interface PdfCheckResult {
  /** False when page.pdf() threw or a fatal write error occurred */
  checked: boolean;
  fidelity_status: 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';
  generated_pdf?: string;
  baseline_pdf?: string;
  fidelity_report?: FidelityReport;
  /** Populated when fidelity_status is FAIL or SKIPPED */
  failure_reason?: string;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Capture the current page as a PDF and compare against the stored baseline.
 * If no baseline exists, the generated PDF becomes the baseline (returns PASS).
 * Never throws.
 */
export async function checkPdfAfterPrint(
  page: ExecutorPage,
  transition: TraceTransition,
  options: PdfCheckOptions
): Promise<PdfCheckResult> {
  const { outputDir, visualTolerance } = options;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const safeId = transition.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const generatedPath = path.join(outputDir, `print-${safeId}.pdf`);
  const baselinePath = path.join(outputDir, `baseline-${safeId}.pdf`);

  // Capture PDF from page
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await page.pdf();
  } catch (err) {
    return {
      checked: false,
      fidelity_status: 'SKIPPED',
      failure_reason: `page.pdf() failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  // Write generated PDF
  try {
    fs.writeFileSync(generatedPath, pdfBuffer);
  } catch (err) {
    return {
      checked: false,
      fidelity_status: 'SKIPPED',
      failure_reason: `Failed to write generated PDF: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  // If no baseline exists, save current as baseline and return PASS
  if (!fs.existsSync(baselinePath)) {
    try {
      fs.writeFileSync(baselinePath, pdfBuffer);
    } catch (err) {
      return {
        checked: false,
        fidelity_status: 'SKIPPED',
        generated_pdf: generatedPath,
        failure_reason: `Failed to write baseline PDF: ${err instanceof Error ? err.message : String(err)}`
      };
    }
    return {
      checked: true,
      fidelity_status: 'PASS',
      generated_pdf: generatedPath,
      baseline_pdf: baselinePath
    };
  }

  // Compare against existing baseline
  try {
    const fidelityReport = await comparePdfs(generatedPath, baselinePath, {
      visualTolerance: visualTolerance ?? 0.02
    });

    const failure_reason = fidelityReport.result === 'FAIL' && fidelityReport.discrepancies.length > 0
      ? fidelityReport.discrepancies.map(d => d.description).join('; ')
      : undefined;

    return {
      checked: true,
      fidelity_status: fidelityReport.result,
      generated_pdf: generatedPath,
      baseline_pdf: baselinePath,
      fidelity_report: fidelityReport,
      failure_reason
    };
  } catch (err) {
    return {
      checked: false,
      fidelity_status: 'SKIPPED',
      generated_pdf: generatedPath,
      baseline_pdf: baselinePath,
      failure_reason: `comparePdfs failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}
