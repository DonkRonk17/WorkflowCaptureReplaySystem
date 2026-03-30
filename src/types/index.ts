/**
 * WCRS Shared Type Definitions
 * Used across all TypeScript modules.
 */

// ── Action Event (core trace unit) ────────────────────────────────────────

export interface ActionEvent {
  seq: number;
  timestamp: string;           // ISO-8601
  action_type: ActionType;
  target: ActionTarget | null;
  input_value: string | null;
  state_before: PageState | null;
  state_after: PageState | null;
  network_events: NetworkEvent[];
  annotation?: string;         // Human checkpoint label
  duration_ms?: number;
}

export type ActionType =
  | 'click'
  | 'type'
  | 'select'
  | 'navigate'
  | 'submit'
  | 'keydown'
  | 'popup_open'
  | 'popup_close'
  | 'print'
  | 'download'
  | 'wait'
  | 'dialog'
  | 'checkpoint';

export interface DomActionTarget {
  selectors: SelectorCandidate[];
  visible_text: string;
  tag: string;
  frame_path: string[];
  bounding_rect: BoundingRect | null;
}

/**
 * Target metadata for non-DOM actions (e.g., browser windows, dialogs).
 * All fields are optional to accommodate minimal payloads like `{ window_id: ... }`.
 */
export interface NonDomActionTarget {
  /** Identifier of a browser window (e.g., for popup_open / popup_close). */
  window_id?: number;
  /** Message shown in a browser dialog (alert/confirm/prompt). */
  dialog_message?: string;
  /** Selector array (may be empty) for non-DOM actions that include a partial target. */
  selectors?: SelectorCandidate[];
  /** Frame path for actions that originate in a frame context. */
  frame_path?: string[];
}

/**
 * Union of all supported action target shapes.
 * DOM-backed interactions use {@link DomActionTarget}.
 * Browser UI / dialog interactions use {@link NonDomActionTarget}.
 */
export type ActionTarget = DomActionTarget | NonDomActionTarget;

export interface PageState {
  url: string;
  title: string;
  dom_snapshot_hash?: string;
  screenshot_ref?: string | null;
  timestamp?: string;
}

export interface NetworkEvent {
  request_id: string;
  url: string;
  method: string;
  status: number;
  content_type: string;
  timestamp: string;
  is_report_endpoint: boolean;
  endpoint_type: string;
  error?: string;
}

export interface BoundingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Selector Candidate ────────────────────────────────────────────────────

export type SelectorStrategy = 'role' | 'testId' | 'text' | 'attribute' | 'css';

export interface SelectorCandidate {
  strategy: SelectorStrategy;
  selector: string;
  resilience: number;      // 0.0 – 1.0
  playwright_locator?: string;
}

// ── Workflow Trace ─────────────────────────────────────────────────────────

export interface WorkflowTrace {
  trace_id: string;
  wcrs_version: string;
  recorded_at: string;
  stopped_at: string | null;
  target_app: string;
  action_count: number;
  source_traces?: string[];  // if merged
  errors: TraceError[];
  actions: ActionEvent[];
}

export interface TraceError {
  type: string;
  detail?: string;
  timestamp: string;
}

// ── State Machine ─────────────────────────────────────────────────────────

export interface TraceState {
  id: string;
  url_pattern: string;
  dom_signature: string;
  title: string;
  recordings_seen: number;
}

export interface TraceTransition {
  id: string;
  from: string;
  to: string;
  event: string;
  action_type: ActionType;
  selectors: SelectorCandidate[];
  guard_conditions: GuardCondition[];
  confidence: number;
  recordings_seen: number;
}

export interface GuardCondition {
  type: 'url_match' | 'element_present' | 'element_absent' | 'context_match';
  pattern?: string;
  selectors?: string[];
  context_key?: string;
  context_value?: unknown;
}

export interface StateMachineDefinition {
  id: string;
  initial: string;
  context: Record<string, unknown>;
  states: Record<string, XStateNode>;
}

export interface XStateNode {
  on?: Record<string, XStateTransition | XStateTransition[]>;
  after?: Record<number, { target: string; actions?: string[] }>;
  type?: 'final' | 'parallel' | 'history';
  meta?: {
    url_pattern?: string;
    selectors?: string[];
    confidence?: number;
    recordings_seen?: number;
    recovery?: boolean;
    message?: string;
    title?: string;
    notify?: boolean;
  };
}

export interface XStateTransition {
  target: string;
  guard?: string;
  actions?: string[];
}

// ── Rules Engine ──────────────────────────────────────────────────────────

export type RuleType = 'sequencing' | 'date_filter' | 'naming' | 'ordering' | 'conditional' | 'submission';

export interface Rule {
  id: string;
  type: RuleType;
  description: string;
  condition?: string;
  must_precede?: string[];
  doc_type?: string;
  doc_types?: string[];
  filter?: string;
  filename_date?: 'pull_date' | 'document_date';
  order?: string[];
  action?: string;
  recipients?: string[];
}

export interface DocumentMetadata {
  filename: string;
  doc_type: string;
  document_date: string;      // ISO date string
  patient_id: string;
  page_count?: number;
  source_url?: string;
}

export interface WorkflowContext {
  patient_id: string;
  pull_date: string;           // Date the workflow was executed
  last_cu_date: string;        // Date of previous Clinical Update
  collected_docs: DocumentMetadata[];
  radiology_results_exist?: boolean;
  therapy_discipline_active?: boolean;
}

export interface RuleEvaluationResult {
  rule_id: string;
  passed: boolean;
  message: string;
}

// ── Validation ────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
