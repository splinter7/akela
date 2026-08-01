# Journey Auth via storageState Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add journey-defined auth: a `saveStorageState` step plus `track auth` CLI that writes Playwright storage state for tracking journeys to consume.

**Architecture:** Auth is a normal journey (site-specific login steps). The engine adds one step (`saveStorageState`) and an auth load/run path that skips capture/verify, defaults to headed, and requires ≥1 save step + empty `expect`. Tracking `run` stays unchanged aside from supporting the new step.

**Tech Stack:** TypeScript, Zod, Playwright, Vitest, existing CLI (`tsx src/cli/index.ts`)

**Spec:** [`docs/superpowers/specs/2026-07-19-journey-auth-storage-state-design.md`](../specs/2026-07-19-journey-auth-storage-state-design.md)

## Global Constraints

- No named auth presets in the engine — login flows live in journey YAML only
- Credentials via `--var` substitution only (never committed secrets)
- `.auth/` remains gitignored
- Tracking `run` keeps `expect.min(1)`; only auth mode allows empty `expect`
- Auth mode: no network capture, no event verification, no HTML reports by default
- `adapters` stay required on auth journeys (ignored at runtime)
- Prefer `page.context().storageState({ path })` — do not thread `BrowserContext` through every step API unless needed
- TDD each task; `npm run ci` is the gate
- Do not commit unless the user explicitly asks (plan commit steps are optional checkpoints)

## File map

| File | Role |
|------|------|
| `src/normalize/types.ts` | Add `saveStorageState` to `Step`; extend `StepRuntimeOptions` with `cwd` |
| `src/journey/journeySchema.ts` | Add step schema; export `authJourneySchema` (empty expect + ≥1 save) |
| `src/journey/loadJourney.ts` | `loadJourney(path, cwd, vars, { mode?: "run" \| "auth" })` |
| `src/runner/steps.ts` | Implement `saveStorageState`; update `stepDetail` |
| `src/runner/JourneyRunner.ts` | Add `runAuthJourneyWithConfig` (+ `AuthRunResult`) |
| `src/cli/parseAuthArgs.ts` | Parse auth CLI args (`--var`, `--headed`/`--headless`) |
| `src/cli/index.ts` | Wire `auth` command; update help + `init` example |
| `journeys/login.example.yaml` | Scaffold example auth journey |
| `README.md` | Two-step staging auth flow |
| `tests/unit/loadJourney.test.ts` | Auth vs run schema tests |
| `tests/unit/steps.saveStorageState.test.ts` | Step writes file |
| `tests/unit/authRunner.test.ts` | Auth runner behavior |
| `tests/unit/parseAuthArgs.test.ts` | CLI arg parsing |

---

### Task 1: Schema + loadJourney auth mode

**Files:**
- Modify: `src/normalize/types.ts`
- Modify: `src/journey/journeySchema.ts`
- Modify: `src/journey/loadJourney.ts`
- Test: `tests/unit/loadJourney.test.ts`

**Interfaces:**
- Consumes: existing `journeySchema`, `loadJourney`, `Step` union
- Produces:
  - `Step` includes `{ action: "saveStorageState"; path: string; when?: StepWhen }`
  - `export const authJourneySchema` — same as journey but `expect` default/`min(0)`, and superRefine requiring ≥1 `saveStorageState`
  - `loadJourney(filePath, cwd?, vars?, options?: { mode?: "run" | "auth" }): Journey` — default `mode: "run"`

- [ ] **Step 1: Write failing tests**

Add to `tests/unit/loadJourney.test.ts`:

```ts
it("run mode rejects empty expect", () => {
  const path = writeJourney(
    "empty-expect.yaml",
    `name: bad
adapters:
  - snowplow
steps:
  - action: goto
    path: /
expect: []
`,
  );
  expect(() => loadJourney(path)).toThrow(/expect/i);
});

it("auth mode accepts empty expect with saveStorageState", () => {
  const path = writeJourney(
    "auth-ok.yaml",
    `name: login
adapters:
  - snowplow
expect: []
steps:
  - action: goto
    path: /login
  - action: saveStorageState
    path: .auth/storage-state.json
`,
  );
  const journey = loadJourney(path, dir, {}, { mode: "auth" });
  expect(journey.expect).toEqual([]);
  expect(journey.steps.some((s) => s.action === "saveStorageState")).toBe(true);
});

it("auth mode rejects journey without saveStorageState", () => {
  const path = writeJourney(
    "auth-no-save.yaml",
    `name: login
adapters:
  - snowplow
expect: []
steps:
  - action: goto
    path: /login
`,
  );
  expect(() => loadJourney(path, dir, {}, { mode: "auth" })).toThrow(
    /saveStorageState/i,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/loadJourney.test.ts -t "auth mode|empty expect"`

Expected: FAIL (unknown action / mode option not accepted)

- [ ] **Step 3: Implement schema + loadJourney**

In `types.ts`, add to `Step` union:

```ts
| (StepBase & { action: "saveStorageState"; path: string })
```

In `journeySchema.ts`, add to `stepSchema` discriminated union:

```ts
z.object({
  action: z.literal("saveStorageState"),
  path: z.string().min(1),
  when: whenSchema,
}),
```

Export `authJourneySchema`:

```ts
export const authJourneySchema = journeySchema
  .safeExtend({
    expect: z.array(expectedEventSchema).default([]),
  })
  .superRefine((journey, ctx) => {
    const hasSave = journey.steps.some((s) => s.action === "saveStorageState");
    if (!hasSave) {
      ctx.addIssue({
        code: "custom",
        message: "auth journey requires at least one saveStorageState step",
        path: ["steps"],
      });
    }
  });
```

(If Zod 4 `safeExtend` is unavailable, use `.extend({ expect: z.array(expectedEventSchema) })` and omit `.min(1)` — empty array allowed. Prefer checking how `journeySchema` is built and mirror it.)

Update `loadJourney`:

```ts
export type LoadJourneyOptions = { mode?: "run" | "auth" };

export function loadJourney(
  filePath: string,
  cwd = process.cwd(),
  vars: Record<string, string> = {},
  options: LoadJourneyOptions = {},
): Journey {
  // ... read + substituteVars + parse yaml/json ...
  const mode = options.mode ?? "run";
  const schema = mode === "auth" ? authJourneySchema : journeySchema;
  const parsed = schema.safeParse(data);
  // ... same error formatting ...
  return parsed.data as Journey;
}
```

Keep `journeySchema.expect` as `.min(1)` for run mode.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/loadJourney.test.ts`

Expected: PASS (all existing + new)

- [ ] **Step 5: Commit (optional — only if user asked)**

```bash
git add src/normalize/types.ts src/journey/journeySchema.ts src/journey/loadJourney.ts tests/unit/loadJourney.test.ts
git commit -m "$(cat <<'EOF'
feat: support auth journey schema with saveStorageState

EOF
)"
```

---

### Task 2: `saveStorageState` step execution

**Files:**
- Modify: `src/normalize/types.ts` (`StepRuntimeOptions.cwd`)
- Modify: `src/runner/steps.ts`
- Create: `tests/unit/steps.saveStorageState.test.ts`

**Interfaces:**
- Consumes: `Step` with `saveStorageState`; Playwright `page.context().storageState`
- Produces: `executeStep` writes JSON to `resolve(cwd, step.path)` and returns `{ status: "ran" }`; `stepDetail` returns the path

- [ ] **Step 1: Write failing test**

Create `tests/unit/steps.saveStorageState.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { executeStep } from "../../src/runner/steps.js";
import type { NetworkCapture } from "../../src/capture/NetworkCapture.js";

describe("saveStorageState step", () => {
  it("writes storage state relative to cwd", async () => {
    const cwd = join(tmpdir(), `at-save-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    const outRel = ".auth/state.json";
    const outAbs = join(cwd, outRel);

    const storageState = vi.fn(async ({ path }: { path: string }) => {
      mkdirSync(join(path, ".."), { recursive: true });
      // Playwright writes the file; simulate that:
      const { writeFileSync, mkdirSync: mk } = await import("node:fs");
      const { dirname } = await import("node:path");
      mk(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ cookies: [], origins: [] }), "utf8");
    });

    const page = {
      context: () => ({ storageState }),
    } as unknown as import("playwright").Page;

    const capture = { getEvents: () => [] } as unknown as NetworkCapture;

    const result = await executeStep(
      page,
      { action: "saveStorageState", path: outRel },
      "http://example.com",
      capture,
      "partial",
      { gotoWaitUntil: "domcontentloaded", cwd },
    );

    expect(result.status).toBe("ran");
    expect(storageState).toHaveBeenCalledWith({ path: outAbs });
    expect(existsSync(outAbs)).toBe(true);
    expect(JSON.parse(readFileSync(outAbs, "utf8"))).toEqual({
      cookies: [],
      origins: [],
    });
  });
});
```

Simplify the mock if preferred: have `storageState` mock call `writeFileSync` itself without dynamic import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/steps.saveStorageState.test.ts`

Expected: FAIL (exhaustive switch / unknown action)

- [ ] **Step 3: Implement step**

Extend `StepRuntimeOptions`:

```ts
export type StepRuntimeOptions = {
  gotoWaitUntil: GotoWaitUntil;
  onProgress?: ProgressFn;
  eventSinceIndex?: number;
  /** Base directory for resolving saveStorageState paths. Default process.cwd(). */
  cwd?: string;
};
```

In `stepDetail`:

```ts
case "saveStorageState":
  return step.path;
```

In `executeStep` switch:

```ts
case "saveStorageState": {
  const { mkdirSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const cwd = runtime.cwd ?? process.cwd();
  const abs = resolve(cwd, step.path);
  mkdirSync(dirname(abs), { recursive: true });
  await page.context().storageState({ path: abs });
  runtime.onProgress?.(`  wrote storageState: ${abs}`);
  return { status: "ran" };
}
```

Prefer static imports at top of `steps.ts` (`mkdirSync`, `dirname`, `resolve`) to match the rest of the codebase — do not use dynamic import in production code.

Also pass `cwd` from `JourneyRunner` into `executeStep` runtime (Task 3 wires auth; for Task 2, update existing `runJourneyWithConfig` loop to pass `cwd` so `run` can use the step too).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/steps.saveStorageState.test.ts`

Expected: PASS

- [ ] **Step 5: Commit (optional)**

```bash
git add src/normalize/types.ts src/runner/steps.ts src/runner/JourneyRunner.ts tests/unit/steps.saveStorageState.test.ts
git commit -m "$(cat <<'EOF'
feat: add saveStorageState journey step

EOF
)"
```

---

### Task 3: Auth runner

**Files:**
- Modify: `src/runner/JourneyRunner.ts`
- Create: `tests/unit/authRunner.test.ts`

**Interfaces:**
- Consumes: `Journey`, `AppConfig`, `executeStep`, Playwright chromium
- Produces:

```ts
export type AuthRunResult = {
  journeyName: string;
  baseUrl: string;
  durationMs: number;
  pass: boolean;
  error?: string;
  storageStatePaths: string[];
  stepLog: StepLogEntry[];
};

export type AuthJourneyOptions = {
  onProgress?: ProgressFn;
  /** Override headless; auth CLI defaults this to false (headed). */
  headless?: boolean;
};

export async function runAuthJourneyWithConfig(
  journey: Journey,
  config: AppConfig,
  cwd?: string,
  options?: AuthJourneyOptions,
): Promise<AuthRunResult>;
```

Behavior:
- Launch chromium with `headless: options.headless ?? false`
- `newContext()` with **no** input `storageState` (fresh login)
- Do **not** create/attach `NetworkCapture`
- Execute steps via `executeStep` — for capture arg, pass a tiny stub `{ getEvents: () => [] } as NetworkCapture` OR refactor `executeStep` so `capture` is optional and `waitForEvent` throws `"waitForEvent requires network capture"` if missing (prefer optional capture — cleaner)
- Collect paths from every successful `saveStorageState` step into `storageStatePaths`
- No quiet drain, no `verifyEvents`
- `pass = !error && storageStatePaths.length > 0`
- On step failure: best-effort screenshot optional (YAGNI — skip unless cheap); set `error`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/authRunner.test.ts` with Playwright mocked like `tests/unit/journeyRunner.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const storageStateFn = vi.fn(async ({ path }: { path: string }) => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ cookies: [], origins: [] }), "utf8");
});

const mockPage = {
  goto: vi.fn(async () => {}),
  context: () => ({ storageState: storageStateFn }),
  screenshot: vi.fn(async () => Buffer.from("x")),
};
const mockContext = { newPage: vi.fn(async () => mockPage) };
const mockBrowser = {
  newContext: vi.fn(async () => mockContext),
  close: vi.fn(async () => {}),
};

vi.mock("playwright", () => ({
  chromium: { launch: vi.fn(async () => mockBrowser) },
}));

import { runAuthJourneyWithConfig } from "../../src/runner/JourneyRunner.js";
import type { Journey, AppConfig } from "../../src/normalize/types.js";

const config: AppConfig = { headless: true, baseUrl: "http://example.com" };

function authJourney(over: Partial<Journey> = {}): Journey {
  return {
    name: "login",
    adapters: ["snowplow"],
    expect: [],
    steps: [
      { action: "goto", path: "/login" },
      { action: "saveStorageState", path: ".auth/out.json" },
    ],
    ...over,
  };
}

describe("runAuthJourneyWithConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes storage state and passes without verification", async () => {
    const cwd = join(tmpdir(), `at-auth-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    const result = await runAuthJourneyWithConfig(
      authJourney(),
      config,
      cwd,
      { headless: true },
    );
    expect(result.pass).toBe(true);
    expect(result.storageStatePaths[0]).toBe(join(cwd, ".auth/out.json"));
    expect(existsSync(result.storageStatePaths[0]!)).toBe(true);
    expect(mockBrowser.newContext).toHaveBeenCalledWith({});
  });

  it("defaults to headed when headless option omitted", async () => {
    const { chromium } = await import("playwright");
    await runAuthJourneyWithConfig(authJourney(), config, process.cwd(), {});
    expect(chromium.launch).toHaveBeenCalledWith({ headless: false });
  });

  it("fails when saveStorageState never runs (all steps skipped)", async () => {
    // Force goto to throw so save never runs:
    mockPage.goto.mockRejectedValueOnce(new Error("nav failed"));
    const result = await runAuthJourneyWithConfig(
      authJourney(),
      config,
      process.cwd(),
      { headless: true },
    );
    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/nav failed/);
    expect(result.storageStatePaths).toEqual([]);
  });
});
```

Adjust mocks to match existing `journeyRunner.test.ts` style if imports order differs.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/authRunner.test.ts`

Expected: FAIL (`runAuthJourneyWithConfig` not exported)

- [ ] **Step 3: Implement `runAuthJourneyWithConfig`**

In `JourneyRunner.ts`:

1. Make `executeStep`'s `capture` parameter `NetworkCapture | undefined` if not done in Task 2; `waitForEvent` throws if `!capture`.
2. Add `runAuthJourneyWithConfig` as specified.
3. Ensure existing `runJourneyWithConfig` still passes real capture and now passes `cwd` in runtime options.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/authRunner.test.ts tests/unit/journeyRunner.test.ts`

Expected: PASS

- [ ] **Step 5: Commit (optional)**

```bash
git add src/runner/JourneyRunner.ts src/runner/steps.ts tests/unit/authRunner.test.ts
git commit -m "$(cat <<'EOF'
feat: add runAuthJourneyWithConfig for headed login journeys

EOF
)"
```

---

### Task 4: CLI `auth` command

**Files:**
- Create: `src/cli/parseAuthArgs.ts`
- Create: `tests/unit/parseAuthArgs.test.ts`
- Modify: `src/cli/index.ts`

**Interfaces:**
- Consumes: `parseAuthArgs`, `loadJourney(..., { mode: "auth" })`, `runAuthJourneyWithConfig`
- Produces:

```ts
export type AuthCliOptions = {
  journeyPath: string;
  vars: Record<string, string>;
  /** undefined = default headed (false headless) */
  headless?: boolean;
};

export function parseAuthArgs(args: string[]): AuthCliOptions;
```

CLI usage:

```
analytics-tracker auth <journey.yaml|json> [--var name=value ...] [--headed|--headless]
```

- Default: headed (`headless: false` passed to runner)
- `--headed` → `headless: false`
- `--headless` → `headless: true`
- Last flag wins if both passed
- Reuse `--var` parsing logic from `parseRunArgs` (extract shared helper in `parseRunArgs.ts` or duplicate minimally — prefer small shared `parseVarFlags` if touch is tiny)

`cmdAuth`:
1. `loadConfig`
2. `loadJourney(path, cwd, vars, { mode: "auth" })`
3. `runAuthJourneyWithConfig(journey, config, cwd, { headless: opts.headless ?? false, onProgress })`
4. Print PASS/FAIL, `storageStatePaths`, error
5. **No** `writeReports`
6. Exit 0/1

- [ ] **Step 1: Write failing parse tests**

```ts
// tests/unit/parseAuthArgs.test.ts
import { describe, it, expect } from "vitest";
import { parseAuthArgs } from "../../src/cli/parseAuthArgs.js";

describe("parseAuthArgs", () => {
  it("parses journey and vars", () => {
    expect(
      parseAuthArgs([
        "journeys/login.yaml",
        "--var",
        "AUTH_EMAIL=a@b.com",
        "--var=AUTH_PASSWORD=secret",
      ]),
    ).toEqual({
      journeyPath: "journeys/login.yaml",
      vars: { AUTH_EMAIL: "a@b.com", AUTH_PASSWORD: "secret" },
      headless: undefined,
    });
  });

  it("honors --headless", () => {
    expect(parseAuthArgs(["j.yaml", "--headless"]).headless).toBe(true);
  });

  it("honors --headed", () => {
    expect(parseAuthArgs(["j.yaml", "--headed"]).headless).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/parseAuthArgs.test.ts`

Expected: FAIL (module missing)

- [ ] **Step 3: Implement parseAuthArgs + wire CLI**

Implement `parseAuthArgs.ts`. Update `printHelp` and `main()` in `index.ts` for `auth`. Update `cmdInit` to write `journeys/login.example.yaml` (content in Task 5 — can write file here).

- [ ] **Step 4: Run unit tests + tsc**

Run: `npm run ci`

Expected: PASS

- [ ] **Step 5: Commit (optional)**

```bash
git add src/cli/parseAuthArgs.ts src/cli/index.ts tests/unit/parseAuthArgs.test.ts
git commit -m "$(cat <<'EOF'
feat: add track auth CLI command

EOF
)"
```

---

### Task 5: Docs + example journey

**Files:**
- Create: `journeys/login.example.yaml`
- Modify: `README.md` (staging section ~lines 26–40)
- Modify: `src/cli/index.ts` (`cmdInit` + help text if not done)
- Modify: `docs/superpowers/specs/2026-07-19-journey-auth-storage-state-design.md` — keep Status: Approved

**Interfaces:**
- Consumes: none (docs/examples only)
- Produces: documented two-step flow; example auth YAML with placeholders

- [ ] **Step 1: Add example auth journey**

`journeys/login.example.yaml`:

```yaml
# Example auth journey — copy and fill real selectors for your site.
# Usage:
#   npm run track -- auth journeys/login.example.yaml \
#     --var AUTH_EMAIL=you@example.com \
#     --var AUTH_PASSWORD=secret
# Then point tracking journeys at the written storageState path.

name: login-example
baseUrl: https://staging.example.com
adapters:
  - snowplow
expect: []
steps:
  - action: goto
    path: /login
  - action: fill
    selector: "#TODO-email"
    value: "${AUTH_EMAIL}"
  - action: fill
    selector: "#TODO-password"
    value: "${AUTH_PASSWORD}"
  - action: click
    selector: "#TODO-login-submit"
  - action: waitForSelector
    selector: "#TODO-logged-in-marker"
  - action: saveStorageState
    path: .auth/storage-state.json
```

- [ ] **Step 2: Update README staging section**

Replace the manual “create Playwright storage state” bullet with:

1. Copy/adapt `journeys/login.example.yaml` for your login flow.
2. `npm run track -- auth journeys/login.yaml --var AUTH_EMAIL=… --var AUTH_PASSWORD=…` (headed by default).
3. Point tracking journey `storageState` at the printed path.
4. `npm run track -- run journeys/….yaml`

Keep “do not commit `.auth/`” note.

- [ ] **Step 3: Ensure init scaffolds the example**

In `cmdInit`, if `journeys/login.example.yaml` missing, write the same content.

- [ ] **Step 4: Run full CI**

Run: `npm run ci`

Expected: PASS

- [ ] **Step 5: Commit (optional)**

```bash
git add journeys/login.example.yaml README.md src/cli/index.ts docs/superpowers/specs/2026-07-19-journey-auth-storage-state-design.md docs/superpowers/plans/2026-07-19-journey-auth-storage-state.md
git commit -m "$(cat <<'EOF'
docs: document journey auth flow and example login journey

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `saveStorageState` step | 1–2 |
| Auth journey empty `expect` + ≥1 save | 1 |
| Tracking `expect.min(1)` unchanged | 1 |
| `track auth` CLI, headed default | 4 |
| `--headed` / `--headless` | 4 |
| No capture / no verify / no reports in auth | 3–4 |
| Print absolute path written | 3–4 |
| `saveStorageState` works under `run` | 2 (cwd passed from runner) |
| README + init example | 5 |
| Unit tests for save / auth reject / empty expect / run min expect | 1–3 |
| No presets / no mid-run re-auth / no CI secrets | out of scope (no tasks) |

## Plan self-review

- No TBD/placeholder steps
- Types aligned: `AuthRunResult.storageStatePaths`, `LoadJourneyOptions.mode`, `AuthCliOptions.headless`
- Zod 4: implementer should use the project’s existing Zod patterns if `safeExtend` differs — fall back to `.extend` + drop `.min(1)` on auth expect only
