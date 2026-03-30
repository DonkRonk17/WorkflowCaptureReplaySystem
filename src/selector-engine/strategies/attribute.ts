/**
 * WCRS Selector Strategy: Stable Attributes
 * Uses id, name, type, and other stable HTML attributes.
 * Resilience depends on whether the attribute value appears dynamic.
 */

import type { SelectorCandidate } from '../../types/index.js';

export interface AttributeInfo {
  id?: string | null;
  name?: string | null;
  type?: string | null;
  tag: string;
  value?: string | null;
  href?: string | null;
  src?: string | null;
  alt?: string | null;
  title?: string | null;
  className?: string | null;
}

/**
 * Generate attribute-based selector candidates.
 *
 * @param info - Element attribute information
 * @returns Array of SelectorCandidate
 */
export function generateAttributeSelectors(info: AttributeInfo): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = [];
  const tag = info.tag.toLowerCase();

  // ── ID selector ──────────────────────────────────────────────────────
  if (info.id) {
    const stable = isStableId(info.id);
    candidates.push({
      strategy: 'attribute',
      selector: `#${cssEscapeId(info.id)}`,
      resilience: stable ? 0.75 : 0.50,
      playwright_locator: `page.locator('#${cssEscapeId(info.id)}')`
    });
  }

  // ── Name attribute ───────────────────────────────────────────────────
  if (info.name) {
    candidates.push({
      strategy: 'attribute',
      selector: `${tag}[name="${escapeCss(info.name)}"]`,
      resilience: 0.70,
      playwright_locator: `page.locator('${tag}[name="${escapeCss(info.name)}"]')`
    });
  }

  // ── Input type (non-text) ────────────────────────────────────────────
  if (tag === 'input' && info.type && !['text', 'hidden', 'password'].includes(info.type)) {
    candidates.push({
      strategy: 'attribute',
      selector: `input[type="${info.type}"]`,
      resilience: 0.60,
      playwright_locator: `page.locator('input[type="${info.type}"]')`
    });
  }

  // ── Anchor href (partial match for relative paths) ───────────────────
  if (tag === 'a' && info.href) {
    const href = normalizeHref(info.href);
    if (href) {
      candidates.push({
        strategy: 'attribute',
        selector: `a[href*="${escapeCss(href)}"]`,
        resilience: 0.65,
        playwright_locator: `page.locator('a[href*="${escapeCss(href)}"]')`
      });
    }
  }

  // ── Alt text for images ──────────────────────────────────────────────
  if (tag === 'img' && info.alt) {
    candidates.push({
      strategy: 'attribute',
      selector: `img[alt="${escapeCss(info.alt)}"]`,
      resilience: 0.68,
      playwright_locator: `page.getByAltText('${escapeJs(info.alt)}')`
    });
  }

  // ── Stable class fragments ───────────────────────────────────────────
  if (info.className) {
    const stableClasses = extractStableClasses(info.className);
    if (stableClasses.length > 0) {
      const selector = `${tag}.${stableClasses.join('.')}`;
      candidates.push({
        strategy: 'attribute',
        selector,
        resilience: 0.45,
        playwright_locator: `page.locator('${selector}')`
      });
    }
  }

  return candidates;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Determine if an ID is likely stable (non-generated).
 * Dynamic IDs often contain long numbers, hashes, or UUIDs.
 */
export function isStableId(id: string): boolean {
  if (!id) return false;
  if (id.length > 60) return false;
  // Contains long numeric sequences → dynamic (e.g., "btn_123456789")
  if (/\d{5,}/.test(id)) return false;
  // Contains UUID-like hex patterns → dynamic
  if (/[a-f0-9]{8}-[a-f0-9]{4}/i.test(id)) return false;
  // Contains random hex hash → dynamic
  if (/[a-f0-9]{12,}/i.test(id)) return false;
  return true;
}

function cssEscapeId(id: string): string {
  // CSS.escape equivalent for IDs
  return id.replace(/([^\w-])/g, '\\$1');
}

function escapeCss(value: string): string {
  return value.replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function escapeJs(value: string): string {
  return value.replace(/'/g, "\\'").replace(/\n/g, ' ');
}

function normalizeHref(href: string): string | null {
  try {
    const url = new URL(href, 'https://example.com');
    const path = url.pathname;
    // Use last 2 path segments as a stable anchor
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    return parts.slice(-2).join('/');
  } catch (_) {
    return null;
  }
}

function extractStableClasses(className: string): string[] {
  const classes = className.split(/\s+/).filter(Boolean);
  return classes.filter(cls => {
    // Skip utility/framework classes that change (e.g. tailwind responsive variants)
    if (/^(sm:|md:|lg:|xl:|2xl:)/.test(cls)) return false;
    // Skip classes with dynamic suffixes (hashes)
    if (/[a-f0-9]{6,}/i.test(cls)) return false;
    // Skip generic layout classes
    if (/^(flex|block|inline|grid|hidden|visible|overflow|text-|bg-|p-|m-|w-|h-)/.test(cls)) return false;
    return cls.length > 2 && cls.length < 40;
  }).slice(0, 2); // max 2 stable classes
}
