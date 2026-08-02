# Human-friendly diagnosis presentation — Design

**Date:** 2026-07-19  
**Status:** Approved  
**Extends:** [failure-diagnosis design](2026-07-19-failure-diagnosis-design.md)

## Goal

Make FAIL diagnosis readable to non-technical users (PM/QA) without an LLM: a short root-cause story and next steps first; technical finding dumps second. Engineers and SaaS still get the full `findings[]` codes/evidence.

## Non-goals

- LLM / cloud / local model copy
- Changing pass/fail or `EventVerifier` matching
- Removing findings from `report.json` (presentation filters only)
- Auth-journey diagnosis redesign
- Rewriting HTML verification tables (Matched/Missing stay as today)

## Problem (current)

`diagnoseFailure` emits one finding per missing expect. After an early `step_failed`, CLI/`formatDiagnosisText` lists everything. Non-technical readers see cascade noise, not the story.

## Approach

Keep computing **full** `findings`. Add a **presentation layer** that derives human fields and a default display subset. Surfaces that talk to humans use the presentation; JSON keeps everything.

```
RunResult → diagnoseFailure → DiagnosisResult
  ├── findings (full) → report.json / explain --verbose / HTML details
  └── summary, guidance, primaryFindingIndexes, cascadeNote
        → CLI run/explain default, HTML/MD summary
```

## Diagnosis contract (additive, `version` stays `1`)

```ts
type DiagnosisResult = {
  version: 1;
  pass: false;
  findings: DiagnosisFinding[]; // complete list, sorted as today
  /** Human one-liner (primary summary for humans) */
  summary: string;
  /** 1–3 plain next-step lines for non-technical readers */
  guidance: string[];
  /** Indexes into findings[] shown in default human view */
  primaryFindingIndexes: number[];
  /** Present when missing-event findings were collapsed after a step abort */
  cascadeNote?: string;
};
```

SaaS should key automation on `findings[].code` (unchanged). `summary` / `guidance` / `cascadeNote` are for UI copy.

## Presentation rules (deterministic)

### 1. Cascade collapse

If there is at least one `step_failed` or `wait_for_event_timeout`, and there are missing-event findings (`event_missing_*`):

- **Primary findings:** all step/timeout findings, plus at most **two** `event_missing_near_miss` findings (first two near-misses in sorted order for v1), plus any `unexpected_events` / `forbid_extra_failed` / `capture_warnings` / `no_events_captured`.
- **Collapsed:** remaining `event_missing_*`.
- **`cascadeNote`:** e.g. `12 later analytics checks were not reached because the journey stopped early.`

If there is **no** step/timeout failure, all findings are primary; no `cascadeNote`.

### 2. Human `summary` (headline)

Template priority (first match):

| Condition | Summary template |
|-----------|------------------|
| Step fail + near-miss with actual `page` in evidence | `The journey stopped at step {n} ({action}). The app was on "{actualPage}" instead of the expected screen.` |
| Step fail only | `The journey stopped at step {n} ({action}): {shortReason}.` |
| `wait_for_event_timeout` | `Timed out waiting for analytics event "{eventName}" after step {n}.` |
| `no_events_captured` | `No analytics events were captured during this run.` |
| Only missing near-misses | `An analytics event fired with the wrong details (closest match: "{eventName}").` |
| Only missing no-near-miss | `Expected analytics events never fired.` |
| Fallback | First primary finding’s first message line (strip Playwright “Call log” blocks). |

### 3. `guidance` (1–3 bullets)

- Selector / `waitForSelector` timeout → check login/account and visible (not empty/error) screen
- Near-miss / actual page contains `empty` → empty-state account/data hint
- `no_events_captured` → instrumentation / collector patterns
- `wait_for_event_timeout` (when no step_failed) → UI moved on or expect mismatch
- Generic fallback → open HTML report screenshot and Technical findings

### 4. Plain-language labels (display only)

| Code | Label |
|------|--------|
| `step_failed` | Stopped on a page step |
| `wait_for_event_timeout` | Timed out waiting for an analytics event |
| `event_missing_near_miss` | Analytics event had the wrong details |
| `event_missing_no_near_miss` | Expected analytics event never fired |
| `no_events_captured` | No analytics events captured |
| `forbid_extra_failed` | Extra analytics events were not allowed |
| `unexpected_events` | Extra analytics events were seen |
| `capture_warnings` | Some network events could not be parsed |

## Surface behavior

| Surface | Default | Verbose / details |
|---------|---------|-------------------|
| Failed `run` CLI | Headline + guidance + primary findings (labels) + cascadeNote | Keep short (no verbose flag on run) |
| `explain` | Same as run | `--verbose` lists all findings with `[code]` |
| `explain --json` | Full `DiagnosisResult` | — |
| HTML Diagnosis | Headline, guidance, cascadeNote, primary list | `<details>Technical findings</details>` full list |
| Markdown | Same; technical under `### Technical findings` | — |
| `report.json` | Full object always | — |

`formatDiagnosisText(diagnosis, { verbose?: boolean })` — default `false`.

## Success criteria

- Activation-style early abort: default CLI/HTML diagnosis is short human content, not 18+ finding dumps
- `report.json` still contains every finding code
- `explain --verbose` restores full technical list
- Unit tests for cascade, headline with actual page, empty_state guidance, verbose vs default, PASS omits diagnosis
- No model/network dependencies

## Out of scope

Changing verifier near-miss pairing; skipping verification after step failure.
