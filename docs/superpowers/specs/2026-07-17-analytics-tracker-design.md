# Analytics Event Tracker — Phase 1 Design

**Date:** 2026-07-17  
**Status:** Approved

## Goal

A clone-and-run TypeScript CLI app that drives browser journeys with Playwright, captures analytics network calls, normalizes them via platform adapters, verifies them against expectations, and writes HTML/JSON/Markdown reports.

## Product shape

- Local CLI app (not an npm-published library in Phase 1)
- QA authors journeys in YAML/JSON; power users can use a TypeScript API over the same engine
- Playwright is the browser engine, not the primary user interface

## Architecture

```
CLI / TS API → JourneyRunner (Playwright) → NetworkCapture
  → AdapterRegistry → NormalizedEvent[] → EventVerifier → Reports
```

### Folders

- `src/cli` — `init`, `run`
- `src/api` — `runJourney`
- `src/runner` — journey execution and steps
- `src/capture` — network request capture
- `src/adapters` — `AnalyticsAdapter` interface + Snowplow
- `src/normalize` — shared `NormalizedEvent` type
- `src/verify` — event matching
- `src/report` — HTML / JSON / Markdown writers
- `demo/` — local page firing Snowplow-like beacons
- `journeys/` — example journeys

## Adapter contract

```ts
interface AnalyticsAdapter {
  name: string;
  matches(request: CapturedRequest): boolean;
  parse(request: CapturedRequest): NormalizedEvent[];
}
```

Phase 1 ships Snowplow only. Future platforms add a new adapter and register it; verifier and reports stay unchanged.

## Journey format

YAML with steps (`goto`, `click`, `fill`, `wait`, `waitForEvent`) and `expect` events. Options:

- `ordered` (default `false`)
- `match`: `partial` | `exact` (default `partial`)
- `forbidExtra` (default `false`)

## Verification

- Unordered + partial by default
- Ordered, exact, and forbidExtra modes supported
- Match on `eventName` then properties; no double-matching

## Reports

Each run writes `reports/<run-id>/{report.html,report.json,report.md}` with pass/fail, diffs, raw payloads, and timeline.

## Day-one path

1. `npm install`
2. `npm run demo`
3. `npm run track -- run journeys/demo.yaml`
4. Open HTML report

## Out of scope (Phase 1)

AI verification, npm publish, GA4/Segment adapters, auth-heavy flows, hosted history UI.
