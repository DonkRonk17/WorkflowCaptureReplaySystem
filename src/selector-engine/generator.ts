/**
 * WCRS Selector Generator (Module 3 — Selector Resilience Engine)
 * Orchestrates all five selector strategies and returns a ranked list
 * of SelectorCandidate objects for a given element's metadata.
 *
 * This module is the server-side counterpart to extension/lib/dom-capture.js.
 * It operates on serialized element info (not live DOM) and produces
 * Playwright-compatible locator strings.
 *
 * Bible spec: "Generate ranked lists of selectors for every target element,
 * ordered by resilience to DOM changes."
 */

import type { SelectorCandidate, SelectorStrategy } from '../types/index.js';
import { generateAriaSelectors, type DOMElementInfo } from './strategies/aria-role.js';
import { generateTestIdSelectors, type TestIdInfo, TEST_ID_ATTRIBUTES } from './strategies/test-id.js';
import { generateTextSelectors, type TextContentInfo } from './strategies/text-content.js';
import { generateAttributeSelectors, type AttributeInfo } from './strategies/attribute.js';
import { generateCSSSelector, type CSSPathInfo } from './strategies/css-structural.js';

/** Full element descriptor used to generate selectors */
export interface ElementDescriptor {
  // Basic info
  tag: string;
  type?: string | null;

  // ARIA
  role?: string | null;
  ariaLabel?: string | null;
  ariaLabelledBy?: string | null;

  // Text
  visibleText?: string | null;
  placeholder?: string | null;
  value?: string | null;

  // Attributes
  id?: string | null;
  name?: string | null;
  href?: string | null;
  src?: string | null;
  alt?: string | null;
  title?: string | null;
  className?: string | null;

  // Test IDs
  testAttributes?: Record<string, string | null>;

  // CSS path
  nthOfType?: number;
  parentCssPath?: string | null;
  depth?: number;
}

export interface GeneratorConfig {
  maxCandidates?: number;       // default: 5
  minResilience?: number;       // default: 0.0 (include all)
  strategies?: SelectorStrategy[];  // default: all
}

/**
 * Generate a ranked list of selector candidates for an element.
 *
 * @param element - Element descriptor (from DOM capture)
 * @param config - Generator configuration
 * @returns Deduplicated candidates sorted by resilience descending
 */
export function generateSelectors(
  element: ElementDescriptor,
  config: GeneratorConfig = {}
): SelectorCandidate[] {
  const maxCandidates = config.maxCandidates ?? 5;
  const minResilience = config.minResilience ?? 0.0;
  const enabledStrategies = new Set(config.strategies ?? (['role', 'testId', 'text', 'attribute', 'css'] as SelectorStrategy[]));

  const all: SelectorCandidate[] = [];

  // ── Strategy 1: ARIA Role ────────────────────────────────────────────
  if (enabledStrategies.has('role')) {
    const ariaInfo: DOMElementInfo = {
      tag: element.tag,
      type: element.type || undefined,
      role: element.role,
      ariaLabel: element.ariaLabel,
      ariaLabelledBy: element.ariaLabelledBy,
      visibleText: element.visibleText,
      placeholder: element.placeholder
    };
    all.push(...generateAriaSelectors(ariaInfo));
  }

  // ── Strategy 2: Test ID ──────────────────────────────────────────────
  if (enabledStrategies.has('testId')) {
    const testIdInfo: TestIdInfo = {
      attributes: element.testAttributes || buildTestAttributes(element)
    };
    all.push(...generateTestIdSelectors(testIdInfo));
  }

  // ── Strategy 3: Text Content ─────────────────────────────────────────
  if (enabledStrategies.has('text')) {
    const textInfo: TextContentInfo = {
      tag: element.tag,
      visibleText: element.visibleText || null,
      placeholder: element.placeholder || null,
      value: element.value || null,
      type: element.type || null
    };
    all.push(...generateTextSelectors(textInfo));
  }

  // ── Strategy 4: Stable Attributes ───────────────────────────────────
  if (enabledStrategies.has('attribute')) {
    const attrInfo: AttributeInfo = {
      tag: element.tag,
      id: element.id || null,
      name: element.name || null,
      type: element.type || null,
      href: element.href || null,
      src: element.src || null,
      alt: element.alt || null,
      title: element.title || null,
      className: element.className || null,
      value: element.value || null
    };
    all.push(...generateAttributeSelectors(attrInfo));
  }

  // ── Strategy 5: CSS Structural ───────────────────────────────────────
  if (enabledStrategies.has('css')) {
    const cssInfo: CSSPathInfo = {
      tag: element.tag,
      id: element.id || null,
      className: element.className || null,
      nthOfType: element.nthOfType,
      parentPath: element.parentCssPath || null,
      depth: element.depth ?? 0
    };
    const cssCandidate = generateCSSSelector(cssInfo);
    if (cssCandidate) all.push(cssCandidate);
  }

  // ── Deduplicate and rank ─────────────────────────────────────────────
  const seen = new Set<string>();
  const unique = all.filter(c => {
    if (seen.has(c.selector)) return false;
    seen.add(c.selector);
    return c.resilience >= minResilience;
  });

  return unique
    .sort((a, b) => b.resilience - a.resilience)
    .slice(0, maxCandidates);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildTestAttributes(element: ElementDescriptor): Record<string, string | null> {
  const attrs: Record<string, string | null> = {};
  for (const attr of TEST_ID_ATTRIBUTES) {
    attrs[attr] = null; // will be null unless explicitly provided
  }
  return attrs;
}
