/**
 * WCRS PDF Hook (Sprint 4 — Module 11)
 * Post-print PDF fidelity verification hook.
 *
 * After a 'print' action completes, captures the current page as a PDF buffer,
 * writes it to disk, and runs it through the PDF Fidelity Verifier pipeline.
 * On first run (no baseline), saves the captured PDF as the baseline.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TraceTransition } from '../types/index.js';
import type { ExecutorPage } from './executor.js';
import { comparePdfs } from '../pdf-verifier/comparator.js';
import { writeReport as writeFidelityReport } from '../pdf-verifier/reporter.js';

// ── Public Interfaces ──────────────────────────────────────────────────────

export interface PdfCheckOptions {
  outputDir: string;
  pullDate: string;    // from WorkflowContext.pull_date
  patientId: string;   // from WorkflowContext.patient_id
}

export interface PdfCheckResult {
  checked: boolean;
  fidelity_status: 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';
  report_path?: string;   // path to FidelityReport JSON if written
  failure_reason?: string;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Capture the current page as a PDF, compare against baseline, and return result.
 * Called after every 'print' action when pdfCheck options are set.
 */
export async function checkPdfAfterPrint(
  page: ExecutorPage,
  transition: TraceTransition,
  options: PdfCheckOptions
): Promise<PdfCheckResult> {
  const { outputDir } = options;

  // ── 1. Capture PDF from page ───────────────────────────────────────────
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

  // ── 2. Ensure output directory exists ─────────────────────────────────
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  } catch (_) { /* ignore mkdir failures */ }

  // ── 3. Write captured PDF ──────────────────────────────────────────────
  const capturedPath = path.join(outputDir, `print-${transition.id}.pdf`);
  try {
    fs.writeFileSync(capturedPath, pdfBuffer);
  } catch (err) {
    return {
      checked: false,
      fidelity_status: 'SKIPPED',
      failure_reason: `Failed to write captured PDF: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  // ── 4. Check for baseline ──────────────────────────────────────────────
  const baselinePath = path.join(outputDir, `baseline-${transition.id}.pdf`);
  const baselineExists = fs.existsSync(baselinePath);

  if (!baselineExists) {
    // First run — save captured PDF as baseline
    try {
      fs.writeFileSync(baselinePath, pdfBuffer);
    } catch (err) {
      // Baseline could not be persisted; return SKIPPED so subsequent runs
      // don't silently report PASS without a real comparison.
      return {
        checked: false,
        fidelity_status: 'SKIPPED',
        failure_reason: `Failed to write baseline PDF: ${err instanceof Error ? err.message : String(err)}`
      };
    }
    return {
      checked: true,
      fidelity_status: 'PASS'
    };
  }

  // ── 5. Compare against baseline ───────────────────────────────────────
  let reportPath: string | undefined;
  try {
    const fidelityReport = await comparePdfs(capturedPath, baselinePath);

    // Write fidelity report to outputDir
    try {
      await writeFidelityReport(fidelityReport, outputDir);
      reportPath = path.join(outputDir, `${fidelityReport.comparison_id}.json`);
    } catch (_) { /* report write failure is non-fatal */ }

    const fidelityStatus = fidelityReport.result;
    const result: PdfCheckResult = {
      checked: true,
      fidelity_status: fidelityStatus,
      report_path: reportPath
    };

    if (fidelityStatus === 'FAIL') {
      const firstDiscrepancy = fidelityReport.discrepancies[0];
      result.failure_reason = firstDiscrepancy
        ? firstDiscrepancy.description
        : `Overall similarity ${(fidelityReport.overall_similarity * 100).toFixed(1)}% below threshold`;
    }

    return result;
  } catch (err) {
    return {
      checked: false,
      fidelity_status: 'SKIPPED',
      failure_reason: `PDF comparison failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}
