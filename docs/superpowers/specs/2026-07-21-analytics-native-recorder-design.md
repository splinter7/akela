# Analytics-native journey recorder — Design

**Date:** 2026-07-21  
**Status:** Approved (pending implementation plan)  
**Context:** The core product job is proving the right analytics event left the browser with the right payload. Manual network-tab checks are tedious; engineers verify first, then PMs/analysts re-check the same thing on staging. Journey YAML setup (selectors, auth wiring) is the main blocker to a shared eng-authored / PM-rerunnable loop. PMs/analysts own the tracking **plan**; engineers own recording the UI flow. The recorded journey must be checked against that plan — not only against whatever happened to fire.

## Goal

Replace the eng → DevTools → PM → DevTools loop with:

1. PM/analyst writes `plan.csv` (the contract: events + expected properties/fields).
2. Eng (or technical PM) **records** a happy-path click-through with `--plan`.
3. Recorder emits a **draft journey**: steps from the session (stable selectors when conventions are present); **`expect` seeded from the plan**, reconciled with live capture.
4. At stop, print **plan coverage** (missing / matched / unexpected). Missing plan events fail the record command by default.
5. Eng lightly reviews (fragile selectors, auth/`storageState`, incomplete coverage fixes).
6. Anyone **re-runs** `track run` and trusts pass/fail + existing diagnosis — no network tab.

Verification semantics for `run` stay unchanged: adapters / verifier / reports remain the source of truth. Record authors journeys faster **and** binds them to the PM plan.

## Non-goals

- SaaS / hosted “click Run” UI
- Auto-healing or rewriting broken selectors after the fact
- LLM or AI deciding pass/fail
- Auto-injecting `data-analytics-id` / testids into customer product HTML
- MFA / SSO beyond existing headed `auth` + `storageState`
- Recording `waitForAny` branches, `when` guards, or mid-session re-auth in v1
- Multi-adapter recording beyond adapters already registered for the session
- A separate standalone `check` CLI in v1 (coverage runs inside `record --plan`; a later `track check` may wrap the same module)

## Approach

**Analytics-native recorder** (not a thin Playwright codegen wrapper): headed Playwright session that records UI actions **and** reuses network capture + adapters so plan coverage and expects come from real beacons.

Ships **with** selector conventions in one pass: the recorder prefers analytics/testid attributes when emitting step selectors.

**Plan is the contract** when `--plan` is provided. Capture is evidence. Do not invent `expect` solely from unplanned traffic.

## Architecture

Four pieces:

1. **Selector policy** — shared resolver with a fixed priority ladder; optional config override.
2. **Recorder session** — headed browser; listen for user actions; attach existing capture/adapters; on stop, emit journey YAML.
3. **Plan coverage** — diff plan rows vs captured normalized events; drive exit code and stop summary.
4. **Expect builder** — with `--plan`, seed `expect` from the plan (merge observed values for plan-listed keys). Without `--plan` (exploratory), fall back to capture-based suggestions (draft/exploratory only).

```text
PM:   plan.csv  (intent)
Eng:  track record <url> --plan plan.csv  →  journeys/<name>.yaml (draft) + coverage
Anyone: track run <journey>               →  existing verify/report path (unchanged)
```

## Selector conventions & priority ladder

### Product convention (document + demo)

Prefer stable analytics hooks on interactive elements:

1. `data-analytics-id="<stable-id>"` — preferred for tracking journeys
2. `data-testid="<id>"` — accepted fallback

Demo CTA (and similar) should use `data-analytics-id` so local recorder demos exercise the happy path.

### Resolver priority (first hit wins)

1. `[data-analytics-id="…"]`
2. `[data-testid="…"]`
3. Role/name only when it can be emitted as a **stable CSS selector string** the runner already supports; skip if ambiguous
4. `#id` if present and not dynamic-looking (reject ids matching `/^[a-f0-9-]{8,}$/i`, containing `ember`/`react`, or ending in long numeric suffixes)
5. Short CSS path last resort → emit step with YAML comment `# FRAGILE-SELECTOR`

Always prefer (1)/(2). If only (5) is available, still emit the step; at stop, print: “N fragile selectors — add data-analytics-id for stability.”

### Config

Optional in `analytics-tracker.config.yaml`:

```yaml
record:
  selectorPrefer:
    - data-analytics-id
    - data-testid
```

`selectorPrefer` reorders **attribute-based** prefs only (steps 1–2). Role / `#id` / CSS fallbacks stay after attributes in the fixed ladder. Default attribute order matches the list above.

## Recorder session UX

### CLI

```bash
npm run track -- record <startUrl> \
  --plan plans/feature.csv \
  --out journeys/my-feature.yaml \
  --name my-feature \
  --adapters snowplow \
  [--storage-state .auth/storage-state.json] \
  [--base-url https://staging.example.com] \
  [--overwrite] \
  [--force] \
  [--allow-incomplete] \
  [--include-unplanned]
```

| Flag | Role |
|------|------|
| `--plan` | Recommended for feature work. Loads/validates canonical plan CSV. Seeds `expect` and runs coverage. |
| `--force` | Allow writing a draft when zero steps were recorded. |
| `--overwrite` | Required when `--out` already exists. |
| `--allow-incomplete` | Exit `0` even if plan events are missing (still print coverage; still write draft). Default: missing → exit `1`. |
| `--include-unplanned` | Also append `expect` entries for captured events not in the plan (default: warn only, do not add). |

Without `--plan`: exploratory mode — capture-based expect suggestions; header marks `# DRAFT — exploratory (no --plan)`.

### Session flow

1. If `--plan`: validate plan up front (fail before opening browser on invalid CSV).
2. Open **headed** Chromium at `startUrl` (optional `storageState` for already-logged-in).
3. Attach existing **network capture + adapters** (same pipeline as `run`).
4. Record user actions into steps:
   - First navigation → `goto` (path relative to `baseUrl` when possible)
   - Clicks → `click` + resolved selector
   - Typing → `fill` (see secrets warning below)
   - Sparse `waitForSelector` only when a stable testid/analytics-id landmark appears after navigation — no sleep spam
5. Stop via **CLI Enter** in the terminal (v1). Optional on-page “Stop recording” control may follow; not required for v1.
6. Run plan coverage (if `--plan`); build `expect`; write draft YAML; print summaries and next `run` command.

### Draft journey defaults

- `adapters` from flag or config
- `gotoWaitUntil: domcontentloaded`
- `storageState` copied from flag if provided
- `expect` from plan builder (or exploratory suggester)
- Header comment: `# DRAFT — review selectors; expect seeded from plan <path>` (or exploratory variant)

### Not recorded in v1

`waitForAny`, `when`, scroll tuning, mid-session re-auth. Eng adds those by hand after recording the happy path.

Plan `trigger` / `path` / `selector` / `value` / `notes` inform **human review** and may later help order `waitForEvent` placement; v1 does **not** require the recorder to replay the plan as steps (the eng click-through is the step source). Optional future: warn when plan `page_load` paths were never navigated.

## Plan coverage

**Input:** validated `PlanRow[]` + captured `NormalizedEvent[]`.

**Match rule (aligned with journey verify):** an event matches a plan row when `eventName` equals and plan `properties` / `fields` (if present) are a deep subset of the actual event’s `properties` / `fields` (same semantics as `run` expects).

**Buckets:**

| Bucket | Meaning |
|--------|---------|
| **Matched** | Plan row satisfied by ≥1 captured event |
| **Missing** | Plan row never satisfied |
| **Unexpected** | Captured event `eventName` (after noise filter) not required by any plan row |

**Stop summary (with `--plan`):**

```text
Plan coverage: 5 matched, 1 missing, 2 unexpected
  Missing: checkout_submit (properties.currency)
  Unexpected: page_ping, debug_event
Fragile selectors: 1
Wrote journeys/feature.yaml
Next: npm run track -- run journeys/feature.yaml
```

**Exit code:** `1` if any **Missing** (unless `--allow-incomplete`). Unexpected alone does not fail by default (warn). Invalid plan / unreachable URL still fail before or during session as elsewhere.

## Expect builder

### With `--plan` (default feature path)

1. For each plan row, emit one `expect` with that row’s `eventName` and any plan `properties` / `fields`.
2. If the row **Matched**, optionally **backfill** observed values only for keys the plan already listed (fill empty plan objects / reinforce listed keys with stable observed values). Do not add observed keys the plan did not list.
3. If the row is **Missing**, still emit the plan’s `expect` so `run` will fail until instrumentation is fixed (journey remains a useful checklist).
4. Do **not** add unplanned captured events to `expect` unless `--include-unplanned`.
5. Best-effort: insert `waitForEvent` after the user action that most recently preceded a matched event (by timestamp).

### Without `--plan` (exploratory)

Capture-based suggestions (noise denylist, churn-key omission, intersection for duplicates) — same rules as previously designed for an unbound suggester. Mark draft as exploratory.

### Shared

Recording never claims verification success for the product feature — **`run`** is still the pass/fail gate for the committed journey. Plan coverage at record time is a **shift-left** gate so eng doesn’t hand PMs a journey that already drifted from the plan.

## Errors & guardrails

| Condition | Behavior |
|-----------|----------|
| Invalid `--plan` CSV | Fail before browser; print validation errors |
| Start URL unreachable | Fail fast; no empty YAML |
| Unknown adapter | Same error as `run` |
| `--out` exists | Require `--overwrite` (match `generate`) |
| Password-like `fill` | Still record; warn to prefer `auth` + `storageState` / `--var`; do not commit secrets |
| Zero analytics events | Still write steps; warn; with `--plan`, all rows likely **Missing** → exit `1` unless `--allow-incomplete` |
| Zero steps on stop | Do not write file unless `--force` |
| Plan **Missing** events | Write draft; exit `1` unless `--allow-incomplete` |

## Eng → PM handoff

1. PM/analyst: author `plan.csv` (selectors may be blank).
2. Eng: `auth` once → `record … --plan plans/feature.csv` → fix missing instrumentation or re-record until coverage is clean → review fragile selectors → commit journey.
3. PM/analyst: `run` (or receive `report.html` / `explain`) — no DevTools; expects already align to their plan.
4. Feature iteration: update plan first when contract changes; re-`record` when UI flow changed; prefer editing expects only for small payload tweaks that stay plan-consistent.

## Testing

- **Unit:** selector priority ladder; plan coverage buckets; expect builder (plan seed, no unplanned leak, backfill only listed keys); exploratory suggester (noise/churn/intersection).
- **Integration:** record against local `demo` with `plans/demo.csv` (scripted action stream; no manual headed CI) → coverage matched for `page_view` / `cta_click` → YAML loads → `run` PASSes; case with deliberate missing event → exit `1` and Missing in summary.
- Staging not required in CI.

## Docs

- Short “Recording journeys” section covering `--plan`, coverage, conventions, handoff (PM plan → eng record → PM run).
- Selector convention note for product teams (`data-analytics-id` / `data-testid`).
- Demo HTML: add `data-analytics-id` on the CTA used by the recorder demo path.

## Implementation sketch (modules)

| Module | Responsibility |
|--------|----------------|
| `src/record/selectorPolicy.ts` | Priority ladder + fragile marking |
| `src/record/planCoverage.ts` | Diff plan rows vs captured events |
| `src/record/expectBuilder.ts` | Plan-seeded expects (+ exploratory suggester) |
| `src/record/RecorderSession.ts` | Headed browser, action listeners, capture wiring, stop |
| `src/record/writeDraftJourney.ts` | YAML emit with DRAFT header |
| `src/cli/parseRecordArgs.ts` + `record` command | CLI surface |

Reuse: `validatePlanCsv` / `PlanRow`, `NetworkCapture`, adapter registry from `JourneyRunner`, journey Zod schema, existing subset-match helpers from verify if exportable.

## Success criteria

- Demo path: plan + record → coverage clean → `run` PASS without opening DevTools.
- Record with `--plan` fails (exit `1`) when planned events never fired, unless `--allow-incomplete`.
- Draft `expect` matches the plan contract; unplanned noise does not pollute expects by default.
- Draft journeys with `data-analytics-id` / `data-testid` do not need hand-tuned CSS for those steps.
- PMs can re-run an eng-owned journey whose expects came from **their** plan and understand fail via existing diagnosis.
