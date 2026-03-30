/**
 * WCRS Network Monitor
 * Intercepts XHR/fetch network events via Chrome DevTools Protocol (Network domain).
 * Fingerprints report-generation endpoints (ordersummary.xhtml, MAR/TAR, etc.)
 * for downstream state-graph edge annotation.
 *
 * Challenge from the Bible:
 *   "Report generation endpoints (ordersummary.xhtml, getadminrecordreport.xhtml)
 *    must be fingerprinted."
 */

export class NetworkMonitor {
  /**
   * @param {number} tabId
   */
  constructor(tabId) {
    this._tabId = tabId;
    this._events = [];
    this._listener = null;
    this._requestMap = new Map(); // requestId -> request details
  }

  /**
   * Start capturing network events.
   * Assumes debugger is already attached and Network.enable has been called.
   */
  start() {
    this._listener = (source, method, params) => {
      if (source.tabId !== this._tabId) return;
      this._handleDebuggerEvent(method, params);
    };
    chrome.debugger.onEvent.addListener(this._listener);
  }

  /**
   * Stop capturing and remove listener.
   */
  stop() {
    if (this._listener) {
      chrome.debugger.onEvent.removeListener(this._listener);
      this._listener = null;
    }
  }

  /**
   * Return all network events captured since a given timestamp,
   * and remove them from the internal buffer (drain).
   *
   * @param {string} sinceTimestamp ISO-8601 string
   * @returns {NetworkEvent[]}
   */
  drainSince(sinceTimestamp) {
    const since = sinceTimestamp ? new Date(sinceTimestamp).getTime() : 0;
    const result = this._events.filter(e => new Date(e.timestamp).getTime() >= since);
    this._events = this._events.filter(e => new Date(e.timestamp).getTime() < since);
    return result;
  }

  /**
   * Return all captured events without draining.
   * @returns {NetworkEvent[]}
   */
  getAll() {
    return [...this._events];
  }

  /**
   * Clear all captured events.
   */
  clear() {
    this._events = [];
    this._requestMap.clear();
  }

  // ── CDP Event Handler ────────────────────────────────────────────────────

  _handleDebuggerEvent(method, params) {
    switch (method) {
      case 'Network.requestWillBeSent':
        this._requestMap.set(params.requestId, {
          url: params.request.url,
          method: params.request.method,
          timestamp: new Date().toISOString(),
          isReportEndpoint: this._isReportEndpoint(params.request.url)
        });
        break;

      case 'Network.responseReceived': {
        const req = this._requestMap.get(params.requestId);
        if (!req) break;

        const event = {
          request_id: params.requestId,
          url: params.response.url || req.url,
          method: req.method,
          status: params.response.status,
          content_type: params.response.headers?.['content-type'] || params.response.headers?.['Content-Type'] || '',
          timestamp: new Date().toISOString(),
          is_report_endpoint: req.isReportEndpoint,
          endpoint_type: this._classifyEndpoint(req.url)
        };

        this._events.push(event);
        this._requestMap.delete(params.requestId);
        break;
      }

      case 'Network.loadingFailed': {
        const req = this._requestMap.get(params.requestId);
        if (req) {
          this._events.push({
            request_id: params.requestId,
            url: req.url,
            method: req.method,
            status: 0,
            content_type: '',
            timestamp: new Date().toISOString(),
            error: params.errorText,
            is_report_endpoint: req.isReportEndpoint,
            endpoint_type: this._classifyEndpoint(req.url)
          });
          this._requestMap.delete(params.requestId);
        }
        break;
      }
    }
  }

  // ── Endpoint Classification ──────────────────────────────────────────────

  /** Known PointClickCare report-generation endpoint patterns */
  static REPORT_PATTERNS = [
    { pattern: /ordersummary/i,           type: 'OS_report' },
    { pattern: /getadminrecordreport/i,   type: 'MAR_TAR_report' },
    { pattern: /vitalreport/i,            type: 'VS_report' },
    { pattern: /labresult/i,              type: 'Lab_report' },
    { pattern: /radiologyreport/i,        type: 'Rad_report' },
    { pattern: /medicationprofile/i,      type: 'FC_report' },
    { pattern: /formulary/i,              type: 'FS_report' },
    { pattern: /woundreport/i,            type: 'WO_report' },
    { pattern: /therapynotes/i,           type: 'Therapy_report' },
    { pattern: /progressnotes/i,          type: 'PPN_report' },
    { pattern: /continuityCare/i,         type: 'COC_report' },
    { pattern: /admissionrecord/i,        type: 'Admin_record' },
    { pattern: /printreport/i,            type: 'print_report' },
    { pattern: /generatepdf/i,            type: 'pdf_generation' },
    { pattern: /downloadreport/i,         type: 'download_report' }
  ];

  _isReportEndpoint(url) {
    return NetworkMonitor.REPORT_PATTERNS.some(p => p.pattern.test(url));
  }

  _classifyEndpoint(url) {
    const match = NetworkMonitor.REPORT_PATTERNS.find(p => p.pattern.test(url));
    return match ? match.type : 'general';
  }
}

/**
 * @typedef {Object} NetworkEvent
 * @property {string} request_id
 * @property {string} url
 * @property {string} method
 * @property {number} status
 * @property {string} content_type
 * @property {string} timestamp
 * @property {boolean} is_report_endpoint
 * @property {string} endpoint_type
 * @property {string} [error]
 */
