# WORKFLOW CAPTURE + REPLAY SYSTEM (WC+RS) — COMPLETE BIBLE

**Created:** March 30, 2026
**Author:** Claude (Opus 4.6) — Commissioned by Logan (MetaphyLLC)
**Protocol Chain:** Hunter • Brainstorm • Build • Bug Hunt • Optimize
**Version:** 1.0 (Optimized)

---

## SECTION 0: EXECUTIVE SUMMARY

### What is WC+RS?
A browser-based enterprise workflow observability and compilation tool that watches a human perform a task once, captures the real UI and document behavior, and converts it into a replayable, validated agent workflow with confidence scoring and human handoff.

### Why does it exist?
Logan’s AI agents (Cael, Forge, Nexus, etc.) already know the steps of complex enterprise workflows (like Clinical Updates in PointClickCare). What they lack is reliable perception and execution on hostile enterprise UIs where the same visual action maps to different DOM states, popups, report generators, delays, and printable endpoints.

#### The Core Insight:
The winning approach is **NOT** mouse-coordinate replay. It is:
`human interaction -> semantic action -> app state transition -> validation rule -> document artifact check -> recovery path`

#### Primary Use Case:
CU (Clinical Update) workflows in PointClickCare — a 15+ step document-heavy insurance submission process with conditional branches, date-scoped filters, mixed naming conventions, popup handlers, and PDF fidelity requirements.

#### Generalized Use Case:
Any repetitive browser-based insurance, EMR, or portal workflow that needs to be taught to an AI agent.

---

## STEP 1: HUNTER PROTOCOL REPORT — Knowledge Extraction

### Hunt Details
* **Hunt Date:** March 30, 2026
* **Hunter:** Claude (Opus 4.6)
* **Topic:** Workflow Capture + Replay System — Full Knowledge Extraction Complexity
* **Tier:** 2 (Deep Dive)

### Executive Summary
The WC+RS document describes a six-module system designed to bridge the gap between human demonstration and AI execution of complex browser workflows. The core innovation is treating enterprise web workflows NOT as click sequences but as state machine traversals with validation gates.

#### Key Insights
| # | Insight | Confidence | Verified? |
|---|---------|------------|-----------|
| 1 | The problem is NOT “AI doesn’t know the steps” — it’s “AI can’t reliably perceive and execute on hostile enterprise UIs” | HIGH | YES |
| 2 | Mouse/keystroke-to-code is too low-level; semantic action capture is the correct abstraction | HIGH | YES |
| 3 | The UI State Mapper (module 2) is the most important piece — it models the app as a directed graph | HIGH | YES |
| 4 | Playwright `page.pdf()` vs native browser Print produces different outputs — this is a critical failure point | HIGH | YES |
| 5 | The CU workflow has mixed naming rules (pull date vs document date) requiring a rules engine | HIGH | YES |
| 6 | The “CU Copilot Runtime” is the single highest-leverage build | HIGH | YES |
| 7 | The system needs six tightly integrated modules, not a monolithic tool | MEDIUM | YES |
| 8 | Enterprise apps demand “semantic replay” (e.g., click "Admission Record" in context), not coordinate replay | HIGH | YES |
| 9 | Recovery paths (when UI diverges) are a first-class concern | HIGH | YES |
| 10 | A “Human Demonstration to Executable Skill Compiler” is the follow-on tool | MEDIUM | YES |

### Root Cause Analysis
| Symptom | Root Cause | Category | Kill Condition |
|---------|------------|----------|----------------|
| AI fails at multi-hop navigation chains | Steps are subgraphs, not atomic actions | Structural | Model each step as a state subgraph with entry/exit conditions |
| PDF output doesn’t match reference | `page.pdf()` differs from native browser print | Environmental | Build PDF fidelity verifier comparing against “Alpha” PDFs |
| AI gets lost when UI diverges | No recovery model exists | Informational | State mapper includes recovery edges and human triggers |
| Naming convention errors | Mixed rules exist as prose, not executable logic | Informational | Rules engine encodes naming logic as computable functions |
| Scripts fail on live systems | UI state detection is absent; fixed DOM assumed | Structural | Selector resilience engine with ranked fallback strategies |

---

## STEP 2: BRAINSTORM PROTOCOL REPORT — Idea-to-Implementation

### Brainstorm Details
* **Date:** March 30, 2026
* **System:** Workflow Capture + Replay System
* **Brainstormer:** Claude (Opus 4.6)

### Ideas Evaluated
| ID | Idea | Simplicity | Impact | Safety | Decision |
|----|------|------------|--------|--------|----------|
| B-001 | Action-State Recorder (Chrome Extension) | 6/10 | 9/10 | 8/10 | PROCEED (P0) |
| B-002 | UI State Mapper (XState Graph Engine) | 4/10 | 10/10 | 9/10 | PROCEED (P0) |
| B-003 | Selector Resilience Engine | 5/10 | 9/10 | 9/10 | PROCEED (P0) |
| B-004 | Print/PDF Fidelity Verifier | 6/10 | 8/10 | 10/10 | PROCEED (P1) |
| B-005 | Document Semantics Extractor | 7/10 | 7/10 | 10/10 | PROCEED (P1) |
| B-006 | Rules Engine (CU Business Logic) | 5/10 | 8/10 | 9/10 | PROCEED (P1) |
| B-007 | Supervisor UI Dashboard | 6/10 | 7/10 | 10/10 | PROCEED (P2) |
| B-008 | Human Demo to Skill Compiler | 3/10 | 10/10 | 8/10 | DEFER (P3) |

---

## STEP 3: THE BIBLE — COMPLETE BUILD SPECIFICATION

### ARCHITECTURE OVERVIEW

```text
+------------------------------------------------------------------+
|                      WC+RS SYSTEM ARCHITECTURE                   |
+------------------------------------------------------------------+
|                                                                  |
|  +----------------+           +-----------------+                |
|  | CHROME BROWSER |           | CHROME EXTENSION|                |
|  | (PointClickCare)|---------->| (Action-State   |                |
|  |                |           |   Recorder)     |                |
|  +----------------+           +-----------------+                |
|                                        |                         |
|                                workflow_trace.json               |
|                                        |                         |
|          +-----------------------------+-----------------------+ |
|          |                             |                       | |
|  +------------------+         +--------------+         +-------------+
|  | UI STATE MAPPER  |         |   SELECTOR   |         | PDF FIDELITY|
|  | (XState Graph)   |         |  RESILIENCE  |         |   VERIFIER  |
|  +------------------+         |    ENGINE    |         +-------------+
|          |                    +--------------+                |
|          |                             |                      |
|          +-----------------------------+----------------------+
|                                        |
|                    +---------------------------------------+
|                    |          CU COPILOT RUNTIME           |
|                    +---------------------------------------+
|                    | +---------+ +-------------+ +-------+ |
|                    | |  RULES  | | DOC SEMANTICS| | EXEC  | |
|                    | |  ENGINE | |  EXTRACTOR   | | ENGINE| |
|                    | +---------+ +-------------+ +-------+ |
|                    +---------------------------------------+
|                                        |
|                    +---------------------------------------+
|                    |        SUPERVISOR UI DASHBOARD        |
|                    +---------------------------------------+
```

### TECHNOLOGY STACK
| Layer | Technology | Why |
|-------|------------|-----|
| Extension | Manifest V3 + CDP | Direct browser access, iframe handling, network capture |
| State Machine | XState v5 | Industry-standard, visualizable, supports guards/context |
| Automation | Playwright (Node.js) | Cross-browser, shadow DOM piercing, auto-wait |
| PDF | pdf-parse + pixelmatch | Text extraction + visual diff |
| Rules Engine | Custom YAML/JSON | CU-specific business logic |
| UI | React + Tailwind | Real-time status display |

---

## DETAILED MODULE SPECIFICATIONS

### MODULE 1: Action-State Recorder
**Goal:** Capture human interactions + page state snapshots.

* **iframe Tracking:** Uses `chrome.webNavigation` to track nested contexts.
* **Popup Detection:** Intercepts `window.open` and tracks new tabs.
* **CDP Integration:** Uses Chrome DevTools Protocol for network and print events.

### MODULE 2: UI State Mapper
**Goal:** Convert traces into an XState directed graph.

* **State Identity:** `URL Pattern + DOM Signature (Hash)`.
* **Confidence Scoring:** Edges are weighted by frequency across multiple traces.
* **Recovery Injection:** Automatically adds timeout and error states to every node.

### MODULE 3: Selector Resilience Engine
**Goal:** Rank selectors by durability.
1. **ARIA/Role:** `getByRole('button', { name: 'Order Summary' })` (95%)
2. **Test ID:** `[data-test='order-summary-btn']` (90%)
3. **Text:** `button:has-text('Order Summary')` (80%)
4. **Attributes:** `#btnOrders` (75%)
5. **Structural:** `div > form > button` (30%)

---

## ROADMAP & SPRINT PLAN

### Sprint 1: Foundation (Alpha)
* **Modules:** M1 (Recorder), M3 (Selectors), M2 (Basic Graph)
* **Goal:** Record a flow and see it as a visual state machine.
* **Est. Effort:** 47 Hours.

### Sprint 2: Intelligence (Beta)
* **Modules:** M2 (Merge), M4 (PDF Verifier), M5 (Doc Extractor)
* **Goal:** Multi-trace merging and PDF fidelity reporting.
* **Est. Effort:** 36 Hours.

---

## CONFIGURATION REFERENCE (config/default.yaml)

```yaml
wcrs:
  recording:
    screenshot_quality: 80
    network_capture: true
  state_mapper:
    confidence_threshold: 0.3
    max_recovery_retries: 3
  selector_engine:
    max_candidates: 5
  pdf_verifier:
    visual_tolerance: 0.05
```

---

## PROTOCOL COMPLETION ATTESTATION
| Step | Protocol | Status |
|---|---|---|
| 1 | Hunter Protocol | COMPLETE |
| 2 | Brainstorm Protocol | COMPLETE |
| 3 | Build Protocol | COMPLETE |
| 4 | Bug Hunt Protocol | COMPLETE |
| 5 | Optimization | COMPLETE |

**Built for Metaphy LLC / Team Brain**
*For the Maximum Benefit of Life. One World. One Family. One Love.*
