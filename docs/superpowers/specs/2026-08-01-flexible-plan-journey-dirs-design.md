# Flexible plan and journey directories

## Goal

Let users place plan CSVs and journey YAMLs in any directory structure they choose, while keeping sensible defaults. Explicit CLI paths remain the source of truth; project config can override the default journey output directory and declare where plans are expected to live.

## Background

Today, validate / generate / record / run / auth already accept arbitrary paths (resolved against `process.cwd()`, or absolute). The main friction is convention and defaults:

- `generate` and `record` default `--out` to `journeys/<name>.yaml`
- `init` hardcodes creating and writing under `journeys/`
- docs, help, and the analytics-plan-csv skill assume `plans/` + `journeys/`
- `akela.config.yaml` has `reportDir` but no plan/journey directory keys

`generateJourney` itself is in-memory CSV → YAML and has no filesystem path coupling beyond the CLI default out path.

## Non-goals

- Auto-prefixing plan arguments from `plansDir` (users still pass the CSV path)
- Mirroring nested plan paths into journey paths (`plans/a/b.csv` → `journeys/a/b.yaml`)
- Bare-name resolution (`akela run checkout` → `journeysDir/checkout.yaml`)
- Changing how `akela.config.yaml` itself is discovered (still cwd + fixed filename)

## Behavior

1. Explicit paths always work and win over defaults.
2. When `--out` is omitted on `generate` / `record`, write to `{journeysDir}/{name}.yaml`.
3. Journey `name` continues to come from `--name` or the plan CSV basename.
4. `init` creates `{plansDir}/` and `{journeysDir}/`, writes example journeys under `journeysDir`, and seeds config with `plansDir` / `journeysDir`.
5. `plansDir` is for convention, scaffolding, and docs — not for implicit plan-path resolution.
6. Nested path mirroring remains out of scope.

### Precedence for generate/record output

1. `--out` / `-o` if provided
2. Else `join(journeysDir, `${name}.yaml`)` where `journeysDir` comes from loaded config (default `journeys`)

## Config

Add optional fields to `AppConfig`, Zod `appConfigSchema`, and `DEFAULT_CONFIG` in `loadConfig`:

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `plansDir` | non-empty string | `plans` | Declared location for plan CSVs; used by `init` scaffold and docs |
| `journeysDir` | non-empty string | `journeys` | Default directory for generate/record output and `init` examples |

Paths are relative to project cwd (same model as `reportDir`). Absolute paths are allowed.

Empty strings are rejected via Zod (`z.string().min(1)`), matching `reportDir`.

Example `akela.config.yaml` fragment (also written by `init` when creating config):

```yaml
reportDir: reports
plansDir: plans
journeysDir: journeys
```

Existing projects without these keys keep today’s behavior via defaults.

## CLI

### Argument parsers

- `parseGenerateArgs` / `parseRecordArgs`: do not hardcode `join("journeys", …)`.
- Prefer leaving `outPath` undefined when `--out` is omitted, then resolve in the command after `loadConfig`.
- This keeps parsers pure and makes config the single source of defaults.

### Commands

- `generate` / `record`: after `loadConfig`, if `outPath` is unset, set it to `join(config.journeysDir ?? "journeys", `${name}.yaml`)`.
- `init`: use configured/default `plansDir` and `journeysDir` (from defaults when no config yet, or from existing config if present); create both directories; write examples under `journeysDir`; print next-step commands using those dirs.
- Help text: describe default out as `{journeysDir}/<name>.yaml` (configured; default `journeys/`).

### Unchanged

- `validate`, `run`, `auth` still require explicit file paths.
- Overwrite / missing-file error behavior unchanged.

## Docs

- README: short “Project layout” note — plans and journeys may live anywhere; pass paths explicitly; defaults for generated journeys come from `journeysDir` (default `journeys`); `plansDir` documents the conventional plan location.
- Update generate/record default wording from a hard-coded `journeys/<name>.yaml` to config-aware language.
- Keep examples on `plans/` + `journeys/` for familiarity.
- analytics-plan-csv skill: prefer writing under configured/`plans/` but allow any path the user requests.

## Testing

- `loadConfig`: defaults include `plansDir` / `journeysDir`; overrides accepted; empty string rejected.
- generate/record default-out resolution: custom `journeysDir` is used when `--out` omitted; `--out` still wins.
- Optional: cover `init` creating both dirs if practical with existing test patterns.

## Error handling

- Invalid/empty `plansDir` / `journeysDir` → Zod config error, same style as other fields.
- Missing plan CSV / existing out without `--overwrite` → unchanged.

## Rollout

Small, backward-compatible change. No migration required; defaults preserve current layout.
