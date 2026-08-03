# Tauri desktop distribution

## Goal

Distribute Akela so non-technical users can run the full local workflow (author/edit plans, record/generate journeys, auth, run, view reports, edit config) on Windows and Mac without Node/npm, while engineers keep full CLI access for terminal and CI use.

## Background

Akela is a Node.js (≥20) CLI that drives Playwright Chromium to verify analytics events. Today distribution is clone → `npm install` → `npx playwright install chromium`. That fits engineers; it blocks PMs and other non-technical users who need the same capabilities without a toolchain.

A true single-file binary is impractical while Playwright launches Chromium. The practical path is a **desktop app installer** that bundles the runtime and browser, with the UI as a shell over the existing engine.

## Audience and constraints

| Constraint | Choice |
|------------|--------|
| Primary users | Engineers/QA **and** non-technical users |
| Non-technical scope | Full workflow (not report-only) |
| Interaction | Desktop app (Tauri) |
| Data locality | **Local only** — staging URLs, passwords, and `.auth/` never leave the machine |
| Platforms (v1) | Windows + Mac |
| CLI | Retained; desktop does not replace it |

## Non-goals (v1)

- Linux installer
- Hosted/cloud runner or SaaS
- Pure single-file executable with no Node/Playwright sidecar
- Removing or deprecating the CLI
- In-app visual journey designer (beyond text/YAML editing)
- Plan-authoring AI embedded in the desktop app
- Auto-update (nice-to-have later; not required for v1)

## Architecture

Shell over a shared engine. One product, three surfaces:

```text
┌─────────────────────────────────────┐
│  Tauri desktop app (UI)             │
│  project nav, actions, settings,    │
│  logs, open report.html             │
└──────────────┬──────────────────────┘
               │ IPC → sidecar
┌──────────────▼──────────────────────┐
│  Akela engine (shared TypeScript)   │
│  validate / generate / record /     │
│  auth / run / explain / config I/O  │
└──────────────▲──────────────────────┘
               │ same APIs
┌──────────────┴──────────────────────┐
│  CLI (`akela`) — engineers & CI     │
└─────────────────────────────────────┘
```

### Principles

1. **CLI stays a thin argv wrapper** over engine APIs. Desktop invokes those APIs via a bundled Node sidecar — not by shelling out to `npm`.
2. **Project folder model unchanged:** user opens a directory containing `akela.config.yaml` (or scaffolds one). Working directory for all operations is that folder.
3. **No cloud dependency** for runs, auth, or config. Playwright headed windows run on the local machine (same as CLI).

### Repo layout (additive)

| Path | Role |
|------|------|
| `src/` | Engine + CLI (existing) |
| `desktop/` | Tauri app (UI + Rust glue to sidecar) |

Desktop must not reimplement verification, adapters, or journey execution.

## Packaging and runtime

### Installer contents

Win + Mac installers (Tauri bundler) include:

- Tauri UI shell
- Bundled Node runtime
- Compiled Akela engine (`dist/` + production dependencies)
- Playwright Chromium

End users do not need npm. Engineers may continue to clone and use the CLI, or install a published npm package when available.

### Sidecar protocol

- Tauri spawns the bundled Node process and communicates over **stdio JSON lines** (one JSON request/response or event per line). Loopback HTTP is a fallback only if stdio proves insufficient.
- Operations mirror CLI commands and return **structured results** plus **progress events** (not only stdout and exit codes).
- Missing/corrupt Chromium → clear in-app error with recovery guidance (reinstall / repair).

### Code signing

Ship signed installers from GitHub Releases when certificates are available. Unsigned local/dev builds are acceptable during development.

## Desktop UX (v1)

One window, one open project folder.

| Area | Capabilities |
|------|----------------|
| **Project** | Open or create folder; show path; scaffold via `init`-equivalent if empty |
| **Plans** | List CSVs under `plansDir`; open/edit; Validate; Generate journey |
| **Journeys** | List YAMLs under `journeysDir`; open/edit; Record (headed); Auth; Run |
| **Reports** | List under `reportDir`; open `report.html`; Explain on failures |
| **Settings** | Edit `akela.config.yaml` (form mapped to schema keys + optional raw YAML); save with Zod validation; optional “Open in external editor” |

### Run / record feedback

- Live log stream in-app
- On completion: prominent PASS/FAIL and action to open the HTML report

### Auth and secrets

- Collect `--var`-style inputs (e.g. email/password) in the UI
- Persist Playwright `storageState` under project `.auth/` (never uploaded)
- Headed browser windows are Playwright’s, outside the Tauri window

## Config editing

Users must be able to view and modify `akela.config.yaml` for the open project.

- Settings UI covers known keys from `appConfigSchema` (including `baseUrl`, `headless`, `reportDir`, `plansDir`, `journeysDir`, `storageState`, `gotoWaitUntil`, quiet timings, `snowplow.collectorPatterns`, `record.selectorPrefer`, etc.).
- Save writes YAML to `{project}/akela.config.yaml`.
- Invalid values rejected with the same schema errors as `loadConfig`.
- CLI and desktop always read the same file on disk.

## Engine API prerequisites

Before a useful shell exists, extract stable APIs from CLI handlers so both CLI and desktop share:

- Command entrypoints that accept typed options + `cwd`
- Structured success/failure results (paths written, pass/fail, diagnosis summaries)
- Progress/log callbacks (replace sole reliance on `console.log` for long-running `run` / `record` / `auth`)

CLI exit codes and human-readable terminal output remain; they become adapters over these APIs.

## Distribution channels

| Channel | Audience |
|---------|----------|
| GitHub Releases (Win + Mac installers) | Non-technical users and anyone who wants the app |
| Clone + npm / optional `npm i -g akela` | Engineers and CI |
| README | Two install paths: “Install the app” vs “Use the CLI” |

Prefer aligning desktop engine version with CLI/package version when cutting releases.

## Phasing

1. **Engine API extraction** — structured results + progress; CLI wired through the same layer.
2. **Sidecar + thin Tauri shell** — open project, run one journey, stream logs, open report.
3. **Full v1 UI** — Plans, Journeys, Reports, Settings (including config edit).
4. **Installer packaging** — bundle Node + Playwright Chromium; CI builds for Win + Mac; publish Release assets.

Phase 1 unblocks engineers immediately and reduces desktop risk. Phases 2–4 deliver the non-technical path.

## Error handling

- Config schema errors → show field-level messages in Settings; do not write invalid YAML.
- Journey/run failures → same report artifacts as CLI; surface PASS/FAIL and Explain.
- Sidecar crash / browser missing → non-technical wording + link to reinstall/repair.
- Do not transmit project files, credentials, or reports off-machine.

## Testing

- Engine API unit/integration tests remain the source of truth (existing Vitest suite + new API tests).
- Sidecar protocol: contract tests for request/response shapes and progress events.
- Desktop UI: smoke coverage for open project → run → open report (manual or light E2E later).
- Packaging: CI job that builds installers (or dry-run bundle) on Win + Mac runners when ready.

## Rollout

Additive. Existing CLI workflows stay valid. Desktop is optional. No migration of plans/journeys required beyond opening an existing project folder.
