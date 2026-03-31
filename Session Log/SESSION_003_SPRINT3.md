# SESSION 003 — SPRINT 3: CU Copilot Runtime

**Date:** 2026-03-31
**Branch:** `claude/workflow-capture-replay-system-x6kBu`
**Sprint Goal:** CU Copilot Runtime — execution engine that drives Playwright through
recorded workflows, verifies state at each step, handles recovery, and reports execution status.

---

## Baseline Confirmed

- **171 tests passing** before any Sprint 3 code was written.
- Branch: `claude/workflow-capture-replay-system-x6kBu` (from Session 002).

---

## Files Created

### Runtime Modules (`src/runtime/`)

| File | Purpose |
|------|---------|
| `src/runtime/state-verifier.ts` | Verifies live browser state against expected recorded state |
| `src/runtime/recovery-handler.ts` | Decision matrix for RETRY/SKIP/ESCALATE + event logging |
| `src/runtime/reporter.ts` | Builds, mutates, finalizes, and writes ExecutionReport |
| `src/runtime/executor.ts` | Main WorkflowExecutor class — drives Playwright through transitions |

### Tests (`tests/unit/` and `tests/integration/`)

| File | Tests |
|------|-------|
| `tests/unit/state-verifier.test.ts` | 22 tests |
| `tests/unit/recovery-handler.test.ts` | 23 tests |
| `tests/unit/runtime-reporter.test.ts` | 20 tests |
| `tests/unit/executor.test.ts` | 24 tests |
| `tests/integration/sprint3-runtime.test.ts` | 12 tests |

### CLI Update

- `src/cli.ts` — Added `wcrs run <trace-file>` command with `--output`, `--dry-run`,
  `--max-retries`, `--timeout` options.

---

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| Sprint 1+2 (existing) | 171 | ✅ All passing |
| state-verifier.test.ts | 22 | ✅ All passing |
| recovery-handler.test.ts | 23 | ✅ All passing |
| runtime-reporter.test.ts | 20 | ✅ All passing |
| executor.test.ts | 24 | ✅ All passing |
| sprint3-runtime.test.ts | 12 | ✅ All passing |
| **TOTAL** | **272** | **✅ All passing** |

---

## Verification Gates

| Gate | Result |
|------|--------|
| StateVerificationResult returned for all Playwright mock scenarios | ✅ |
| Recovery decisions match decision matrix for all 8 failure types | ✅ |
| ExecutionReport has all required fields and correct step counters | ✅ |
| WorkflowExecutor.run() completes in dryRun mode over sample-trace | ✅ |
| Escalation scenario correctly sets status=escalated | ✅ |
| writeReport produces valid JSON and Markdown | ✅ |
| CLI wcrs run command parses arguments and invokes executor | ✅ |
| npm test — ALL 272 tests pass | ✅ |

---

## Architecture Decisions

### 1. No Playwright module-level import
Per spec: `Page` is accepted as a constructor parameter / function argument.
Both `state-verifier.ts` and `executor.ts` define minimal `VerifierPage`/`ExecutorPage`
interfaces that Playwright's real `Page` satisfies, and that plain `jest.fn()` objects
satisfy in tests. Zero browser launches required for any unit test.

### 2. `jest.mock('fs')` over `jest.spyOn`
`fs` built-in properties are non-configurable in Node.js; `jest.spyOn` throws
`Cannot redefine property`. Used `jest.mock('fs', factory)` with `jest.requireActual`
spread to preserve real `readFileSync` while mocking write/append/exists/mkdir.

### 3. `jest.setTimeout(30000)` for integration tests
State verification runs after each action. In a non-dryRun recovery scenario with URL
mismatches, `state_mismatch` triggers 2000ms RETRY delays. The integration test timeout
was raised to 30s and recovery tests use synthetic graphs with matching page URLs to
avoid real delays.

### 4. Topological order = trace order
`graph.transitions` is already in trace order (graph-builder emits them in the order
they were first seen across traces). Executor iterates `transitions` in index order;
no additional sorting needed.

### 5. `input_value` resolution
`StateMachineDefinition` doesn't carry `input_value`. `ExecutorContext.actions`
(optional `ActionEvent[]` from the original trace) allows the executor to look up
input values by `action_type`. For navigation, `input_value` or selector fallback
provides the URL.

### 6. MAR/TAR timeout (BH-007)
`getStepTimeout()` returns `marTarTimeoutMs` (90s default) when
`/mar|tar|medication_administration/i` matches `transition.id`. Covered by 3 unit tests.

### 7. PDF printing fallback
`executor.ts` `print` action tries `page.pdf()` first (headless), then falls back to
`page.evaluate(() => globalThis.window?.print?.())` (headed). The cast avoids
TypeScript's "lib: ES2020" having no `window` global.

---

## Bugs Encountered and Fixed

| # | Bug | Fix |
|---|-----|-----|
| 1 | `window` not in TypeScript `lib: ES2020` (no DOM) | Cast: `(globalThis as unknown as { window?: { print(): void } }).window?.print?.()` |
| 2 | `jest.spyOn(fs, 'existsSync')` throws `Cannot redefine property` | Changed all fs-dependent tests to `jest.mock('fs', factory)` |
| 3 | Integration TEST 2 timeout (5000ms exceeded) | URL mismatch → state_mismatch → 2000ms RETRY per step; fixed by using synthetic graphs with matching page URLs and raising `jest.setTimeout(30000)` |

---

## Module API Summary

### `state-verifier.ts`
```ts
verifyState(page, expectedState, expectedTransition, options?) → Promise<StateVerificationResult>
// confidence: url*0.5 + title*0.2 + dom*0.3; passed if confidence >= 0.5
```

### `recovery-handler.ts`
```ts
decideRecovery(failureType, retryCount, maxRetries) → RecoveryDecision
buildRecoveryEvent(params) → RecoveryEvent   // auto uuid + ISO timestamp
logRecoveryEvent(event, logDir) → void       // appends JSONL, sync
```

### `reporter.ts`
```ts
createReport(params) → ExecutionReport
addStepResult(report, step) → void           // updates counters + status
finalizeReport(report, finalStateId) → void  // sets completed_at + duration
writeReport(report, outputDir) → Promise<void>
formatMarkdown(report) → string
```

### `executor.ts`
```ts
class WorkflowExecutor {
  constructor(ctx: ExecutorContext)
  run() → Promise<ExecutionReport>
  executeAction(transition) → Promise<void>
  selectBestSelector(selectors) → string
  getStepTimeout(transition) → number
}
```

### CLI
```
wcrs run <trace-file> [--output <dir>] [--dry-run] [--max-retries <n>] [--timeout <ms>]
```

---

## What Sprint 4 Should Build

Per the Bible spec, Sprint 4 integrates the remaining modules:
- PDF Fidelity Verifier called from executor after print actions
- Rules Engine called after document collection steps
- Document Semantics Extractor integrated into packet validation
- Human handoff notification (ESCALATE → Slack/email alert)
