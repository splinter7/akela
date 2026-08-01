# Journey-defined auth via storageState — Design

**Date:** 2026-07-19  
**Status:** Approved  
**Context:** Closes the deferred auth/`storageState` refresh gap without coupling the engine to site-specific login presets.

## Goal

Support authenticated staging journeys for **any** site by treating login as a normal journey that writes Playwright `storageState`, then letting tracking journeys consume that file. Auth stays author-defined; the engine only provides a save primitive and a thin CLI.

## Non-goals

- Auto re-login mid-tracking-run when a session expires
- Named auth presets / `setup.auth` registry in the engine
- Journey `includes` / composition (may layer later on the same primitive)
- CI secret wiring or encrypted storage-state artifacts
- SSO/MFA special-cases beyond headed browser + human-in-the-loop

## Product shape

Two artifacts:

1. **Auth journey** — site-specific login steps + `saveStorageState`
2. **Tracking journey** — analytics steps + `expect`, with `storageState` pointing at the written file

```
track auth journeys/login-….yaml  →  .auth/….json
track run  journeys/….yaml        →  uses storageState (unchanged)
```

## Journey contract

### Auth journey example

```yaml
name: login-service-pro
baseUrl: https://staging.example.com
adapters:
  - snowplow
expect: []
steps:
  - action: goto
    path: /login
  - action: fill
    selector: "[data-testid=email]"
    value: "${AUTH_EMAIL}"
  - action: fill
    selector: "[data-testid=password]"
    value: "${AUTH_PASSWORD}"
  - action: click
    selector: "[data-testid=login-submit]"
  - action: waitForSelector
    selector: "[data-testid=nav]"
  - action: saveStorageState
    path: .auth/storage-state.json
```

### Tracking journey

Unchanged pattern:

```yaml
storageState: .auth/storage-state.json
# … steps + expect (still required, min 1)
```

### Rules

- `saveStorageState` is a first-class step with `path` (relative to cwd).
- Creates parent directories; overwrites existing file.
- Auth journeys must include **at least one** `saveStorageState` step.
- Credentials only via `--var` / env substitution — never commit secrets.
- No engine-level named presets; reuse = separate auth YAML files (composition/`includes` later).

## CLI

```
analytics-tracker auth <journey.yaml|json> [--var name=value ...] [--headed|--headless]
```

| Behavior | Auth command | Tracking `run` |
|----------|--------------|----------------|
| Default headed | **headed** | config / existing default (headless) |
| Network capture | **off** | on |
| Event verification | **skipped** | required (`expect.min(1)`) |
| Empty `expect` | allowed | rejected |
| Reports | none by default | HTML/JSON/Markdown as today |
| Success | steps OK + storage file written | verify pass |

Also:

- `saveStorageState` works under `run` for power users; if `expect` is non-empty, verification still runs.
- `auth` fails clearly when the journey has zero `saveStorageState` steps.
- On success, CLI prints the absolute path written.
- Help / README / `init` document the two-step staging flow.

## Schema

- **Tracking load path:** keep `expect` with `min(1)`.
- **Auth load path:** allow empty `expect`; require ≥1 `saveStorageState` in `steps`.
- Keep `adapters` required on both paths (ignore in auth mode) to avoid dual root schemas.

Implementation sketch: `loadJourney(path, { mode: "auth" | "run" })` or a dedicated `loadAuthJourney` that applies the auth refinements.

## Runner

When running in auth mode:

1. Launch browser (headed by default).
2. Do **not** attach `NetworkCapture`.
3. Execute steps; on `saveStorageState`, call `context.storageState({ path })`.
4. Skip quiet-drain and `EventVerifier`.
5. Return success if all steps completed and at least one save wrote a file.

Tracking `run` path unchanged, including existing missing-`storageState`-file error.

## Docs and scaffolding

- README staging section: (1) `auth` → write state, (2) `run` with `storageState`.
- `init` adds `journeys/login.example.yaml` (placeholders + comments).
- `.auth/` remains gitignored.
- No real credentials in repo examples.

## Success criteria

- Different sites authenticate via different auth journeys only.
- Tracking journeys stay analytics-focused + `storageState`.
- Unit tests cover:
  - `saveStorageState` writes the file
  - auth mode rejects missing `saveStorageState`
  - auth mode allows empty `expect`
  - `run` still requires `expect.min(1)`

## Alternatives considered

| Approach | Why not |
|----------|---------|
| Always login inside each tracking journey | Couples every analytics file to login; slower; noisier reports |
| Cached state + auto re-login on check failure | Better UX later; more engine complexity; deferred |
| Named auth presets in the engine | Site-specific; fights multi-site use |
| `saveStorageState` step only (no `auth` CLI) | Primitive alone is hard to discover; dummy expects |
| Dedicated `auth` CLI only (no step) | Hides mechanism; risks a second YAML dialect |
