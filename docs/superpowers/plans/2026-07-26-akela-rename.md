# Akela Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename all product references from Telvara / Analytics Tracker / analytics-tracker to Akela / akela (package, CLI, config, branding, and recorder bindings).

**Architecture:** Direct string/filename cutover with no dual binaries and no config fallback. Config resolves only `akela.config.yaml`. Recorder window bindings become `__akela*`. The npm script name `track` stays.

**Tech Stack:** TypeScript, Vitest, Node `fs`/`path`, existing CLI via `tsx`

**Spec:** [`docs/superpowers/specs/2026-07-26-akela-rename-design.md`](../specs/2026-07-26-akela-rename-design.md)

## Global Constraints

- Display name is exactly `Akela` (not "Akela Tracker")
- npm `name` and CLI `bin` key are exactly `akela`
- Config filename is exactly `akela.config.yaml` — no read/fallback for `analytics-tracker.config.yaml`
- Binding renames: `__analyticsTrackerRecord` → `__akelaRecord`; `__analyticsTrackerRecorderInstalled` → `__akelaRecorderInstalled`; `__analyticsTrackerRecorderFlushScroll` → `__akelaRecorderFlushScroll`
- Do not rename the npm script `track`
- Do not rename the local checkout folder `AnalyticsTracker`
- Do not rewrite git history
- Mentions of old names inside `docs/superpowers/` are allowed; everywhere else (src, tests, README, LICENSE, demo, package files, root config) must be clean
- Do not commit unless the user explicitly asks (plan commit steps are optional checkpoints)
- TDD each task; `npm run ci` is the final gate

## File map

| File | Role |
|------|------|
| `package.json` / `package-lock.json` | Package name + `bin.akela` |
| `analytics-tracker.config.yaml` → `akela.config.yaml` | Root default config |
| `src/config/loadConfig.ts` | Load only `akela.config.yaml` |
| `src/cli/index.ts` | Help, `init` scaffold path, validate usage |
| `src/cli/parse*.ts` | Usage error strings |
| `src/report/writeReports.ts` | HTML report `<title>` |
| `src/record/RecorderSession.ts` | `__akela*` bindings |
| `demo/index.html` | Demo page branding |
| `README.md` / `LICENSE` | Title + copyright |
| `tests/unit/loadConfig.test.ts` | Config filename fixtures |
| `tests/unit/parseRunArgs.test.ts` | Usage regex |
| `tests/unit/parseExplainArgs.test.ts` | Usage regex |
| `tests/unit/journeyRunner.test.ts` | Temp cwd prefix |

---

### Task 1: Config filename + `loadConfig`

**Files:**
- Modify: `tests/unit/loadConfig.test.ts`
- Modify: `src/config/loadConfig.ts`
- Rename: `analytics-tracker.config.yaml` → `akela.config.yaml`

**Interfaces:**
- Consumes: none
- Produces: `loadConfig(cwd?)` reads `akela.config.yaml` only; invalid-config errors say `Invalid akela.config.yaml:`

- [ ] **Step 1: Update failing tests for the new config filename**

In `tests/unit/loadConfig.test.ts`, change `writeConfig` to write `akela.config.yaml`:

```ts
function writeConfig(cwd: string, yaml: string): void {
  writeFileSync(join(cwd, "akela.config.yaml"), yaml, "utf8");
}
```

Add this test at the end of the `describe("loadConfig")` block:

```ts
  it("ignores legacy analytics-tracker.config.yaml", () => {
    const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
    writeFileSync(
      join(cwd, "analytics-tracker.config.yaml"),
      "headless: false\n",
      "utf8",
    );
    const cfg = loadConfig(cwd);
    expect(cfg.headless).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/loadConfig.test.ts`

Expected: FAIL — fixtures write `akela.config.yaml` but implementation still reads `analytics-tracker.config.yaml` (defaults / missing overrides); or error text still says old filename.

- [ ] **Step 3: Implement config load cutover**

In `src/config/loadConfig.ts`, change both string literals:

```ts
export function loadConfig(cwd = process.cwd()): AppConfigSchema {
  const path = resolve(cwd, "akela.config.yaml");
  // ... unchanged until error:
  if (!parsed.success) {
    throw new Error(
      `Invalid akela.config.yaml:\n${formatZodConfigErrors(parsed.error)}`,
    );
  }
  return parsed.data;
}
```

Rename the root config file and update its header:

```bash
git mv analytics-tracker.config.yaml akela.config.yaml
```

Set `akela.config.yaml` contents to:

```yaml
# Default config for Akela
baseUrl: http://127.0.0.1:4173
headless: true
reportDir: reports
snowplow:
  collectorPatterns:
    - "/i"
    - "/com.snowplowanalytics.snowplow/tp2"
    - "/snowplow/"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/loadConfig.test.ts`

Expected: PASS (all tests green)

- [ ] **Step 5: Commit (optional — only if user asked)**

```bash
git add src/config/loadConfig.ts tests/unit/loadConfig.test.ts akela.config.yaml
git add -u analytics-tracker.config.yaml
git commit -m "Rename config file and loader to akela.config.yaml"
```

---

### Task 2: Package identity + LICENSE

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `LICENSE`

**Interfaces:**
- Consumes: none
- Produces: npm package/bin name `akela`; LICENSE copyright `Akela contributors`

- [ ] **Step 1: Update `package.json`**

Replace name and bin key:

```json
{
  "name": "akela",
  "version": "0.1.0",
  "description": "Browser analytics event verification via Playwright journeys",
  "type": "module",
  "bin": {
    "akela": "./dist/cli/index.js"
  }
}
```

Leave `"track": "tsx src/cli/index.ts"` unchanged.

- [ ] **Step 2: Sync lockfile name fields**

In `package-lock.json`, set every `"name": "analytics-tracker"` to `"akela"`, and change the `bin` entry from `"analytics-tracker"` to `"akela"` (same `dist/cli/index.js` target). Prefer:

```bash
npm install --package-lock-only
```

Expected: lockfile `name` / packages[""].name / bin match `akela`.

- [ ] **Step 3: Update LICENSE**

Change line 3 from:

```text
Copyright (c) 2026 Telvara contributors
```

to:

```text
Copyright (c) 2026 Akela contributors
```

- [ ] **Step 4: Sanity-check package metadata**

Run: `node -e "const p=require('./package.json'); if(p.name!=='akela'||!p.bin.akela||p.bin['analytics-tracker']) process.exit(1)"`

Expected: exit 0

- [ ] **Step 5: Commit (optional — only if user asked)**

```bash
git add package.json package-lock.json LICENSE
git commit -m "Rename npm package and CLI bin to akela"
```

---

### Task 3: CLI usage strings + parse-arg tests

**Files:**
- Modify: `src/cli/parseRunArgs.ts`
- Modify: `src/cli/parseAuthArgs.ts`
- Modify: `src/cli/parseExplainArgs.ts`
- Modify: `src/cli/parseGenerateArgs.ts`
- Modify: `src/cli/parseRecordArgs.ts`
- Modify: `src/cli/index.ts` (validate usage only in this task)
- Modify: `tests/unit/parseRunArgs.test.ts`
- Modify: `tests/unit/parseExplainArgs.test.ts`
- Modify: `tests/unit/journeyRunner.test.ts`

**Interfaces:**
- Consumes: none
- Produces: all thrown/printed usage strings start with `Usage: akela …`

- [ ] **Step 1: Update failing parse-arg tests**

In `tests/unit/parseRunArgs.test.ts`:

```ts
  it("requires journey path", () => {
    expect(() => parseRunArgs([])).toThrow(/Usage: akela run/);
    expect(() => parseRunArgs(["--var", "a=1"])).toThrow(
      /Usage: akela run/,
    );
  });
```

In `tests/unit/parseExplainArgs.test.ts`:

```ts
  it("rejects missing path", () => {
    expect(() => parseExplainArgs([])).toThrow(
      /Usage: akela explain/,
    );
  });
```

In `tests/unit/journeyRunner.test.ts`, rename the temp prefix only:

```ts
const cwd = join(tmpdir(), `akela-cwd-${Date.now()}`);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/parseRunArgs.test.ts tests/unit/parseExplainArgs.test.ts`

Expected: FAIL — usage strings still say `analytics-tracker`

- [ ] **Step 3: Replace usage strings in parse helpers + validate**

Exact replacements (full string each):

`src/cli/parseRunArgs.ts`:

```ts
"Usage: akela run <journey.yaml|json> [--var name=value ...]",
```

`src/cli/parseAuthArgs.ts`:

```ts
"Usage: akela auth <journey.yaml|json> [--var name=value ...] [--headed|--headless]",
```

`src/cli/parseExplainArgs.ts`:

```ts
"Usage: akela explain <reportDir|report.json> [--json] [--verbose]";
```

`src/cli/parseGenerateArgs.ts`:

```ts
"Usage: akela generate <plan.csv> [--name <name>] [--adapters a,b] [--out <file>] [--base-url <url>] [--overwrite]",
```

`src/cli/parseRecordArgs.ts`:

```ts
"Usage: akela record <startUrl> [--plan <plan.csv>] [--name <name>] [--adapters a,b] [--out <file>] [--base-url <url>] [--storage-state <file>] [--overwrite] [--force] [--allow-incomplete] [--include-unplanned]",
```

In `src/cli/index.ts` (validate path only):

```ts
console.error("Usage: akela validate <plan.csv>");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/parseRunArgs.test.ts tests/unit/parseExplainArgs.test.ts tests/unit/parseRecordArgs.test.ts tests/unit/journeyRunner.test.ts`

Expected: PASS

- [ ] **Step 5: Commit (optional — only if user asked)**

```bash
git add src/cli/parseRunArgs.ts src/cli/parseAuthArgs.ts src/cli/parseExplainArgs.ts src/cli/parseGenerateArgs.ts src/cli/parseRecordArgs.ts src/cli/index.ts tests/unit/parseRunArgs.test.ts tests/unit/parseExplainArgs.test.ts tests/unit/journeyRunner.test.ts
git commit -m "Update CLI usage strings to akela"
```

---

### Task 4: Help, init scaffold, reports, demo, README

**Files:**
- Modify: `src/cli/index.ts` (`printHelp`, `cmdInit`)
- Modify: `src/report/writeReports.ts`
- Modify: `demo/index.html`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1 config filename `akela.config.yaml`
- Produces: user-facing copy says `Akela` / `akela`; `init` writes `akela.config.yaml`

- [ ] **Step 1: Update `printHelp` and `cmdInit` in `src/cli/index.ts`**

Replace the help banner + usage lines with:

```ts
function printHelp(): void {
  console.log(`Akela — verify analytics events in the browser

Usage:
  akela init
  akela validate <plan.csv>
  akela generate <plan.csv> [options]
  akela record <startUrl> [options]
  akela run <journey.yaml|json> [--var name=value ...]
  akela auth <journey.yaml|json> [--var name=value ...] [--headed|--headless]
  akela explain <reportDir|report.json> [--json] [--verbose]
  akela help
```

(Keep the rest of the help body unchanged, including `npm run track -- …` examples.)

In `cmdInit`:

```ts
  const configPath = join(cwd, "akela.config.yaml");
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      `# Default config for Akela
baseUrl: http://127.0.0.1:4173
headless: true
reportDir: reports
snowplow:
  collectorPatterns:
    - "/i"
    - "/com.snowplowanalytics.snowplow/tp2"
    - "/snowplow/"
`,
      "utf8",
    );
```

- [ ] **Step 2: Update report HTML title**

In `src/report/writeReports.ts`:

```ts
  <title>Akela — ${escapeHtml(result.journeyName)}</title>
```

- [ ] **Step 3: Update demo branding**

In `demo/index.html`:

```html
  <title>Akela Demo</title>
```

```html
    <h1>Akela</h1>
```

- [ ] **Step 4: Update README title**

In `README.md` line 1:

```markdown
# Akela
```

Leave body examples that use `npm run track` unchanged.

- [ ] **Step 5: Smoke help**

Run: `npm run track -- help`

Expected: stdout starts with `Akela — verify analytics events in the browser` and usage lines use `akela init` / `akela run` (etc.). No unit test currently asserts the HTML `<title>` string.

- [ ] **Step 6: Commit (optional — only if user asked)**

```bash
git add src/cli/index.ts src/report/writeReports.ts demo/index.html README.md
git commit -m "Rebrand CLI help, reports, and demo to Akela"
```

---

### Task 5: Recorder window bindings

**Files:**
- Modify: `src/record/RecorderSession.ts`

**Interfaces:**
- Consumes: none
- Produces: `BINDING_NAME = "__akelaRecord"`; init script and `stop()` flush use `__akelaRecorderInstalled` / `__akelaRecorderFlushScroll`

- [ ] **Step 1: Rename binding constants and window properties**

In `src/record/RecorderSession.ts`, apply these exact renames (all occurrences in the file, including inside the `recorderInitScriptSource` template string):

```ts
const BINDING_NAME = "__akelaRecord";
```

Inside the init-script string:

```js
  if (w.__akelaRecorderInstalled) return;
  // ...
  w.__akelaRecorderFlushScroll = flushPendingScrolls;
  w.__akelaRecorderInstalled = true;
```

In `stop()`:

```ts
      await this.page?.evaluate(() => {
        const flush = (window as unknown as {
          __akelaRecorderFlushScroll?: () => void;
        }).__akelaRecorderFlushScroll;
        flush?.();
      });
```

Do **not** leave aliases for `__analyticsTracker*`.

- [ ] **Step 2: Run recorder tests**

Run: `npx vitest run tests/unit/recorderSession.test.ts tests/unit/runRecord.test.ts tests/unit/parseRecordArgs.test.ts`

Expected: PASS

- [ ] **Step 3: Grep for leftover binding names**

Run (PowerShell):

```powershell
rg "__analyticsTracker" src tests
```

Expected: no matches

- [ ] **Step 4: Commit (optional — only if user asked)**

```bash
git add src/record/RecorderSession.ts
git commit -m "Rename recorder window bindings to __akela*"
```

---

### Task 6: Full-repo verification

**Files:**
- None new (verification only); fix any stragglers found by grep

- [ ] **Step 1: Grep for banned product strings**

Run from repo root (PowerShell):

```powershell
rg -i "telvara|analytics-tracker|Analytics Tracker|__analyticsTracker" --glob "!docs/superpowers/**" --glob "!node_modules/**" --glob "!dist/**"
```

Expected: zero matches in src, tests, README, LICENSE, demo, package files, root config

- [ ] **Step 2: Run full CI**

Run: `npm run ci`

Expected: Vitest + `tsc` both exit 0

- [ ] **Step 3: Final smoke**

Run: `npm run track -- help`

Expected: banner `Akela — verify analytics events in the browser` and usage lines prefixed with `akela`

- [ ] **Step 4: Commit (optional — only if user asked)**

If Task 6 required leftover fixes:

```bash
git add -A
git commit -m "Finish Akela rename verification cleanup"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Package / bin → `akela` | 2 |
| Config only `akela.config.yaml` | 1, 4 (`init`) |
| CLI usage / help → `akela` / `Akela` | 3, 4 |
| LICENSE Telvara → Akela | 2 |
| Reports / demo branding | 4 |
| README title | 4 |
| `__akela*` bindings | 5 |
| Tests updated | 1, 3 |
| No fallback / no dual bin | 1–2 (by omission) |
| Leave `track` script + folder name | Global constraints |
| Final grep + `npm run ci` + help smoke | 6 |
