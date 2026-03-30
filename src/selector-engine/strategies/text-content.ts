/**
 * WCRS Selector Strategy: Text Content
 * Medium-resilience strategy based on visible text inside an element.
 * Works well for buttons and links with stable labels.
 * Playwright equivalent: page.getByText('Run Now') / page.getByRole(..., { name: 'Run Now' })
 */

import type { SelectorCandidate } from '../../types/index.js';

export interface TextContentInfo {
  tag: string;
  visibleText: string | null;
  placeholder?: string | null;
  value?: string | null;       // for inputs
  type?: string | null;        // for inputs
}

/**
 * Generate text-content selector candidates.
 *
 * @param info - Element text information
 * @returns Array of SelectorCandidate
 */
export function generateTextSelectors(info: TextContentInfo): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = [];
  const tag = info.tag.toLowerCase();

  // Primary: visible inner text
  const text = normalizeText(info.visibleText);
  if (text && text.length > 0 && text.length <= 100) {
    candidates.push({
      strategy: 'text',
      selector: `${tag}:has-text("${escapeCss(text)}")`,
      resilience: 0.80,
      playwright_locator: `page.getByText('${escapeJs(text)}', { exact: true })`
    });

    // For links and buttons, also generate a partial-match variant
    if (['a', 'button', 'span', 'div'].includes(tag) && text.length > 10) {
      const shortText = text.slice(0, Math.min(30, text.length));
      if (shortText !== text) {
        candidates.push({
          strategy: 'text',
          selector: `${tag}:has-text("${escapeCss(shortText)}")`,
          resilience: 0.70,
          playwright_locator: `page.getByText('${escapeJs(shortText)}')`
        });
      }
    }
  }

  // Fallback: placeholder text (for inputs)
  const placeholder = normalizeText(info.placeholder);
  if (placeholder && placeholder.length > 0 && placeholder.length <= 60) {
    candidates.push({
      strategy: 'text',
      selector: `${tag}[placeholder="${escapeCss(placeholder)}"]`,
      resilience: 0.72,
      playwright_locator: `page.getByPlaceholder('${escapeJs(placeholder)}')`
    });
  }

  // Fallback: label text (getByLabel) — generate as hint, not CSS selector
  if (info.type && ['text', 'email', 'password', 'number', 'date', 'search'].includes(info.type)) {
    if (text) {
      candidates.push({
        strategy: 'text',
        selector: `input[type="${info.type}"]`,
        resilience: 0.55,
        playwright_locator: `page.getByLabel('${escapeJs(text)}')`
      });
    }
  }

  return candidates;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text.trim().replace(/\s+/g, ' ');
}

function escapeCss(value: string): string {
  return value.replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, '');
}

function escapeJs(value: string): string {
  return value.replace(/'/g, "\\'").replace(/\n/g, ' ').replace(/\r/g, '');
}
