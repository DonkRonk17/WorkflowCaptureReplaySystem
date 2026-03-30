/**
 * WCRS Selector Strategy: CSS Structural
 * Least-resilient strategy. Generates CSS path from element to root.
 * Only used as last resort when no semantic selectors are available.
 * Playwright equivalent: page.locator('div.content > form > button:nth-of-type(2)')
 */

import type { SelectorCandidate } from '../../types/index.js';

export interface CSSPathInfo {
  tag: string;
  id?: string | null;
  className?: string | null;
  nthOfType?: number;           // 1-based index among same-tag siblings
  parentPath?: string | null;   // pre-built parent CSS path
  depth: number;                // how many levels deep in DOM
}

/**
 * Generate a CSS structural selector candidate.
 *
 * @param info - Path information for the element
 * @returns Single SelectorCandidate or null if cannot be built
 */
export function generateCSSSelector(info: CSSPathInfo): SelectorCandidate | null {
  const selector = buildSelector(info);
  if (!selector) return null;

  return {
    strategy: 'css',
    selector,
    resilience: 0.30,
    playwright_locator: `page.locator('${escapeJs(selector)}')`
  };
}

/**
 * Build a full CSS path from a list of ancestor elements.
 * Each entry in the ancestors array is ordered from root to element.
 *
 * @param ancestors - Ordered from root → target element
 * @param maxDepth - How many levels back to include (default 5)
 * @returns CSS selector string
 */
export function buildCSSPathFromAncestors(
  ancestors: Array<{ tag: string; id?: string | null; className?: string | null; nthOfType?: number }>,
  maxDepth = 5
): string {
  const parts: string[] = [];
  const slice = ancestors.slice(-maxDepth);

  for (const node of slice) {
    let part = node.tag.toLowerCase();
    if (node.id && isStableId(node.id)) {
      part = `#${cssEscape(node.id)}`;
      parts.push(part);
      break; // ID is unique, stop here
    }
    if (node.nthOfType && node.nthOfType > 1) {
      part += `:nth-of-type(${node.nthOfType})`;
    }
    parts.push(part);
  }

  return parts.join(' > ');
}

// ── Private ────────────────────────────────────────────────────────────────

function buildSelector(info: CSSPathInfo): string | null {
  const parts: string[] = [];

  // Add parent path if available
  if (info.parentPath) {
    parts.push(info.parentPath);
  }

  let part = info.tag.toLowerCase();

  if (info.id && isStableId(info.id)) {
    return `#${cssEscape(info.id)}`;
  }

  if (info.nthOfType && info.nthOfType > 1) {
    part += `:nth-of-type(${info.nthOfType})`;
  }

  parts.push(part);
  return parts.join(' > ');
}

function isStableId(id: string): boolean {
  if (!id || id.length > 60) return false;
  if (/\d{5,}/.test(id)) return false;
  if (/[a-f0-9]{8}-[a-f0-9]{4}/i.test(id)) return false;
  return true;
}

function cssEscape(value: string): string {
  return value.replace(/([^\w-])/g, '\\$1');
}

function escapeJs(value: string): string {
  return value.replace(/'/g, "\\'");
}
