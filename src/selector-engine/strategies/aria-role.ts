/**
 * WCRS Selector Strategy: ARIA Role
 * Most resilient strategy. Uses semantic role + accessible name.
 * Playwright equivalent: page.getByRole('button', { name: 'Run Now' })
 */

import type { SelectorCandidate } from '../../types/index.js';

/** Map of HTML tags to their implicit ARIA roles */
const IMPLICIT_ROLE_MAP: Record<string, string> = {
  a: 'link',
  button: 'button',
  nav: 'navigation',
  main: 'main',
  header: 'banner',
  footer: 'contentinfo',
  aside: 'complementary',
  section: 'region',
  article: 'article',
  form: 'form',
  table: 'table',
  thead: 'rowgroup',
  tbody: 'rowgroup',
  tr: 'row',
  th: 'columnheader',
  td: 'cell',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  select: 'listbox',
  option: 'option',
  textarea: 'textbox',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  dialog: 'dialog',
  img: 'img',
  input: 'textbox', // refined by type below
  hr: 'separator',
};

const INPUT_TYPE_ROLES: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio',
  button: 'button',
  submit: 'button',
  reset: 'button',
  range: 'slider',
  search: 'searchbox',
  spinbutton: 'spinbutton',
};

export interface DOMElementInfo {
  tag: string;
  type?: string;               // for <input>
  role?: string | null;        // explicit role attribute
  ariaLabel?: string | null;
  ariaLabelledBy?: string | null;
  visibleText?: string | null;
  placeholder?: string | null;
  level?: number;              // for headings
}

/**
 * Generate ARIA role selector candidates from element metadata.
 *
 * @param element - DOM element attribute info
 * @returns Array of SelectorCandidate (may be empty if no role can be inferred)
 */
export function generateAriaSelectors(element: DOMElementInfo): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = [];

  const role = element.role || inferRole(element);
  if (!role) return candidates;

  const name = pickAccessibleName(element);

  if (name) {
    // Full role + name selector — highest resilience
    candidates.push({
      strategy: 'role',
      selector: `[role="${role}"][aria-label="${escapeCss(name)}"]`,
      resilience: 0.95,
      playwright_locator: `page.getByRole('${role}', { name: '${escapeJs(name)}' })`
    });

    // Alternative: Playwright getByRole without explicit role attribute requirement
    if (role !== 'textbox' && role !== 'generic') {
      candidates.push({
        strategy: 'role',
        selector: `${roleToTag(role, element.type)}[aria-label="${escapeCss(name)}"]`,
        resilience: 0.88,
        playwright_locator: `page.getByRole('${role}', { name: '${escapeJs(name)}' })`
      });
    }
  } else {
    // Role only — lower resilience (many elements may share same role)
    candidates.push({
      strategy: 'role',
      selector: `[role="${role}"]`,
      resilience: 0.55,
      playwright_locator: `page.getByRole('${role}')`
    });
  }

  return candidates;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function inferRole(element: DOMElementInfo): string | null {
  const tag = element.tag.toLowerCase();
  if (tag === 'input' && element.type) {
    return INPUT_TYPE_ROLES[element.type.toLowerCase()] || 'textbox';
  }
  return IMPLICIT_ROLE_MAP[tag] || null;
}

function pickAccessibleName(element: DOMElementInfo): string | null {
  // Priority: aria-label > visible text > placeholder
  if (element.ariaLabel) return element.ariaLabel.trim().slice(0, 80);
  if (element.visibleText) return element.visibleText.trim().slice(0, 80);
  if (element.placeholder) return element.placeholder.trim().slice(0, 80);
  return null;
}

function roleToTag(role: string, inputType?: string): string {
  const map: Record<string, string> = {
    button: 'button',
    link: 'a',
    textbox: inputType ? `input[type="${inputType}"]` : 'input',
    checkbox: 'input[type="checkbox"]',
    radio: 'input[type="radio"]',
    navigation: 'nav',
    heading: 'h1, h2, h3, h4, h5, h6',
    listbox: 'select',
  };
  return map[role] || `[role="${role}"]`;
}

function escapeCss(value: string): string {
  return value.replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function escapeJs(value: string): string {
  return value.replace(/'/g, "\\'").replace(/\n/g, ' ');
}
