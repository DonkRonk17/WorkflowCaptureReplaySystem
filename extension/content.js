/**
 * WCRS Content Script (Module 1 — Action-State Recorder)
 * Injected into every frame. Listens for user interactions and sends
 * structured ActionEvent objects to the background service worker.
 *
 * NOTE: This script runs in an ISOLATED world so it cannot access page JS,
 * but it can observe the DOM and intercept user events.
 */

(function () {
  'use strict';

  // ── Guard: only run if recording active ─────────────────────────────────

  let isRecording = false;
  let frameContext = null;

  window.addEventListener('wcrs:start', () => { isRecording = true; });
  window.addEventListener('wcrs:stop', () => { isRecording = false; });

  // Check if recording was already active when this script loaded
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (response?.recording) isRecording = true;
  });

  // ── Frame Context ────────────────────────────────────────────────────────

  function getFramePath() {
    const path = ['main'];
    let win = window;
    while (win !== win.parent) {
      try {
        const frames = win.parent.document.querySelectorAll('iframe');
        for (const iframe of frames) {
          if (iframe.contentWindow === win) {
            const id = iframe.id ? `iframe#${iframe.id}` : `iframe[src*="${new URL(iframe.src || location.href).pathname.split('/').pop()}"]`;
            path.splice(1, 0, id);
            break;
          }
        }
      } catch (_) {
        path.splice(1, 0, 'iframe[cross-origin]');
      }
      win = win.parent;
    }
    return path;
  }

  // ── State Capture ────────────────────────────────────────────────────────

  function capturePageState() {
    return {
      url: location.href,
      title: document.title,
      dom_snapshot_hash: hashKeyElements(),
      timestamp: new Date().toISOString()
    };
  }

  function hashKeyElements() {
    // Hash key structural elements (nav, headings, form labels) for state identity
    const selectors = ['h1', 'h2', '.page-title', '[role="main"] h1', '.patient-name', '.breadcrumb', 'nav a.active'];
    const texts = selectors.flatMap(sel => {
      try {
        return Array.from(document.querySelectorAll(sel)).map(el => el.textContent?.trim() || '');
      } catch (_) { return []; }
    }).filter(Boolean).slice(0, 20);
    return simpleHash(texts.join('|'));
  }

  function simpleHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  // ── Selector Generation (inline for content script context) ──────────────

  function generateSelectors(element) {
    const candidates = [];

    // Strategy 1: ARIA role
    const role = element.getAttribute('role') || inferAriaRole(element);
    const ariaLabel = element.getAttribute('aria-label') || element.getAttribute('aria-labelledby');
    const visibleText = getVisibleText(element);
    if (role && (ariaLabel || visibleText)) {
      const name = ariaLabel || visibleText;
      candidates.push({ strategy: 'role', selector: `[role="${role}"][aria-label="${name}"]`, resilience: 0.95 });
    }

    // Strategy 2: Test ID
    const testId = element.getAttribute('data-test') || element.getAttribute('data-testid') || element.getAttribute('data-qa');
    if (testId) {
      candidates.push({ strategy: 'testId', selector: `[data-test="${testId}"]`, resilience: 0.90 });
    }

    // Strategy 3: Text content
    const text = visibleText;
    if (text && text.length < 80) {
      const tag = element.tagName.toLowerCase();
      candidates.push({ strategy: 'text', selector: `${tag}:contains("${text}")`, resilience: 0.80 });
    }

    // Strategy 4: Stable attributes (id, name)
    if (element.id) {
      const stable = !/\d{4,}|[a-f0-9]{8,}/i.test(element.id);
      candidates.push({ strategy: 'attribute', selector: `#${element.id}`, resilience: stable ? 0.75 : 0.50 });
    }
    if (element.name) {
      candidates.push({ strategy: 'attribute', selector: `[name="${element.name}"]`, resilience: 0.70 });
    }

    // Strategy 5: CSS structural (least resilient)
    const cssPath = getCSSPath(element);
    if (cssPath) {
      candidates.push({ strategy: 'css', selector: cssPath, resilience: 0.30 });
    }

    // Deduplicate and sort by resilience
    const seen = new Set();
    return candidates.filter(c => {
      if (seen.has(c.selector)) return false;
      seen.add(c.selector);
      return true;
    }).sort((a, b) => b.resilience - a.resilience).slice(0, 5);
  }

  function inferAriaRole(element) {
    const tag = element.tagName.toLowerCase();
    const roleMap = { button: 'button', a: 'link', input: element.type || 'textbox', select: 'listbox', textarea: 'textbox', nav: 'navigation', main: 'main', header: 'banner', form: 'form' };
    return roleMap[tag] || null;
  }

  function getVisibleText(element) {
    return (element.innerText || element.textContent || element.value || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  }

  function getCSSPath(element) {
    const parts = [];
    let el = element;
    while (el && el.tagName) {
      let part = el.tagName.toLowerCase();
      if (el.id) {
        part += `#${el.id}`;
        parts.unshift(part);
        break;
      }
      const siblings = el.parentElement ? Array.from(el.parentElement.children).filter(c => c.tagName === el.tagName) : [];
      if (siblings.length > 1) {
        const idx = siblings.indexOf(el) + 1;
        part += `:nth-of-type(${idx})`;
      }
      parts.unshift(part);
      el = el.parentElement;
      if (parts.length > 5) break;
    }
    return parts.join(' > ');
  }

  // ── Event Listeners ──────────────────────────────────────────────────────

  // Capture click events
  document.addEventListener('click', (event) => {
    if (!isRecording) return;
    const target = event.target;
    if (!target || target === document.body) return;

    const stateBefore = capturePageState();

    // Small delay to let state settle after click
    setTimeout(() => {
      sendAction({
        timestamp: new Date().toISOString(),
        action_type: 'click',
        target: buildTarget(target, event),
        input_value: null,
        state_before: stateBefore,
        state_after: capturePageState()
      });
    }, 200);
  }, true);

  // Capture input / type events
  document.addEventListener('input', (event) => {
    if (!isRecording) return;
    const target = event.target;
    if (!target || !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

    sendAction({
      timestamp: new Date().toISOString(),
      action_type: target.tagName === 'SELECT' ? 'select' : 'type',
      target: buildTarget(target, null),
      input_value: target.tagName === 'SELECT' ? target.options[target.selectedIndex]?.text : '[REDACTED]',
      state_before: capturePageState(),
      state_after: capturePageState()
    });
  }, true);

  // Capture form submit
  document.addEventListener('submit', (event) => {
    if (!isRecording) return;
    sendAction({
      timestamp: new Date().toISOString(),
      action_type: 'submit',
      target: buildTarget(event.target, null),
      input_value: null,
      state_before: capturePageState(),
      state_after: capturePageState()
    });
  }, true);

  // Capture keyboard shortcuts (Enter, Tab, Escape, F keys)
  document.addEventListener('keydown', (event) => {
    if (!isRecording) return;
    const significant = ['Enter', 'Escape', 'Tab', 'F1', 'F2', 'F3', 'F4', 'F5'];
    if (!significant.includes(event.key) && !event.ctrlKey && !event.altKey) return;

    sendAction({
      timestamp: new Date().toISOString(),
      action_type: 'keydown',
      target: buildTarget(event.target, null),
      input_value: event.key,
      state_before: capturePageState(),
      state_after: capturePageState()
    });
  }, true);

  // ── Build Target Object ──────────────────────────────────────────────────

  function buildTarget(element, event) {
    if (!element || element === document || element === document.body) return null;
    return {
      selectors: generateSelectors(element),
      visible_text: getVisibleText(element),
      tag: element.tagName?.toLowerCase(),
      frame_path: getFramePath(),
      bounding_rect: element.getBoundingClientRect ? {
        x: Math.round(element.getBoundingClientRect().left),
        y: Math.round(element.getBoundingClientRect().top),
        w: Math.round(element.getBoundingClientRect().width),
        h: Math.round(element.getBoundingClientRect().height)
      } : null
    };
  }

  // ── Send to Background ───────────────────────────────────────────────────

  function sendAction(action) {
    chrome.runtime.sendMessage({ type: 'ACTION_CAPTURED', action }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[WCRS] Failed to send action:', chrome.runtime.lastError.message);
      }
    });
  }

  console.log('[WCRS] Content script loaded in frame:', location.href.slice(0, 80));
})();
