/**
 * WCRS Background Service Worker (Module 1 — Action-State Recorder)
 * Manages recording session state, debugger attachment, popup/tab detection,
 * and network event capture via Chrome DevTools Protocol.
 */

import { FrameRegistry } from './lib/frame-tracker.js';
import { NetworkMonitor } from './lib/network-monitor.js';

// ── Recording Session State ────────────────────────────────────────────────

let recordingSession = null;
const frameRegistry = new FrameRegistry();
let networkMonitor = null;

// ── Message Handler (from popup / content scripts) ─────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'START_RECORDING':
      handleStartRecording(message.config, sender.tab)
        .then((session) => sendResponse({ success: true, sessionId: session.id }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // async

    case 'STOP_RECORDING':
      handleStopRecording()
        .then((trace) => sendResponse({ success: true, trace }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'EXPORT_TRACE':
      handleExportTrace()
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_STATUS':
      sendResponse({ recording: recordingSession !== null, session: recordingSession ? { id: recordingSession.id, actionCount: recordingSession.actions.length } : null });
      break;

    case 'ACTION_CAPTURED':
      if (recordingSession) {
        appendAction(message.action, sender);
        sendResponse({ success: true });
      }
      break;

    case 'ADD_CHECKPOINT':
      if (recordingSession && message.label) {
        appendCheckpoint(message.label, sender);
        sendResponse({ success: true });
      }
      break;

    default:
      sendResponse({ error: 'Unknown message type' });
  }
});

// ── Start Recording ────────────────────────────────────────────────────────

async function handleStartRecording(config = {}, tab) {
  if (recordingSession) {
    throw new Error('Recording already in progress');
  }

  const tabId = tab?.id;
  if (!tabId) throw new Error('No active tab found');

  recordingSession = {
    id: generateUUID(),
    started_at: new Date().toISOString(),
    target_app: config.targetApp || 'unknown',
    tab_id: tabId,
    actions: [],
    screenshots: {},
    errors: []
  };

  // Attach Chrome DevTools Protocol debugger
  await attachDebugger(tabId);

  // Start network monitoring
  networkMonitor = new NetworkMonitor(tabId);
  await networkMonitor.start();

  // Notify all content scripts in all frames of the active tab
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => { window.__wcrs_recording = true; window.dispatchEvent(new CustomEvent('wcrs:start')); }
  });

  console.log('[WCRS] Recording started:', recordingSession.id);
  return recordingSession;
}

// ── Stop Recording ─────────────────────────────────────────────────────────

async function handleStopRecording() {
  if (!recordingSession) throw new Error('No recording in progress');

  recordingSession.stopped_at = new Date().toISOString();
  const tabId = recordingSession.tab_id;

  // Notify content scripts
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => { window.__wcrs_recording = false; window.dispatchEvent(new CustomEvent('wcrs:stop')); }
    });
  } catch (_) { /* tab may have navigated away */ }

  // Detach debugger
  await detachDebugger(tabId);

  // Stop network monitor
  if (networkMonitor) {
    networkMonitor.stop();
    networkMonitor = null;
  }

  const trace = buildTrace();
  const saved = recordingSession;
  recordingSession = null;

  // Store trace in extension storage
  await chrome.storage.local.set({ [`trace_${saved.id}`]: trace });
  console.log('[WCRS] Recording stopped. Actions:', trace.actions.length);
  return trace;
}

// ── Export Trace ───────────────────────────────────────────────────────────

async function handleExportTrace() {
  const keys = await chrome.storage.local.get(null);
  const traceKeys = Object.keys(keys).filter(k => k.startsWith('trace_'));
  if (traceKeys.length === 0) throw new Error('No traces found');

  // Export the most recent trace
  const latestKey = traceKeys[traceKeys.length - 1];
  const trace = keys[latestKey];
  const blob = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const filename = `wcrs_trace_${trace.trace_id}_${formatDateForFilename(new Date())}.json`;

  await chrome.downloads.download({ url, filename, saveAs: true });
  URL.revokeObjectURL(url);
}

// ── Action Management ──────────────────────────────────────────────────────

function appendAction(action, sender) {
  if (!recordingSession) return;

  // Attach network events captured since last action
  const networkEvents = networkMonitor ? networkMonitor.drainSince(action.timestamp) : [];
  action.network_events = networkEvents;

  // Assign sequence number
  action.seq = recordingSession.actions.length + 1;

  recordingSession.actions.push(action);
}

function appendCheckpoint(label, sender) {
  if (!recordingSession) return;
  recordingSession.actions.push({
    seq: recordingSession.actions.length + 1,
    timestamp: new Date().toISOString(),
    action_type: 'checkpoint',
    annotation: label,
    target: null,
    input_value: null,
    state_before: null,
    state_after: null,
    network_events: []
  });
}

// ── Build Final Trace Object ───────────────────────────────────────────────

function buildTrace() {
  return {
    trace_id: recordingSession.id,
    recorded_at: recordingSession.started_at,
    stopped_at: recordingSession.stopped_at,
    target_app: recordingSession.target_app,
    wcrs_version: '1.0.0',
    actions: recordingSession.actions,
    action_count: recordingSession.actions.length,
    errors: recordingSession.errors
  };
}

// ── Popup / New-Tab Detection ─────────────────────────────────────────────

chrome.windows.onCreated.addListener((window) => {
  if (recordingSession && window.type === 'popup') {
    const action = {
      seq: null, // assigned in appendAction
      timestamp: new Date().toISOString(),
      action_type: 'popup_open',
      target: null,
      popup_window_id: window.id,
      state_before: captureMinimalState(),
      state_after: { url: 'pending', title: 'pending' },
      network_events: []
    };
    recordingSession._pendingPopupWindowId = window.id;
    appendAction(action, {});
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!recordingSession) return;
  if (changeInfo.status !== 'complete') return;

  // Resolve pending popup URL
  if (recordingSession._pendingPopupWindowId) {
    const lastPopup = recordingSession.actions.findLast(a => a.action_type === 'popup_open' && a.state_after?.url === 'pending');
    if (lastPopup) {
      lastPopup.state_after = { url: tab.url, title: tab.title };
    }
    recordingSession._pendingPopupWindowId = null;
  }
});

// ── Frame Navigation Tracking ─────────────────────────────────────────────

chrome.webNavigation.onCommitted.addListener((details) => {
  frameRegistry.register(details);
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (recordingSession && details.frameId === 0) {
    // Top-level navigation — record navigate action if not already captured
    const lastAction = recordingSession.actions[recordingSession.actions.length - 1];
    if (lastAction?.action_type !== 'navigate' || lastAction?.state_after?.url !== details.url) {
      appendAction({
        timestamp: new Date().toISOString(),
        action_type: 'navigate',
        target: { selectors: [], frame_path: ['main'] },
        state_before: { url: 'prior', title: '' },
        state_after: { url: details.url, title: '' }
      }, {});
    }
  }
});

// ── Chrome DevTools Protocol — Debugger ───────────────────────────────────

async function attachDebugger(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
  } catch (err) {
    console.warn('[WCRS] Debugger attach failed:', err.message);
  }
}

async function detachDebugger(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
  } catch (_) { /* may already be detached */ }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!recordingSession) return;
  const tabId = source.tabId;
  if (tabId !== recordingSession.tab_id) return;

  if (method === 'Page.printRequested' || method === 'Page.javascriptDialogOpening') {
    appendAction({
      timestamp: new Date().toISOString(),
      action_type: method === 'Page.printRequested' ? 'print' : 'dialog',
      target: { selectors: [], frame_path: ['main'] },
      state_before: { url: '', title: '' },
      state_after: { url: '', title: '' },
      dialog_message: params?.message || null
    }, {});
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (recordingSession && source.tabId === recordingSession.tab_id) {
    console.warn('[WCRS] Debugger detached:', reason);
    recordingSession.errors.push({ type: 'debugger_detach', reason, timestamp: new Date().toISOString() });
  }
});

// ── Utilities ──────────────────────────────────────────────────────────────

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function formatDateForFilename(date) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function captureMinimalState() {
  return { url: '', title: '', timestamp: new Date().toISOString() };
}
