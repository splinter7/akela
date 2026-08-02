# Flexible Plan/Journey Dirs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make plan/journey directory conventions configurable via `plansDir` / `journeysDir` in `akela.config.yaml`, while documenting that explicit CLI paths already work anywhere.

**Architecture:** Add optional config keys with defaults (`plans` / `journeys`). Keep CLI parsers free of hardcoded `journeys/` — leave `outPath` unset when `--out` is omitted, then resolve after `loadConfig` via a small pure helper. `init` scaffolds both dirs from config (or defaults). Docs/skill explain the contract.

**Tech Stack:** TypeScript, Zod config schema, Vitest, Node `path`/`fs`, existing Akela CLI (`tsx src/cli/index.ts`).

**Spec:** `docs/superpowers/specs/2026-08-01-flexible-plan-journey-dirs-design.md`

## Global Constraints

- Explicit CLI paths always win over defaults; no auto-prefix of plan args from `plansDir`.
- No nested path mirroring (`plans/a/b.csv` → `journeys/a/b.yaml`).
- No bare-name resolution (`akela run checkout`).
- Config discovery unchanged: `akela.config.yaml` at cwd only.
- Defaults must preserve today’s behavior when keys are omitted (`plans` / `journeys`).
- Empty `plansDir` / `journeysDir` rejected like `reportDir` (`z.string().min(1)`).
- Prefer TDD; commit after each task.

## File structure

| File | Responsibility |
|------|----------------|
| `src/normalize/types.ts` | `AppConfig.plansDir` / `journeysDir` types |
| `src/config/configSchema.ts` | Zod validation for the new keys |
| `src/config/loadConfig.ts` | Defaults + merge |
| `src/cli/resolveJourneyOutPath.ts` | Pure helper: `--out` or `{journeysDir}/{name}.yaml` |
| `src/cli/parseGenerateArgs.ts` | `outPath?: string` when `--out` omitted |
| `src/cli/parseRecordArgs.ts` | same |
| `src/cli/index.ts` | Wire helper into generate/record; config-aware `init` + help |
| `akela.config.yaml` | Seed example keys in repo default config |
| `README.md` | Project layout note + config-aware defaults |
| `.cursor/skills/analytics-plan-csv/SKILL.md` | Prefer `plans/` but allow any path |
| `tests/unit/loadConfig.test.ts` | Config defaults/overrides/rejection |
| `tests/unit/resolveJourneyOutPath.test.ts` | Out-path precedence |
| `tests/unit/parseGenerateArgs.test.ts` | No hardcoded default out |
| `tests/unit/parseRecordArgs.test.ts` | No hardcoded default out |
| `tests/unit/cmdInitDirs.test.ts` | `init` creates both dirs (optional but included) |

---

### Task 1: Config keys `plansDir` and `journeysDir`

**Files:**
- Modify: `src/normalize/types.ts`
- Modify: `src/config/configSchema.ts`
- Modify: `src/config/loadConfig.ts`
- Test: `tests/unit/loadConfig.test.ts`

**Interfaces:**
- Consumes: existing `AppConfig` / `appConfigSchema` / `DEFAULT_CONFIG` / `loadConfig`
- Produces: `AppConfig.plansDir?: string`, `AppConfig.journeysDir?: string`; defaults `"plans"` / `"journeys"` from `loadConfig` when file missing or keys omitted

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/loadConfig.test.ts`:

```ts
it("defaults plansDir and journeysDir when config file is missing", () => {
  const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
  const cfg = loadConfig(cwd);
  expect(cfg.plansDir).toBe("plans");
  expect(cfg.journeysDir).toBe("journeys");
});

it("accepts plansDir and journeysDir overrides", () => {
  const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
  writeConfig(
    cwd,
    ["plansDir: tracking/plans", "journeysDir: tracking/journeys"].join("\n"),
  );
  const cfg = loadConfig(cwd);
  expect(cfg.plansDir).toBe("tracking/plans");
  expect(cfg.journeysDir).toBe("tracking/journeys");
});

it("rejects empty plansDir", () => {
  const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
  writeConfig(cwd, 'plansDir: ""\n');
  expect(() => loadConfig(cwd)).toThrow(/plansDir/);
});

it("rejects empty journeysDir", () => {
  const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
  writeConfig(cwd, 'journeysDir: ""\n');
  expect(() => loadConfig(cwd)).toThrow(/journeysDir/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/loadConfig.test.ts`

Expected: FAIL — `plansDir` / `journeysDir` undefined or not rejected

- [ ] **Step 3: Implement config support**

In `src/normalize/types.ts`, add to `AppConfig`:

```ts
  /** Conventional directory for plan CSVs (scaffold/docs). Default plans. */
  plansDir?: string;
  /** Default directory for generate/record journey output. Default journeys. */
  journeysDir?: string;
```

In `src/config/configSchema.ts`, add next to `reportDir`:

```ts
    plansDir: z.string().min(1).optional(),
    journeysDir: z.string().min(1).optional(),
```

In `src/config/loadConfig.ts` `DEFAULT_CONFIG`:

```ts
  reportDir: "reports",
  plansDir: "plans",
  journeysDir: "journeys",
```

No special merge logic beyond the existing `{ ...DEFAULT_CONFIG, ...raw }` spread (same as `reportDir`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/loadConfig.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/normalize/types.ts src/config/configSchema.ts src/config/loadConfig.ts tests/unit/loadConfig.test.ts
git commit -m "Add plansDir and journeysDir config defaults."
```

---

### Task 2: Resolve default journey out path (parsers + helper + CLI)

**Files:**
- Create: `src/cli/resolveJourneyOutPath.ts`
- Create: `tests/unit/resolveJourneyOutPath.test.ts`
- Modify: `src/cli/parseGenerateArgs.ts`
- Modify: `src/cli/parseRecordArgs.ts`
- Modify: `src/cli/index.ts` (`cmdGenerate`, `main` record branch)
- Test: `tests/unit/parseGenerateArgs.test.ts`
- Test: `tests/unit/parseRecordArgs.test.ts`

**Interfaces:**
- Consumes: `loadConfig(cwd).journeysDir`, parser `name` / optional `outPath`
- Produces:
  - `resolveJourneyOutPath(outPath: string | undefined, name: string, journeysDir: string): string`
  - `GenerateCliOptions.outPath?: string`
  - `RecordCliOptions.outPath?: string`
  - CLI always passes a concrete `outPath` string into write/`runRecord`

- [ ] **Step 1: Write failing helper tests**

Create `tests/unit/resolveJourneyOutPath.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveJourneyOutPath } from "../../src/cli/resolveJourneyOutPath.js";

describe("resolveJourneyOutPath", () => {
  it("uses explicit --out when provided", () => {
    expect(
      resolveJourneyOutPath("custom/out.yaml", "checkout", "tracking/journeys"),
    ).toBe("custom/out.yaml");
  });

  it("defaults to journeysDir/name.yaml when out omitted", () => {
    expect(resolveJourneyOutPath(undefined, "checkout", "tracking/journeys")).toBe(
      join("tracking/journeys", "checkout.yaml"),
    );
  });

  it("uses default journeysDir value from caller", () => {
    expect(resolveJourneyOutPath(undefined, "demo", "journeys")).toBe(
      join("journeys", "demo.yaml"),
    );
  });
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run: `npm test -- tests/unit/resolveJourneyOutPath.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Implement helper**

Create `src/cli/resolveJourneyOutPath.ts`:

```ts
import { join } from "node:path";

/** Prefer explicit --out; otherwise {journeysDir}/{name}.yaml. */
export function resolveJourneyOutPath(
  outPath: string | undefined,
  name: string,
  journeysDir: string,
): string {
  return outPath ?? join(journeysDir, `${name}.yaml`);
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run: `npm test -- tests/unit/resolveJourneyOutPath.test.ts`

Expected: PASS

- [ ] **Step 5: Update parser unit tests for optional outPath**

In `tests/unit/parseGenerateArgs.test.ts`, change the defaults case:

```ts
  it("applies defaults from csv path", () => {
    const opts = parseGenerateArgs(["plans/checkout.csv"]);
    expect(opts).toEqual({
      csvPath: "plans/checkout.csv",
      name: "checkout",
      adapters: ["snowplow"],
      outPath: undefined,
      baseUrl: undefined,
      force: false,
    });
  });
```

Remove unused `join` import if no longer needed in that file.

In `tests/unit/parseRecordArgs.test.ts`:

```ts
  it("requires startUrl and applies exploratory defaults", () => {
    const opts = parseRecordArgs(["https://example.com/app"]);
    expect(opts).toEqual({
      startUrl: "https://example.com/app",
      planPath: undefined,
      name: "recorded",
      adapters: ["snowplow"],
      outPath: undefined,
      baseUrl: undefined,
      storageState: undefined,
      overwrite: false,
      force: false,
      allowIncomplete: false,
      includeUnplanned: false,
    });
  });

  it("defaults name from plan basename when --plan is set", () => {
    const opts = parseRecordArgs([
      "https://example.com/",
      "--plan",
      "plans/checkout.csv",
    ]);
    expect(opts.planPath).toBe("plans/checkout.csv");
    expect(opts.name).toBe("checkout");
    expect(opts.outPath).toBeUndefined();
  });
```

- [ ] **Step 6: Run parser tests to verify they fail**

Run: `npm test -- tests/unit/parseGenerateArgs.test.ts tests/unit/parseRecordArgs.test.ts`

Expected: FAIL — `outPath` still set to `journeys/...`

- [ ] **Step 7: Update parsers**

In `src/cli/parseGenerateArgs.ts`:

- Change type: `outPath?: string`
- Remove `join` import if unused
- Return `outPath` (may be `undefined`) instead of `outPath ?? join("journeys", …)`:

```ts
  return {
    csvPath,
    name,
    adapters,
    outPath,
    baseUrl,
    force,
  };
```

In `src/cli/parseRecordArgs.ts`:

- Change type: `outPath?: string`
- Remove `join` import if unused
- Return `outPath` without defaulting to `journeys/`

- [ ] **Step 8: Wire CLI generate/record**

In `src/cli/index.ts`:

1. Import `resolveJourneyOutPath`.
2. In `cmdGenerate`, load config and resolve out path before using it:

```ts
function cmdGenerate(args: string[], cwd: string): number {
  const opts = parseGenerateArgs(args);
  const config = loadConfig(cwd);
  const outPath = resolveJourneyOutPath(
    opts.outPath,
    opts.name,
    config.journeysDir ?? "journeys",
  );
  const csvAbs = resolve(cwd, opts.csvPath);
  // ... unchanged existence checks using outAbs = resolve(cwd, outPath)
  // ... write uses outAbs
  // ... final log uses outPath (relative) for the suggested run command
}
```

3. In `main` record branch, resolve before `cmdRecord`:

```ts
  if (cmd === "record") {
    try {
      const opts = parseRecordArgs(args.slice(1));
      const config = loadConfig(cwd);
      const outPath = resolveJourneyOutPath(
        opts.outPath,
        opts.name,
        config.journeysDir ?? "journeys",
      );
      const code = await cmdRecord({ ...opts, outPath }, cwd, config);
      process.exit(code);
    } catch (err) {
      // unchanged
    }
  }
```

Ensure `cmdRecord` / `runRecord` still receive `outPath: string` (spread after resolve).

- [ ] **Step 9: Run unit tests + typecheck**

Run: `npm run ci`

Expected: PASS (vitest + `tsc`)

- [ ] **Step 10: Commit**

```bash
git add src/cli/resolveJourneyOutPath.ts tests/unit/resolveJourneyOutPath.test.ts src/cli/parseGenerateArgs.ts src/cli/parseRecordArgs.ts src/cli/index.ts tests/unit/parseGenerateArgs.test.ts tests/unit/parseRecordArgs.test.ts
git commit -m "Resolve generate/record out path from journeysDir config."
```

---

### Task 3: Config-aware `init` and help text

**Files:**
- Modify: `src/cli/index.ts` (`cmdInit`, `printHelp`)
- Create: `tests/unit/cmdInitDirs.test.ts`

**Interfaces:**
- Consumes: `loadConfig(cwd)` → `plansDir` / `journeysDir`
- Produces: directories created; new config template includes both keys; help mentions configurable default

- [ ] **Step 1: Write failing init test**

Create `tests/unit/cmdInitDirs.test.ts`. Export `cmdInit` from `src/cli/index.ts` if it is not already exported (add `export` to the function declaration).

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdInit } from "../../src/cli/index.js";

describe("cmdInit", () => {
  it("creates default plans and journeys dirs and seeds config keys", () => {
    const cwd = mkdtempSync(join(tmpdir(), "akela-init-"));
    cmdInit(cwd);
    expect(existsSync(join(cwd, "plans"))).toBe(true);
    expect(existsSync(join(cwd, "journeys"))).toBe(true);
    expect(existsSync(join(cwd, "journeys", "example.yaml"))).toBe(true);
    const cfg = readFileSync(join(cwd, "akela.config.yaml"), "utf8");
    expect(cfg).toMatch(/plansDir:\s*plans/);
    expect(cfg).toMatch(/journeysDir:\s*journeys/);
  });

  it("uses custom dirs from existing config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "akela-init-"));
    writeFileSync(
      join(cwd, "akela.config.yaml"),
      ["plansDir: tracking/plans", "journeysDir: tracking/journeys", "headless: true"].join(
        "\n",
      ),
      "utf8",
    );
    cmdInit(cwd);
    expect(existsSync(join(cwd, "tracking", "plans"))).toBe(true);
    expect(existsSync(join(cwd, "tracking", "journeys", "example.yaml"))).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run init tests to verify they fail**

Run: `npm test -- tests/unit/cmdInitDirs.test.ts`

Expected: FAIL — `plans` not created and/or config keys missing / `cmdInit` not exported

- [ ] **Step 3: Implement `cmdInit` + help**

Refactor `cmdInit(cwd)` roughly as:

```ts
export function cmdInit(cwd: string): void {
  const config = loadConfig(cwd);
  const plansDirRel = config.plansDir ?? "plans";
  const journeysDirRel = config.journeysDir ?? "journeys";
  const plansDir = join(cwd, plansDirRel);
  const journeysDir = join(cwd, journeysDirRel);
  mkdirSync(plansDir, { recursive: true });
  mkdirSync(journeysDir, { recursive: true });

  const configPath = join(cwd, "akela.config.yaml");
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      `# Default config for Akela
baseUrl: http://127.0.0.1:4173
headless: true
reportDir: reports
plansDir: plans
journeysDir: journeys
snowplow:
  collectorPatterns:
    - "/i"
    - "/com.snowplowanalytics.snowplow/tp2"
    - "/snowplow/"
`,
      "utf8",
    );
    console.log(`Created ${configPath}`);
  } else {
    console.log(`Config already exists: ${configPath}`);
  }

  // example.yaml / login.example.yaml under journeysDir (same contents as today)
  // Update embedded usage comments and final console.log paths to use journeysDirRel
}
```

Update `printHelp` generate/record `--out` lines to:

```text
  --out <file>          Output path (default: {journeysDir}/<name>.yaml; config key journeysDir, default journeys)
```

Keep npm script examples on `plans/` + `journeys/`.

Note: importing `cmdInit` from `src/cli/index.ts` in tests may execute `main()` if the CLI entry calls `main()` at module scope. If that is the case, guard the entrypoint:

```ts
const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  main().catch(/* existing handler */);
}
```

(Use the project’s existing pattern if one already exists; only add a guard if tests would otherwise start the CLI.)

- [ ] **Step 4: Run init tests + full CI**

Run: `npm test -- tests/unit/cmdInitDirs.test.ts`

Expected: PASS

Run: `npm run ci`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts tests/unit/cmdInitDirs.test.ts
git commit -m "Make init scaffold plansDir and journeysDir from config."
```

---

### Task 4: Docs, skill, and repo config example

**Files:**
- Modify: `akela.config.yaml`
- Modify: `README.md`
- Modify: `.cursor/skills/analytics-plan-csv/SKILL.md`

**Interfaces:**
- Consumes: config keys from Task 1
- Produces: user-facing documentation of flexible paths + configurable defaults

- [ ] **Step 1: Update repo `akela.config.yaml`**

Add after `reportDir`:

```yaml
plansDir: plans
journeysDir: journeys
```

- [ ] **Step 2: Update README**

After Quick start (or before “Generate a journey…”), add a short section:

```markdown
## Project layout

Plans and journeys can live in any directories. Pass paths explicitly to `validate`, `generate`, `record`, `run`, and `auth`.

Defaults (overridable in `akela.config.yaml`):

| Key | Default | Used for |
|-----|---------|----------|
| `plansDir` | `plans` | Convention / `init` scaffold (not auto-prefixed onto CLI args) |
| `journeysDir` | `journeys` | Default `--out` for `generate` / `record`, and `init` examples |
| `reportDir` | `reports` | HTML/JSON/Markdown reports |

Examples in this repo use `plans/` and `journeys/` for familiarity.
```

In the generate section, replace the defaults sentence:

```markdown
Defaults: journey name from the CSV filename, `adapters: [snowplow]`, output `{journeysDir}/<name>.yaml` (config key `journeysDir`, default `journeys`). Use `--overwrite` to replace an existing file. Pass `--out` to write anywhere.
```

If the record section hardcodes `journeys/` as the only option, add one sentence that `--out` and `journeysDir` control the destination.

- [ ] **Step 3: Update analytics-plan-csv skill**

In `.cursor/skills/analytics-plan-csv/SKILL.md` workflow step 6, change to:

```markdown
6. Write the CSV to the path the user asked for, or under `plans/<short-name>.csv` (or the project's `plansDir` from `akela.config.yaml` if set). Do not invent a nested layout unless they request one.
```

Optionally note in the skill description that output location is flexible.

- [ ] **Step 4: Manual smoke (optional but recommended)**

```bash
npm run track -- generate plans/demo.csv --out tmp-out/demo.yaml --overwrite
```

Expected: writes `tmp-out/demo.yaml` (delete afterward; do not commit).

- [ ] **Step 5: Commit**

```bash
git add akela.config.yaml README.md .cursor/skills/analytics-plan-csv/SKILL.md
git commit -m "Document flexible plan/journey paths and config dirs."
```

Note: `.cursor/` is gitignored in this repo. If `git add` skips the skill file, either `git add -f .cursor/skills/analytics-plan-csv/SKILL.md` or skip committing the skill and leave it as a local-only update — prefer `-f` so the skill stays in sync with the product.

---

## Spec coverage checklist (self-review)

| Spec requirement | Task |
|------------------|------|
| Explicit paths remain source of truth | Task 2 ( `--out` precedence ), Task 4 docs |
| Default out = `{journeysDir}/{name}.yaml` | Task 2 |
| `plansDir` / `journeysDir` config + defaults | Task 1 |
| Empty strings rejected | Task 1 |
| Parsers do not hardcode `journeys/` | Task 2 |
| Resolve after `loadConfig` | Task 2 |
| `init` creates both dirs + seeds config | Task 3 |
| Help text mentions configurable default | Task 3 |
| README project layout + generate wording | Task 4 |
| analytics-plan-csv skill allows any path | Task 4 |
| No auto-prefix / mirroring / bare names | Global constraints (no tasks add these) |
| loadConfig + out-path tests | Tasks 1–2 |
| Optional init dir test | Task 3 |

## Placeholder / consistency notes

- Helper name is consistently `resolveJourneyOutPath`.
- Config keys are consistently `plansDir` / `journeysDir`.
- Parser `outPath` is optional until CLI resolution; `runRecord` still receives `string`.
