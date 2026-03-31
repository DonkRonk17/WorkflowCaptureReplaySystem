/**
 * WCRS PDF Reporter (Module 4 — PDF Fidelity Verifier)
 * Writes FidelityReport to JSON + Markdown summary files.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FidelityReport } from './comparator.js';

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Write a FidelityReport as both JSON and Markdown to outputDir.
 *
 * @param report    - The FidelityReport to persist
 * @param outputDir - Directory to write into (created if missing)
 */
export async function writeReport(report: FidelityReport, outputDir: string): Promise<void> {
  const absDir = path.resolve(outputDir);
  if (!fs.existsSync(absDir)) {
    fs.mkdirSync(absDir, { recursive: true });
  }

  const jsonPath = path.join(absDir, `${report.comparison_id}.json`);
  const mdPath = path.join(absDir, `${report.comparison_id}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(mdPath, formatMarkdown(report), 'utf-8');
}

/**
 * Format a FidelityReport as a Markdown summary string.
 *
 * @param report - The report to format
 * @returns Markdown string
 */
export function formatMarkdown(report: FidelityReport): string {
  const badge = resultBadge(report.result);
  const simPct = (report.overall_similarity * 100).toFixed(1);
  const textPct = (report.checks.text_content_similarity * 100).toFixed(1);
  const visualStr =
    report.checks.visual_similarity !== null
      ? `${(report.checks.visual_similarity * 100).toFixed(1)}%`
      : 'N/A (pdftoppm unavailable)';

  const discrepancyRows = report.discrepancies.length === 0
    ? '_No discrepancies found._'
    : report.discrepancies
        .map(d => `- **Page ${d.page === 0 ? 'N/A' : d.page}** [\`${d.type}\`]: ${d.description}`)
        .join('\n');

  return `# PDF Fidelity Report

**Result:** ${badge}
**Comparison ID:** \`${report.comparison_id}\`
**Generated:** ${report.generated_at}

## Files

| | Path |
|---|---|
| Generated | \`${report.generated_pdf}\` |
| Reference | \`${report.reference_pdf}\` |

## Similarity

| Check | Value |
|---|---|
| Overall Similarity | ${simPct}% |
| Text Similarity | ${textPct}% |
| Visual Similarity | ${visualStr} |
| Page Count Match | ${report.checks.page_count_match ? '✓ Yes' : '✗ No'} |
| Orientation Match | ${report.checks.orientation_match ? '✓ Yes' : '✗ No'} |
| Margins Within Tolerance | ${report.checks.margins_within_tolerance ? '✓ Yes' : '✗ No'} |
| 2-Up Layout Detected | ${report.is_two_up_layout ? '⚠ Yes (OS/MAR/TAR)' : 'No'} |

## Discrepancies

${discrepancyRows}
`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function resultBadge(result: FidelityReport['result']): string {
  switch (result) {
    case 'PASS': return '🟢 **PASS**';
    case 'WARN': return '🟡 **WARN**';
    case 'FAIL': return '🔴 **FAIL**';
  }
}
