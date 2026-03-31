# SESSION 002 — SPRINT 2 LOG

**Date:** 2026-03-31
**Branch:** `claude/workflow-capture-replay-system-x6kBu`
**Goal:** Complete Sprint 2 — Multi-trace merge, confidence scoring, PDF verification, Document Semantics, Rules Engine

---

## Summary

Sprint 2 is complete. All 5 tasks delivered. Test count grew from 32 → 171 (139 new tests).

---

## Starting State

- Branch: `claude/workflow-capture-replay-system-x6kBu`
- Tests: 32 passing (all Sprint 1)
- node_modules: not installed (ran `npm install` first)
- `state-differ.ts`: NOT present (session instructions said "already written but uncommitted" — was absent; written fresh)

---

## Files Created

### Task 1 — State Differ

| File | Description |
|---|---|
| `src/state-mapper/state-differ.ts` | `diffTraces()` merges N traces → StateGraph with MergeStats, SkippedTrace, diverging path detection; `diffGraphs()` produces GraphDiff with confidence deltas |
| `tests/unit/state-differ.test.ts` | 13 tests |
| `src/types/index.ts` | Added `content_hash?: string` to DocumentMetadata |

### Task 2 — PDF Fidelity Verifier

| File | Description |
|---|---|
| `src/pdf-verifier/extractor.ts` | `extractPdfData()` via pdf-parse with page dimension capture for orientation detection |
| `src/pdf-verifier/rasterizer.ts` | `rasterizePdf()` via pdftoppm; `isPdftoppmAvailable()` with graceful fallback |
| `src/pdf-verifier/comparator.ts` | `comparePdfs()` full pipeline: text similarity (fast-diff), pixel diff (pixelmatch+pngjs), 2-up detection (BH-005); FidelityReport with PASS/WARN/FAIL |
| `src/pdf-verifier/reporter.ts` | `writeReport()` JSON+Markdown; `formatMarkdown()` with result badge |
| `tests/unit/pdf-verifier.test.ts` | 21 tests — all mocked, no real PDFs or pdftoppm required |

### Task 3 — Document Semantics Extractor

| File | Description |
|---|---|
| `src/doc-extractor/classifier.ts` | `classifyDocument()` for all 14 CU doc types; token-boundary-aware regex (fixes `MAR_` at start-of-name); SW placed before WO to prevent `wound` collision |
| `src/doc-extractor/validator.ts` | `validateDocumentNaming()` pull_date vs doc_date enforcement; `extractDateFromFilename()` handles 4 date formats |
| `src/doc-extractor/packet-builder.ts` | `buildPacket()` FC→FS→alpha order; dedup; missing_required detection |
| `src/doc-extractor/dedup.ts` | `detectDuplicates()` by hash and type+date; `deduplicateDocs()` keeps first occurrence |
| `tests/unit/doc-extractor.test.ts` | 59 tests |

### Task 4 — Rules Engine

| File | Description |
|---|---|
| `src/rules-engine/loader.ts` | `loadRules()` with AJV JSON Schema draft-07 validation (BH-009 fix); `RuleLoadError` class; `RULES_JSON_SCHEMA` embedded inline; `if/then/else` for type-specific required fields |
| `src/rules-engine/evaluator.ts` | `evaluateRule()` + `evaluateAllRules()` for all 6 rule types; BH-004 fix — `therapy_discipline_active` and `radiology_results_exist` evaluated as executable logic, not comments |
| `src/rules-engine/engine.ts` | `RulesEngine` class: `evaluate()`, `evaluatePacket()`, `getRuleById()`, `getRulesByType()`, `getRulesByDocType()`, `getSummary()` |
| `src/rules-engine/rules/cu-rules.yaml` | Copy of `config/cu-rules.yaml` for `__dirname`-relative test paths |
| `tests/unit/rules-engine.test.ts` | 29 tests |

### Task 5 — Sprint 2 Integration Test

| File | Description |
|---|---|
| `tests/integration/sprint2-pipeline.test.ts` | 17 tests across all 4 integration scenarios |

---

## Test Results

```
Test Suites: 9 passed, 9 total
Tests:       171 passed, 171 total (32 Sprint 1 + 139 Sprint 2)
Time:        ~4s
```

### By test file:

| File | Tests |
|---|---|
| `tests/unit/confidence-scorer.test.ts` | 7 |
| `tests/unit/graph-builder.test.ts` | 8 |
| `tests/unit/selector-generator.test.ts` | 5 |
| `tests/unit/state-differ.test.ts` | 13 |
| `tests/unit/pdf-verifier.test.ts` | 21 |
| `tests/unit/doc-extractor.test.ts` | 59 |
| `tests/unit/rules-engine.test.ts` | 29 |
| `tests/integration/graph-from-trace.test.ts` | 12 |
| `tests/integration/sprint2-pipeline.test.ts` | 17 |
| **TOTAL** | **171** |

---

## Sprint 2 Verification Gates

| Gate | Status |
|---|---|
| Three traces merged into single graph with confidence scores | ✅ PASS |
| Recovery states present for every workflow state | ✅ PASS |
| PDF comparison produces FidelityReport with PASS/WARN/FAIL result | ✅ PASS |
| Documents classified correctly for all 14 doc types | ✅ PASS |
| Naming convention validated (pull_date vs doc_date per type) | ✅ PASS |
| CU packet assembled in correct order (FC → FS → alpha) | ✅ PASS |
| Rules engine loads cu-rules.yaml with AJV schema validation | ✅ PASS |
| Rules engine evaluates naming, date_filter, conditional rules correctly | ✅ PASS |
| npm test — ALL tests pass (32 existing + 139 new) | ✅ 171/171 |

---

## Bug Fixes Addressed

| Bug | Fix |
|---|---|
| **BH-009 HIGH**: Rules engine YAML has no AJV schema validation | `loader.ts` validates on load; `RuleLoadError` thrown on failure |
| **BH-005 MEDIUM**: PDF 2-up layout not detected | `comparator.ts` detects landscape + half-expected-page-count; `is_two_up_layout: true` in FidelityReport |
| **BH-004 MEDIUM**: Conditional rules for OT/PT/ST were comments, not code | `evaluator.ts` evaluates `therapy_discipline_active == true` as executable logic |

---

## Architecture Decisions

1. **state-differ.ts uses buildGraph()** — Rather than re-implementing merge logic, `diffTraces()` wraps the existing `buildGraph()` from graph-builder, adding validation, skip tracking, and diverging-path detection on top.

2. **pdf-parse called twice per PDF** — First with a `pagerender` callback to capture page dimensions (orientation detection), then again with default renderer for text. This avoids modifying the text extraction by overriding the render function.

3. **pdftoppm fallback** — `visual_similarity: null` in FidelityReport when pdftoppm unavailable. Overall result uses text similarity only. All unit tests mock child_process so no pdftoppm required in CI.

4. **Classifier rule order matters (SW before WO)** — "skin wound" in filename would match WO's `/wound/i` pattern. SW is placed before WO and uses `/skin[\s_/-]wound/i` for combined pattern. Token-boundary regex `tokenRe()` handles abbreviations at filename start (e.g., `MAR_2026` where `\b` fails due to `_` being `\w`).

5. **AJV if/then/else for type-specific required fields** — JSON Schema draft-07 `if/then/else` validates that naming rules require `doc_types`+`filename_date`, date_filter rules require `doc_type`+`filter`, and conditional rules require `condition`.

6. **Promise.all interleaving** — `comparePdfs` uses `Promise.all([extractPdfData(gen), extractPdfData(ref)])` which interleaves pdf-parse mock calls in tests. Integration test for heavily-different-data directly exercises `calcTextSimilarity()` instead of trying to orchestrate complex mock sequences.

---

## Commits This Session

1. `856bb75` — Task 1: state-differ module + tests (13 tests)
2. `833e78d` — Task 2: PDF Fidelity Verifier (21 tests)
3. `66ca149` — Task 3: Document Semantics Extractor (59 tests)
4. `37fa1d9` — Task 4: Rules Engine (29 tests)
5. `0c04bdc` — Task 5: Sprint 2 integration test (17 tests)
6. (final) — Session log + final commit

---

## Next Sprint Preview (Sprint 3 — do NOT build now)

Sprint 3 will build the CU Copilot Runtime:
- `src/runtime/executor.ts` — Playwright state machine execution
- `src/runtime/state-verifier.ts` — DOM state assertion engine
- `src/runtime/recovery-handler.ts` — Off-script recovery logic
- `src/runtime/reporter.ts` — Execution log/status

All Sprint 2 modules feed into the runtime execution loop.
