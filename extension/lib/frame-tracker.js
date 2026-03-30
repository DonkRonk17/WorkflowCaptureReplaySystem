/**
 * WCRS Frame Tracker
 * Maintains a registry of iframe/frame contexts for the active tab.
 * PointClickCare uses deeply nested iframes (3+ levels) so we must
 * track all frame IDs and build human-readable path arrays.
 *
 * Challenge from the Bible:
 *   "PCC uses deeply nested iframes. Your frame tracker MUST handle 3+ levels."
 */

export class FrameRegistry {
  constructor() {
    /** @type {Map<number, FrameEntry>} */
    this._frames = new Map();
  }

  /**
   * Register or update a frame from a webNavigation event detail.
   * @param {chrome.webNavigation.WebNavigationFramedCallbackDetails} details
   */
  register(details) {
    const entry = {
      frameId: details.frameId,
      url: details.url,
      parentFrameId: details.parentFrameId,
      tabId: details.tabId,
      registeredAt: Date.now()
    };
    this._frames.set(details.frameId, entry);
  }

  /**
   * Build a human-readable path array for a given frameId.
   * e.g. ["main", "iframe#content", "iframe#reportFrame"]
   *
   * @param {number} frameId
   * @returns {string[]}
   */
  getPath(frameId) {
    if (frameId === 0) return ['main'];

    const path = [];
    let current = this._frames.get(frameId);
    while (current && current.frameId !== 0) {
      const label = this._labelFrame(current);
      path.unshift(label);
      if (current.parentFrameId === 0 || current.parentFrameId === -1) break;
      current = this._frames.get(current.parentFrameId);
    }
    path.unshift('main');
    return path;
  }

  /**
   * Get frame entry by ID.
   * @param {number} frameId
   * @returns {FrameEntry|undefined}
   */
  get(frameId) {
    return this._frames.get(frameId);
  }

  /**
   * Remove all frames associated with a tab (cleanup on tab close/navigation).
   * @param {number} tabId
   */
  clearTab(tabId) {
    for (const [id, entry] of this._frames) {
      if (entry.tabId === tabId) this._frames.delete(id);
    }
  }

  /**
   * Produce a debug-friendly snapshot of all known frames.
   * @returns {FrameEntry[]}
   */
  snapshot() {
    return Array.from(this._frames.values()).sort((a, b) => a.frameId - b.frameId);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  _labelFrame(entry) {
    if (!entry.url) return `iframe[id:${entry.frameId}]`;
    try {
      const u = new URL(entry.url);
      // Use path segments to build meaningful label
      const parts = u.pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1] || u.hostname;
      return `iframe[${last}]`;
    } catch (_) {
      return `iframe[id:${entry.frameId}]`;
    }
  }
}

/**
 * @typedef {Object} FrameEntry
 * @property {number} frameId
 * @property {string} url
 * @property {number} parentFrameId
 * @property {number} tabId
 * @property {number} registeredAt
 */
