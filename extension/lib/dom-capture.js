/**
 * WCRS DOM Capture Library
 * Extracts page state snapshots and generates resilient CSS selectors
 * from DOM elements. Runs in the content script context.
 *
 * Exported as a reusable module — also consumed by tests.
 */

'use strict';

/**
 * Capture a lightweight page state snapshot.
 * The snapshot is designed for state identity comparison, not full DOM serialization.
 *
 * @returns {PageStateSnapshot}
 */
export function capturePageState() {
  return {
    url: location.href,
    title: document.title,
    dom_snapshot_hash: hashKeyElements(),
    timestamp: new Date().toISOString(),
    screenshot_ref: null  // populated by screenshot-capture.js after capture
  };
}

/**
 * Hash the key structural elements of a page for state identity.
 * Only hashes elements that are stable (navigation, headings, breadcrumbs)
 * and ignores dynamic content (timestamps, patient IDs in text).
 *
 * @returns {string} 8-char hex hash
 */
export function hashKeyElements() {
  const stabilizers = [
    'h1', 'h2',
    '.page-title', '[class*="pageTitle"]',
    '[role="main"] h1',
    '.patient-name', '[class*="patientName"]',
    '.breadcrumb a', 'nav .active',
    '[role="navigation"] a[aria-current]',
    'title',
    '[data-test="page-header"]'
  ];

  const texts = [];
  for (const sel of stabilizers) {
    try {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (t && t.length < 200) texts.push(t);
      }
    } catch (_) { /* invalid selector on some pages */ }
  }

  // Also include active form field names/labels for form-state identity
  try {
    const activeEl = document.activeElement;
    if (activeEl && activeEl.name) texts.push(`active:${activeEl.name}`);
  } catch (_) { /* cross-origin frame */ }

  return djb2Hash(texts.slice(0, 20).join('|'));
}

/**
 * Generate a ranked array of selector candidates for a DOM element.
 * Returns candidates sorted by resilience (most resilient first).
 *
 * @param {HTMLElement} element
 * @returns {SelectorCandidate[]}
 */
export function generateSelectors(element) {
  if (!element || !element.tagName) return [];

  const candidates = [];
  const seen = new Set();

  function add(candidate) {
    if (!candidate || seen.has(candidate.selector)) return;
    seen.add(candidate.selector);
    candidates.push(candidate);
  }

  // ── Strategy 1: ARIA Role (resilience 0.90–0.95) ──────────────────────
  const role = element.getAttribute('role') || inferAriaRole(element);
  const ariaLabel = element.getAttribute('aria-label');
  const ariaLabelledBy = element.getAttribute('aria-labelledby');
  const visibleText = getVisibleText(element);

  if (role) {
    const name = ariaLabel || (ariaLabelledBy ? getTextById(ariaLabelledBy) : null) || visibleText;
    if (name) {
      add({ strategy: 'role', selector: `[role="${role}"][aria-label="${escapeAttr(name)}"]`, resilience: 0.95 });
    } else {
      add({ strategy: 'role', selector: `[role="${role}"]`, resilience: 0.60 });
    }
  }

  // ── Strategy 2: Test ID (resilience 0.90) ────────────────────────────
  const testId = element.getAttribute('data-test')
    || element.getAttribute('data-testid')
    || element.getAttribute('data-qa')
    || element.getAttribute('data-cy');
  if (testId) {
    const attr = element.getAttribute('data-test') ? 'data-test' : element.getAttribute('data-testid') ? 'data-testid' : element.getAttribute('data-qa') ? 'data-qa' : 'data-cy';
    add({ strategy: 'testId', selector: `[${attr}="${escapeAttr(testId)}"]`, resilience: 0.90 });
  }

  // ── Strategy 3: Text Content (resilience 0.80) ───────────────────────
  if (visibleText && visibleText.length > 0 && visibleText.length < 80) {
    const tag = element.tagName.toLowerCase();
    const textForSelector = visibleText.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    add({ strategy: 'text', selector: `${tag}:has-text("${textForSelector}")`, resilience: 0.80 });
  }

  // ── Strategy 4a: Stable ID (resilience 0.75 or 0.50) ────────────────
  if (element.id) {
    const stable = isStableId(element.id);
    add({ strategy: 'attribute', selector: `#${CSS.escape(element.id)}`, resilience: stable ? 0.75 : 0.50 });
  }

  // ── Strategy 4b: Name attribute (resilience 0.70) ────────────────────
  if (element.getAttribute('name')) {
    add({ strategy: 'attribute', selector: `[name="${escapeAttr(element.getAttribute('name'))}"]`, resilience: 0.70 });
  }

  // ── Strategy 4c: Type + value for inputs (resilience 0.65) ──────────
  if (element.tagName === 'INPUT' && element.type && !['text', 'password', 'hidden'].includes(element.type)) {
    add({ strategy: 'attribute', selector: `input[type="${element.type}"]`, resilience: 0.65 });
  }

  // ── Strategy 5: CSS Structural (resilience 0.30) ─────────────────────
  const cssPath = buildCSSPath(element);
  if (cssPath) {
    add({ strategy: 'css', selector: cssPath, resilience: 0.30 });
  }

  return candidates.sort((a, b) => b.resilience - a.resilience).slice(0, 5);
}

/**
 * Capture element bounding rect.
 * @param {HTMLElement} element
 * @returns {BoundingRect|null}
 */
export function getBoundingRect(element) {
  if (!element || !element.getBoundingClientRect) return null;
  const r = element.getBoundingClientRect();
  return {
    x: Math.round(r.left + window.scrollX),
    y: Math.round(r.top + window.scrollY),
    w: Math.round(r.width),
    h: Math.round(r.height)
  };
}

// ── Private Helpers ────────────────────────────────────────────────────────

function inferAriaRole(element) {
  const tag = element.tagName.toLowerCase();
  const type = element.type?.toLowerCase();
  const roleMap = {
    a: 'link',
    button: 'button',
    nav: 'navigation',
    main: 'main',
    header: 'banner',
    footer: 'contentinfo',
    form: 'form',
    table: 'table',
    select: 'listbox',
    textarea: 'textbox',
    input: type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : type === 'submit' || type === 'button' ? 'button' : 'textbox'
  };
  return roleMap[tag] || null;
}

function getVisibleText(element) {
  return ((element.innerText || element.textContent || element.value || element.placeholder || '')).trim().replace(/\s+/g, ' ').slice(0, 100);
}

function getTextById(id) {
  try {
    const el = document.getElementById(id);
    return el ? (el.textContent || '').trim().slice(0, 100) : null;
  } catch (_) { return null; }
}

function isStableId(id) {
  // IDs with long numeric sequences or hex hashes are likely dynamic
  return !/\d{4,}|[a-f0-9]{8,}/i.test(id) && id.length < 50;
}

function escapeAttr(value) {
  return (value || '').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function buildCSSPath(element, maxDepth = 5) {
  const parts = [];
  let el = element;
  let depth = 0;

  while (el && el.tagName && depth < maxDepth) {
    let part = el.tagName.toLowerCase();
    if (el.id && isStableId(el.id)) {
      parts.unshift(`#${CSS.escape(el.id)}`);
      break;
    }
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(el) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(part);
    el = el.parentElement;
    depth++;
  }

  return parts.length > 0 ? parts.join(' > ') : null;
}

function djb2Hash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * @typedef {Object} PageStateSnapshot
 * @property {string} url
 * @property {string} title
 * @property {string} dom_snapshot_hash
 * @property {string} timestamp
 * @property {string|null} screenshot_ref
 */

/**
 * @typedef {Object} SelectorCandidate
 * @property {'role'|'testId'|'text'|'attribute'|'css'} strategy
 * @property {string} selector
 * @property {number} resilience - 0.0 to 1.0
 */

/**
 * @typedef {Object} BoundingRect
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */
