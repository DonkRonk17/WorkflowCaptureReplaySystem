/**
 * WCRS Core Recorder Logic
 * Provides high-level API consumed by background.js for managing
 * the lifecycle of a recording session and serializing traces.
 *
 * This module is imported by background.js as an ES module.
 */

export class RecorderSession {
  constructor(config = {}) {
    this.id = generateUUID();
    this.started_at = new Date().toISOString();
    this.stopped_at = null;
    this.target_app = config.targetApp || 'unknown';
    this.tab_id = config.tabId || null;
    this.actions = [];
    this.screenshots = {};
    this.errors = [];
    this._pendingPopupWindowId = null;
  }

  /**
   * Append an ActionEvent to this session.
   * Enriches with sequence number and attaches pending network events.
   */
  appendAction(action, networkEvents = []) {
    const enriched = {
      seq: this.actions.length + 1,
      ...action,
      network_events: networkEvents
    };
    this.actions.push(enriched);
    return enriched;
  }

  /**
   * Insert a human-annotated checkpoint into the action stream.
   */
  appendCheckpoint(label) {
    return this.appendAction({
      timestamp: new Date().toISOString(),
      action_type: 'checkpoint',
      annotation: label,
      target: null,
      state_before: null,
      state_after: null
    });
  }

  /**
   * Mark session as complete and produce final trace object.
   */
  stop() {
    this.stopped_at = new Date().toISOString();
    return this.toTrace();
  }

  /**
   * Serialize to the canonical workflow_trace.json format.
   */
  toTrace() {
    return {
      trace_id: this.id,
      wcrs_version: '1.0.0',
      recorded_at: this.started_at,
      stopped_at: this.stopped_at,
      target_app: this.target_app,
      action_count: this.actions.length,
      errors: this.errors,
      actions: this.actions
    };
  }

  /**
   * Record an error encountered during recording (e.g., debugger detach).
   */
  recordError(type, detail) {
    this.errors.push({ type, detail, timestamp: new Date().toISOString() });
  }
}

/**
 * Validate a trace object against the WCRS data model schema.
 * Returns { valid: true } or { valid: false, errors: [...] }
 */
export function validateTrace(trace) {
  const errors = [];

  if (!trace.trace_id) errors.push('Missing trace_id');
  if (!trace.recorded_at) errors.push('Missing recorded_at');
  if (!Array.isArray(trace.actions)) errors.push('actions must be an array');

  if (Array.isArray(trace.actions)) {
    trace.actions.forEach((action, i) => {
      if (!action.seq) errors.push(`actions[${i}]: missing seq`);
      if (!action.timestamp) errors.push(`actions[${i}]: missing timestamp`);
      if (!action.action_type) errors.push(`actions[${i}]: missing action_type`);
      if (action.action_type !== 'checkpoint') {
        if (!action.target && action.action_type !== 'navigate') {
          // navigate actions may have null target in some edge cases
        }
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Merge two or more traces by deduplicated action streams.
 * Used when multiple recordings of the same workflow are available.
 */
export function mergeTraces(traces) {
  if (!traces || traces.length === 0) throw new Error('No traces to merge');
  if (traces.length === 1) return traces[0];

  // For now, merge = concatenate action lists with a separator checkpoint
  const mergedActions = [];
  for (let i = 0; i < traces.length; i++) {
    const t = traces[i];
    if (i > 0) {
      mergedActions.push({
        seq: mergedActions.length + 1,
        timestamp: t.recorded_at,
        action_type: 'checkpoint',
        annotation: `--- Trace ${i + 1}: ${t.trace_id} ---`,
        target: null,
        state_before: null,
        state_after: null,
        network_events: []
      });
    }
    const offset = mergedActions.length;
    t.actions.forEach((action, idx) => {
      mergedActions.push({ ...action, seq: offset + idx + 1 });
    });
  }

  return {
    trace_id: `merged_${Date.now()}`,
    wcrs_version: '1.0.0',
    recorded_at: traces[0].recorded_at,
    stopped_at: traces[traces.length - 1].stopped_at,
    target_app: traces[0].target_app,
    action_count: mergedActions.length,
    source_traces: traces.map(t => t.trace_id),
    actions: mergedActions
  };
}

// ── Utilities ──────────────────────────────────────────────────────────────

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
