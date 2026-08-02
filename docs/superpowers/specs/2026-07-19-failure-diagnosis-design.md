# Failure diagnosis (CLI) — Design

**Date:** 2026-07-19  
**Status:** Approved  
**Context:** Phase 1 deferred “AI verification.” Long-term SaaS will call this CLI/TS API as an engine. Failure debugging is the first AI-adjacent product surface; the model must live in SaaS, not in this package.

## Goal

Give every failed tracking run a **deterministic, structured diagnosis** derived from `RunResult` / `report.json`, so:

1. Local users get actionable “why” in CLI + HTML/Markdown without opening raw diffs.
2. A future SaaS can call the same API, store the codes/evidence, and optionally layer an LLM for prose — without changing the engine contract.

Pass/fail remains entirely rule-based (`EventVerifier` + step errors). Diagnosis never changes exit codes.

**Presentation:** human summary / cascade collapse for CLI and HTML is specified in [human-diagnosis-presentation design](2026-07-19-human-diagnosis-presentation-design.md); full `findings[]` remain for SaaS.

## Non-goals

- Calling cloud or local LLMs from this repo (Ollama, OpenAI, in-process GGUF, etc.)
- Using a model to decide pass/fail or soft-match event properties (“AI verification”)
- Hosted history UI, SaaS auth, or SaaS report storage
- Auto-fixing journeys or rewriting selectors
- Auth-journey diagnosis beyond “step failed” (auth mode has no verification today)
- Vision/OCR over `failure.png` in the CLI (SaaS may do this later using the screenshot path)
- Dedicated `ordered_mismatch` findings (verifier does not yet expose an order-specific signal; ordered failures surface as missing/unexpected / step errors until that exists)

## Architecture fit (CLI engine → SaaS)

```
SaaS (optional LLM prose / chat UX)
        │  shells / invokes
        ▼
CLI / TS API  ──►  JourneyRunner  ──►  report.json
                        │
                        ▼
                 diagnoseFailure(RunResult)
                        │
                        ▼
              diagnosis[]  (codes + evidence)
```

| Layer | Owns |
|-------|------|
| **This app** | Structured `diagnosis[]`, human-readable summary lines, report embedding |
| **SaaS (later)** | Persistence, UI, optional LLM rewrite from `diagnosis[]` + artifacts |

If SaaS never adds a model, the codes + messages are still enough for a “Why this failed” panel.

## Product shape

### When diagnosis runs

1. **Automatic on tracking `run` FAIL** — compute diagnosis while writing reports; include in `report.json`, HTML, and Markdown.
2. **`explain` CLI** — recompute (or read) diagnosis from an existing report directory or `report.json` path. Useful for SaaS and humans after the fact.
3. **PASS runs** — omit `diagnosis` (or empty array). Do not invent “success tips.”

Auth CLI (`track auth`) stays out of scope for v1 unless a step fails; then a single `step_failed` entry is enough if we share the helper. Prefer implementing diagnosis against tracking `RunResult` first.

### CLI

```
analytics-tracker explain <reportDir|report.json>
```

Behavior:

- Resolve input to `report.json` (if given a directory, require `report.json` inside it).
- Print a short human summary to stdout (bullet list).
- Print or write structured JSON: default stdout as JSON when `--json`, otherwise human text; always exit `0` if the report was readable (explain is advisory), `1` if the file is missing/invalid.
- Does not re-run the browser.

Optional later (not required for v1): `--out diagnosis.json`.

### TS API

```ts
diagnoseFailure(result: RunResult): DiagnosisResult
diagnoseReportJson(report: ReportJson): DiagnosisResult
```

`runJourney` / `writeReports` call `diagnoseFailure` when `!result.pass` and attach the result to the written JSON.

## Diagnosis contract

Stable JSON shape (versioned for SaaS):

```ts
type DiagnosisResult = {
  /** Schema version for SaaS consumers */
  version: 1;
  pass: false;
  /** Ordered: highest-confidence / most actionable first */
  findings: DiagnosisFinding[];
  /** One-line rollup for CLI banners */
  summary: string;
};

type DiagnosisFinding = {
  /** Stable machine code — SaaS keys off this */
  code: DiagnosisCode;
  /** short | medium severity for UI badges; not a score from an ML model */
  severity: "error" | "warning" | "info";
  /** Human sentence; deterministic template, not LLM */
  message: string;
  /** Structured evidence for UI / LLM prompts */
  evidence: Record<string, unknown>;
};

type DiagnosisCode =
  | "step_failed"
  | "wait_for_event_timeout"
  | "event_missing_no_near_miss"
  | "event_missing_near_miss"
  | "unexpected_events"
  | "forbid_extra_failed"
  | "capture_warnings"
  | "no_events_captured";
```

### Code semantics (v1 rules)

Evaluate from a failed `RunResult`. Emit zero or more findings; prefer specific codes over generic ones. Multiple findings are allowed (e.g. step failed **and** missing expects from a partial run).

| Code | When | Evidence (minimum) |
|------|------|--------------------|
| `step_failed` | `result.error` set and/or any `stepLog` entry `status === "failed"` | `error`, failed step `index` / `action` / `detail` / `reason` |
| `wait_for_event_timeout` | Failed step action is `waitForEvent` (from stepLog/error text) | `eventName` if parseable, `timeout` hint from detail |
| `event_missing_near_miss` | Each missing expect that has `nearMiss` | `eventName`, expected `properties`/`fields`, `diff`, optional actual property keys |
| `event_missing_no_near_miss` | Each missing expect without `nearMiss` | `eventName`, expected shape; note if same name never appeared in timeline |
| `no_events_captured` | `events.length === 0` and verification missing nonempty (or step path completed) | `adapters`, `baseUrl` |
| `unexpected_events` | `unexpected.length > 0` and not solely explained by forbidExtra messaging | event name list (cap e.g. 10) |
| `forbid_extra_failed` | `options.forbidExtra` and unexpected nonempty contributed to fail | count + names |
| `capture_warnings` | `captureWarnings.length > 0` on a FAIL | warning strings (cap) |

**Priority / sort:** `step_failed` / `wait_for_event_timeout` → `no_events_captured` → `event_missing_near_miss` → `event_missing_no_near_miss` → `forbid_extra_failed` / `unexpected_events` → `capture_warnings`.

**Summary line:** first finding’s message, or `"N findings: …"` joining distinct codes if multiple.

### Message templates (examples)

Deterministic strings only, e.g.:

- `step_failed`: `Step {n} ({action}) failed: {reason|error}`
- `event_missing_near_miss`: `Expected "{eventName}" was close — property/field mismatch:\n{diff}`
- `event_missing_no_near_miss`: `Expected "{eventName}" never matched; no near-miss in unused events.`
- `no_events_captured`: `No analytics events were captured. Check adapters, collector patterns, and that the journey reached instrumented UI.`

SaaS may replace these with LLM prose using the same `code` + `evidence`.

## Report integration

### `report.json`

On FAIL, add sibling field:

```json
{
  "runId": "…",
  "pass": false,
  "verification": { },
  "diagnosis": {
    "version": 1,
    "pass": false,
    "summary": "…",
    "findings": [ ]
  }
}
```

On PASS, omit `diagnosis` (preferred) so SaaS can treat absence as “nothing to explain.”

### HTML / Markdown

Add a **Diagnosis** section above verification tables when present:

- Summary
- Bullet list: `[code] message` (message may include fenced diff for near-miss)

Do not remove existing near-miss / step log sections.

## Implementation sketch

```
src/diagnose/
  types.ts          # DiagnosisResult, DiagnosisCode
  diagnoseFailure.ts
  rules/*.ts        # optional split per rule
src/cli/
  parseExplainArgs.ts
  index.ts          # explain command
```

- Pure functions over `RunResult` / parsed report JSON — easy unit tests, no Playwright.
- `writeReports` calls `diagnoseFailure` when `!result.pass`.
- Keep rules table-driven so SaaS-facing codes stay stable; additive new codes bump only when needed (`version` stays `1` until breaking evidence shape changes).

## SaaS handoff (documentation only)

Document in README (short):

- CLI diagnosis is the contract; SaaS should key UI/alerts on `findings[].code`.
- Optional LLM input = `diagnosis` + paths to `report.json` / `failure.png` + journey name.
- Never use LLM output to override `pass`.

No SaaS code in this repo for this feature.

## Success criteria

- Failed demo/staging runs include `diagnosis` in `report.json` with ≥1 finding.
- Near-miss missing events produce `event_missing_near_miss` with the same diff string the verifier already builds.
- Step failures produce `step_failed` (and `wait_for_event_timeout` when applicable).
- `track explain reports/<runId>` prints the summary without re-running the journey.
- Unit tests cover each v1 code with fixture `RunResult`s (no browser).
- No new runtime dependency on model SDKs or HTTP inference clients.

## Alternatives considered

| Approach | Why not (given SaaS-on-CLI) |
|----------|-----------------------------|
| Ollama / local LLM in CLI | SaaS runners aren’t developer laptops; duplicates hosting the SaaS must own |
| In-process GGUF in npm package | Huge artifacts, native binaries, slow CI; still wrong ownership boundary |
| Cloud API keys in CLI | Secrets + network in the engine; SaaS already centralizes this |
| AI verification (model decides match) | Non-deterministic CI; contradicts Phase 1 verifier design |
| Explain-only, never embed in reports | Weaker local UX; SaaS would reimplement the same rules |

## Open questions (resolved for v1)

| Question | Decision |
|----------|----------|
| Zero-install vs Ollama? | **Zero-install rules engine** in CLI |
| LLM location? | **SaaS only**, later |
| Does diagnosis affect exit code? | **No** |
| PASS runs? | **No diagnosis field** |
