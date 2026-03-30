/**
 * WCRS Screenshot Capture
 * Captures page screenshots via Chrome DevTools Protocol Page.captureScreenshot.
 * Stores screenshots as base64 data URIs in the session, with refs attached to
 * the state_before / state_after fields of each ActionEvent.
 *
 * Chrome DevTools Protocol reference:
 *   https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot
 */

export class ScreenshotCapture {
  /**
   * @param {number} tabId - Tab to capture
   * @param {Object} options
   * @param {number} [options.quality=80] - JPEG quality (1–100)
   * @param {'jpeg'|'png'|'webp'} [options.format='jpeg']
   */
  constructor(tabId, options = {}) {
    this._tabId = tabId;
    this._quality = options.quality ?? 80;
    this._format = options.format ?? 'jpeg';
    this._screenshots = new Map(); // ref -> base64 data
    this._counter = 0;
  }

  /**
   * Capture a screenshot and return a reference key.
   * The reference is a string like "screenshots/step_007_before.jpeg"
   *
   * @param {string} label - Descriptive label (e.g. "step_007_before")
   * @returns {Promise<string>} Reference key
   */
  async capture(label) {
    const ref = `screenshots/${label}.${this._format}`;

    try {
      const result = await chrome.debugger.sendCommand(
        { tabId: this._tabId },
        'Page.captureScreenshot',
        {
          format: this._format,
          quality: this._format === 'png' ? undefined : this._quality,
          captureBeyondViewport: false
        }
      );

      if (result?.data) {
        this._screenshots.set(ref, `data:image/${this._format};base64,${result.data}`);
      }
    } catch (err) {
      console.warn('[WCRS] Screenshot capture failed:', err.message);
      // Return ref even if capture failed — state can have null screenshot_data
    }

    this._counter++;
    return ref;
  }

  /**
   * Generate a ref label for a given sequence and position.
   * @param {number} seq - Action sequence number
   * @param {'before'|'after'} position
   * @returns {string}
   */
  makeLabel(seq, position) {
    return `step_${String(seq).padStart(3, '0')}_${position}`;
  }

  /**
   * Get the base64 data for a ref.
   * @param {string} ref
   * @returns {string|null}
   */
  getData(ref) {
    return this._screenshots.get(ref) || null;
  }

  /**
   * Export all screenshots as { ref: base64Data } object.
   * @returns {Object}
   */
  exportAll() {
    const out = {};
    for (const [ref, data] of this._screenshots) {
      out[ref] = data;
    }
    return out;
  }

  /**
   * Count of screenshots captured.
   * @returns {number}
   */
  get count() {
    return this._screenshots.size;
  }

  /**
   * Clear all stored screenshots (to free memory after export).
   */
  clear() {
    this._screenshots.clear();
  }
}

/**
 * Lightweight screenshot capture using chrome.tabs.captureVisibleTab.
 * Falls back to this when debugger is not attached.
 *
 * @param {number} tabId
 * @param {number} windowId
 * @param {Object} options
 * @returns {Promise<string>} base64 data URI
 */
export async function captureVisibleTab(tabId, windowId, options = {}) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: options.format || 'jpeg',
      quality: options.quality || 80
    });
    return dataUrl;
  } catch (err) {
    console.warn('[WCRS] captureVisibleTab failed:', err.message);
    return null;
  }
}
