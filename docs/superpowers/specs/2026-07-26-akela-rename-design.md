# Akela rename design

**Date:** 2026-07-26  
**Status:** Approved for planning  
**Approach:** Direct cutover (no dual CLI, no config fallback)

## Goal

Rename all public and internal product references from **Telvara** / **Analytics Tracker** / **analytics-tracker** to **Akela** / **akela**, matching the GitHub repo rename (`splinter7/akela`).

## Decisions

| Decision | Choice |
|---|---|
| Scope | Full rename: package, CLI, config, branding, **and** recorder DOM/window bindings |
| Config migration | Only `akela.config.yaml` — no fallback to `analytics-tracker.config.yaml` |
| Delivery | Single direct cutover (no dual `bin` aliases, no scoped npm package) |
| Local workspace folder `AnalyticsTracker` | Out of scope (not in git) |
| Git history rewrite | Out of scope |

## Naming map

| Kind | Current | New |
|---|---|---|
| Display name | Analytics Tracker / Telvara | Akela |
| npm `package.json` `name` | `analytics-tracker` | `akela` |
| CLI binary (`bin`) | `analytics-tracker` | `akela` |
| Config filename | `analytics-tracker.config.yaml` | `akela.config.yaml` |
| CLI usage / help / errors | `analytics-tracker …` | `akela …` |
| LICENSE copyright | Telvara contributors | Akela contributors |
| Recorder binding | `__analyticsTrackerRecord` | `__akelaRecord` |
| Recorder flag | `__analyticsTrackerRecorderInstalled` | `__akelaRecorderInstalled` |
| Recorder scroll flush | `__analyticsTrackerRecorderFlushScroll` | `__akelaRecorderFlushScroll` |

## Behavior changes

1. **Config load** (`src/config/loadConfig.ts`): resolve and validate only `akela.config.yaml` relative to cwd. Error messages refer to that filename. No deprecation path for the old name.
2. **`init` scaffold** (`src/cli/index.ts`): write `akela.config.yaml` and use Akela copy in generated comments / help.
3. **CLI surface**: all usage strings in `parse*Args.ts` and help text use `akela`.
4. **Reports / demo**: HTML title and demo page branding use Akela.
5. **Recorder session**: rename window/binding identifiers to `__akela*` as mapped above. No compatibility aliases for old binding names.
6. **Tests**: update expectations, fixture filenames, and temp-dir prefixes that embed the old name.

## Files to change

- `package.json`, `package-lock.json`
- `analytics-tracker.config.yaml` → `akela.config.yaml` (git mv + comment update)
- `LICENSE`
- `README.md`
- `demo/index.html`
- `src/cli/index.ts`
- `src/cli/parseAuthArgs.ts`
- `src/cli/parseExplainArgs.ts`
- `src/cli/parseGenerateArgs.ts`
- `src/cli/parseRecordArgs.ts`
- `src/cli/parseRunArgs.ts`
- `src/config/loadConfig.ts`
- `src/report/writeReports.ts`
- `src/record/RecorderSession.ts`
- `tests/unit/loadConfig.test.ts`
- `tests/unit/parseExplainArgs.test.ts`
- `tests/unit/parseRunArgs.test.ts`
- `tests/unit/journeyRunner.test.ts`

## Out of scope

- Renaming the local checkout directory `AnalyticsTracker`
- Renaming the npm script `track` (still runs the CLI via tsx)
- Rewriting historical commit messages that say Telvara / Analytics Tracker
- Publishing to npm (availability of the `akela` name is not required for this rename)
- Dual-binary or config-compatibility shims

## Verification

1. Grep source, tests, config, README, LICENSE, and demo for `telvara`, `Telvara`, `analytics-tracker`, `Analytics Tracker`, and `__analyticsTracker` — expect zero hits. Mentions inside `docs/superpowers/specs/` (and later plans) that document the rename are allowed.
2. Run `npm test` and `npm run ci` — all pass.
3. Smoke: `npm run track -- help` shows Akela branding and `akela` usage strings.

## Risks

- **Breaking:** existing clones with `analytics-tracker.config.yaml` or docs/scripts using the old CLI name must update once.
- **npm name:** if later published, `akela` may already be taken; out of scope for this change — local package name still becomes `akela`.
