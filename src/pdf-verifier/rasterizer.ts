/**
 * WCRS PDF Rasterizer (Module 4 — PDF Fidelity Verifier)
 * Converts PDF pages to PNG images using pdftoppm for pixel-level comparison.
 *
 * Bible spec (BH-005):
 *   "Visual fidelity matters because insurance companies review them."
 *   "If pdftoppm not installed: return null, log warning."
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ── Availability Check ─────────────────────────────────────────────────────

/**
 * Check whether pdftoppm is installed and available on PATH.
 */
export function isPdftoppmAvailable(): boolean {
  try {
    execSync('which pdftoppm', { stdio: 'ignore' });
    return true;
  } catch {
    try {
      execSync('pdftoppm -h', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Rasterize a PDF file into one PNG per page using pdftoppm.
 *
 * @param pdfPath   - Absolute or relative path to the input PDF
 * @param outputDir - Directory to write output PNGs into (created if absent)
 * @param dpi       - Render resolution (default 150)
 * @returns Array of PNG file paths (sorted by page order), or null if pdftoppm
 *          is not installed.
 */
export async function rasterizePdf(
  pdfPath: string,
  outputDir: string,
  dpi: number = 150
): Promise<string[] | null> {
  if (!isPdftoppmAvailable()) {
    console.warn('[WCRS rasterizer] pdftoppm is not installed — skipping visual diff');
    return null;
  }

  const absolutePdf = path.resolve(pdfPath);
  const absoluteOut = path.resolve(outputDir);

  if (!fs.existsSync(absoluteOut)) {
    fs.mkdirSync(absoluteOut, { recursive: true });
  }

  // Generate a unique prefix based on the PDF filename to avoid collisions
  const baseName = path.basename(absolutePdf, '.pdf');
  const outputPrefix = path.join(absoluteOut, baseName);

  try {
    // -r <dpi>  — render resolution
    // -png      — output PNG files
    execSync(`pdftoppm -r ${dpi} -png "${absolutePdf}" "${outputPrefix}"`, {
      stdio: 'pipe'
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[WCRS rasterizer] pdftoppm failed for ${absolutePdf}: ${msg}`);
    return null;
  }

  // pdftoppm names files: <prefix>-1.png, <prefix>-2.png … (zero-padded varies)
  const pngFiles = fs
    .readdirSync(absoluteOut)
    .filter(f => f.startsWith(baseName) && f.endsWith('.png'))
    .sort()
    .map(f => path.join(absoluteOut, f));

  return pngFiles;
}
