# Failure Diagnosis (Deterministic Explainer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic failure explainer that emits structured `diagnosis` on tracking FAIL (reports + `track explain`), with no model or network dependencies.

**Architecture:** Pure `diagnoseFailure(RunResult)` rules over existing verification/stepLog/error fields. `writeReports` attaches diagnosis on FAIL only. `explain` CLI reloads `report.json` and recomputes (does not re-run the browser). SaaS may later rewrite messages from the same codes; this package never calls an LLM.

**Tech Stack:** TypeScript, Vitest, existing CLI (`tsx src/cli/index.ts`), no new dependencies

**Spec:** [`docs/superpowers/specs/2026-07-19-failure-diagnosis-design.md`](../specs/2026-07-19-failure-diagnosis-design.md)

## Global Constraints

- Diagnosis never changes `pass` / process exit codes for `run`
- PASS runs omit the `diagnosis` field entirely
- No LLM SDKs, Ollama, HTTP inference, or model weights
- Stable SaaS codes: `step_failed` | `wait_for_event_timeout` | `event_missing_no_near_miss` | `event_missing_near_miss` | `unexpected_events` | `forbid_extra_failed` | `capture_warnings` | `no_events_captured`
- `DiagnosisResult.version` is always `1` for this plan
- Prefer specific codes over generic (`wait_for_event_timeout` instead of `step_failed` for the same step)
- `RunResult` has no `adapters` field — `no_events_captured` evidence uses `baseUrl` (+ `eventCount: 0`) only
- TDD each task; `npm run ci` is the gate
- Do not commit unless the user explicitly asks (plan commit steps are optional checkpoints)

## File map

| File | Role |
|------|------|
| `src/diagnose/types.ts` | `DiagnosisCode`, `DiagnosisFinding`, `DiagnosisResult` |
| `src/diagnose/diagnoseFailure.ts` | Rules + sort + `diagnoseFailure` / `diagnoseReportJson` |
| `src/diagnose/formatDiagnosis.ts` | Human-readable bullet text for CLI |
| `src/report/writeReports.ts` | Attach diagnosis on FAIL; HTML/MD Diagnosis section |
| `src/cli/parseExplainArgs.ts` | Parse `explain` path + `--json` |
| `src/cli/index.ts` | Wire `explain`; update help |
| `src/api/runJourney.ts` | Re-export `diagnoseFailure` / types (thin) |
| `README.md` | Document diagnosis + `explain` + SaaS handoff note |
| `tests/unit/diagnoseFailure.test.ts` | One fixture per code + sort + PASS guard |
| `tests/unit/formatDiagnosis.test.ts` | Human formatter |
| `tests/unit/parseExplainArgs.test.ts` | Arg parsing |
| `tests/unit/writeReports.test.ts` | Assert diagnosis in FAIL JSON/HTML/MD; absent on PASS |

---

### Task 1: Types + `diagnoseFailure` rules

**Files:**
- Create: `src/diagnose/types.ts`
- Create: `src/diagnose/diagnoseFailure.ts`
- Test: `tests/unit/diagnoseFailure.test.ts`

**Interfaces:**
- Consumes: `RunResult` from `src/runner/JourneyRunner.ts`
- Produces:
  - Types in `src/diagnose/types.ts` (exact):

```ts
export type DiagnosisCode =
  | "step_failed"
  | "wait_for_event_timeout"
  | "event_missing_no_near_miss"
  | "event_missing_near_miss"
  | "unexpected_events"
  | "forbid_extra_failed"
  | "capture_warnings"
  | "no_events_captured";

export type DiagnosisFinding = {
  code: DiagnosisCode;
  severity: "error" | "warning" | "info";
  message: string;
  evidence: Record<string, unknown>;
};

export type DiagnosisResult = {
  version: 1;
  pass: false;
  findings: DiagnosisFinding[];
  summary: string;
};
```

  - `export function diagnoseFailure(result: RunResult): DiagnosisResult | undefined`
    - Returns `undefined` when `result.pass === true`
    - Otherwise returns `DiagnosisResult` with `findings` sorted by priority
  - `export type ReportJson = Omit<RunResult, "artifacts"> & { runId?: string; artifacts?: { screenshotPath?: string }; diagnosis?: DiagnosisResult }`
  - `export function diagnoseReportJson(report: ReportJson): DiagnosisResult | undefined`
    - Map report → `RunResult`-shaped input (ignore existing `diagnosis` / `runId` / screenshot path); call `diagnoseFailure`

**Rule logic (implement exactly):**

1. If `result.pass` → return `undefined`.
2. Collect findings:
   - **Failed steps:** for each `stepLog` entry with `status === "failed"`:
     - If `action === "waitForEvent"` → one `wait_for_event_timeout` (`severity: "error"`). Evidence: `{ index, action, detail, reason, eventName }` where `eventName` is `detail` if present else parsed from `reason` via /waiting for "([^"]+)"/ else omit.
     - Else → `step_failed` with same evidence shape (`eventName` omitted).
   - **Orphan error:** if `result.error` is set and no `stepLog` entry has `status === "failed"` → one `step_failed` with evidence `{ error: result.error }`, message `Run failed: ${result.error}`.
   - **`no_events_captured`:** if `result.events.length === 0` → `severity: "error"`, message about adapters/collector/UI, evidence `{ baseUrl: result.baseUrl, eventCount: 0 }`.
   - **Missing expects:** for each `verification.missing` entry:
     - If `nearMiss` → `event_missing_near_miss`, severity `error`, message includes eventName + nearMiss.diff, evidence `{ eventName, expected, diff, actualProperties, actualFields }` (actual* from nearMiss.actual).
     - Else → `event_missing_no_near_miss`, severity `error`, evidence `{ eventName, expected, seenEventNames: result.events.map(e => e.eventName) }`.
   - **Unexpected / forbidExtra:**
     - Let `names = unexpected.map(e => e.eventName).slice(0, 10)`.
     - If `options.forbidExtra && unexpected.length > 0` → `forbid_extra_failed` (`error`), evidence `{ count, eventNames: names }`.
     - Else if `unexpected.length > 0` → `unexpected_events` (`info`), evidence `{ count, eventNames: names }`.
     - Do **not** emit both for the same unexpected set.
   - **`capture_warnings`:** if `captureWarnings.length > 0` → `warning`, evidence `{ warnings: captureWarnings.slice(0, 10) }`.
3. **Sort** findings by code priority (stable within same code — preserve collection order):
   `wait_for_event_timeout` → `step_failed` → `no_events_captured` → `event_missing_near_miss` → `event_missing_no_near_miss` → `forbid_extra_failed` → `unexpected_events` → `capture_warnings`
4. **Summary:** if `findings.length === 0` use `"Run failed with no specific diagnosis rules matched."`; if `1` use that finding’s `message` first line (split on `\n`, take `[0]`); if `>1` use `${findings.length} findings: ${uniqueCodes.join(", ")}` where uniqueCodes preserves sorted order of first occurrence.

**Message templates:**

| Code | Message |
|------|---------|
| `wait_for_event_timeout` | `Step {index+1} (waitForEvent) timed out waiting for "{eventName\|detail\|event}"` — prefer evidence.eventName, else detail, else `"event"`; append `: ${reason}` if reason set |
| `step_failed` (from stepLog) | `Step {index+1} ({action}) failed: ${reason \|\| "unknown error"}` |
| `step_failed` (orphan error) | `Run failed: ${error}` |
| `no_events_captured` | `No analytics events were captured. Check adapters, collector patterns, and that the journey reached instrumented UI.` |
| `event_missing_near_miss` | `Expected "${eventName}" was close — property/field mismatch:\n${diff}` |
| `event_missing_no_near_miss` | `Expected "${eventName}" never matched; no near-miss in unused events.` |
| `forbid_extra_failed` | `forbidExtra is on and ${count} unexpected event(s) were captured: ${names.join(", ")}` |
| `unexpected_events` | `${count} unexpected event(s) were captured: ${names.join(", ")}` |
| `capture_warnings` | `${n} capture warning(s) during the run` |

- [ ] **Step 1: Write failing tests**

Create `tests/unit/diagnoseFailure.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  diagnoseFailure,
  diagnoseReportJson,
} from "../../src/diagnose/diagnoseFailure.js";
import type { RunResult } from "../../src/runner/JourneyRunner.js";
import type { NormalizedEvent } from "../../src/normalize/types.js";

function ev(
  eventName: string,
  properties: Record<string, unknown> = {},
): NormalizedEvent {
  return {
    platform: "test",
    eventName,
    properties,
    fields: { ...properties },
    raw: { url: "https://x", method: "GET", payload: {} },
  };
}

function failedBase(overrides: Partial<RunResult> = {}): RunResult {
  return {
    journeyName: "j",
    baseUrl: "http://localhost",
    durationMs: 1,
    events: [],
    verification: {
      pass: false,
      matched: [],
      missing: [],
      unexpected: [],
      options: { ordered: false, match: "partial", forbidExtra: false },
    },
    pass: false,
    captureWarnings: [],
    stepLog: [],
    ...overrides,
  };
}

describe("diagnoseFailure", () => {
  it("returns undefined on PASS", () => {
    expect(
      diagnoseFailure(
        failedBase({
          pass: true,
          verification: {
            pass: true,
            matched: [],
            missing: [],
            unexpected: [],
            options: { ordered: false, match: "partial", forbidExtra: false },
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("emits wait_for_event_timeout for failed waitForEvent steps", () => {
    const d = diagnoseFailure(
      failedBase({
        stepLog: [
          {
            index: 2,
            action: "waitForEvent",
            status: "failed",
            detail: "purchase",
            reason: 'waitForEvent timed out after 300ms waiting for "purchase"',
          },
        ],
      }),
    );
    expect(d?.findings[0]?.code).toBe("wait_for_event_timeout");
    expect(d?.findings[0]?.evidence).toMatchObject({
      index: 2,
      eventName: "purchase",
    });
  });

  it("emits step_failed for other failed steps", () => {
    const d = diagnoseFailure(
      failedBase({
        stepLog: [
          {
            index: 0,
            action: "click",
            status: "failed",
            detail: "#pay",
            reason: "Timeout",
          },
        ],
      }),
    );
    expect(d?.findings.some((f) => f.code === "step_failed")).toBe(true);
    expect(d?.findings.some((f) => f.code === "wait_for_event_timeout")).toBe(
      false,
    );
  });

  it("emits step_failed from orphan error when no failed steps", () => {
    const d = diagnoseFailure(failedBase({ error: "browser crashed" }));
    expect(d?.findings[0]?.code).toBe("step_failed");
    expect(d?.findings[0]?.message).toMatch(/browser crashed/);
  });

  it("emits no_events_captured when events empty", () => {
    const d = diagnoseFailure(failedBase({ events: [] }));
    expect(d?.findings.some((f) => f.code === "no_events_captured")).toBe(true);
  });

  it("emits event_missing_near_miss with verifier diff", () => {
    const actual = ev("click", { page: "other" });
    const diff = '  properties.page: expected "home", got "other"';
    const d = diagnoseFailure(
      failedBase({
        events: [actual],
        verification: {
          pass: false,
          matched: [],
          missing: [
            {
              expected: { eventName: "click", properties: { page: "home" } },
              nearMiss: { actual, diff },
            },
          ],
          unexpected: [],
          options: { ordered: false, match: "partial", forbidExtra: false },
        },
      }),
    );
    const f = d?.findings.find((x) => x.code === "event_missing_near_miss");
    expect(f?.evidence.diff).toBe(diff);
    expect(f?.message).toContain(diff);
  });

  it("emits event_missing_no_near_miss without nearMiss", () => {
    const d = diagnoseFailure(
      failedBase({
        events: [ev("other")],
        verification: {
          pass: false,
          matched: [],
          missing: [{ expected: { eventName: "click" } }],
          unexpected: [],
          options: { ordered: false, match: "partial", forbidExtra: false },
        },
      }),
    );
    expect(
      d?.findings.some((f) => f.code === "event_missing_no_near_miss"),
    ).toBe(true);
  });

  it("emits forbid_extra_failed instead of unexpected_events when forbidExtra", () => {
    const d = diagnoseFailure(
      failedBase({
        events: [ev("noise")],
        verification: {
          pass: false,
          matched: [],
          missing: [],
          unexpected: [ev("noise")],
          options: { ordered: false, match: "partial", forbidExtra: true },
        },
      }),
    );
    expect(d?.findings.some((f) => f.code === "forbid_extra_failed")).toBe(
      true,
    );
    expect(d?.findings.some((f) => f.code === "unexpected_events")).toBe(
      false,
    );
  });

  it("emits unexpected_events as info when forbidExtra is off", () => {
    const d = diagnoseFailure(
      failedBase({
        error: "boom",
        events: [ev("noise")],
        verification: {
          pass: false,
          matched: [],
          missing: [],
          unexpected: [ev("noise")],
          options: { ordered: false, match: "partial", forbidExtra: false },
        },
      }),
    );
    const f = d?.findings.find((x) => x.code === "unexpected_events");
    expect(f?.severity).toBe("info");
  });

  it("emits capture_warnings", () => {
    const d = diagnoseFailure(
      failedBase({ error: "x", captureWarnings: ["bad parse"] }),
    );
    expect(d?.findings.some((f) => f.code === "capture_warnings")).toBe(true);
  });

  it("sorts findings by priority", () => {
    const actual = ev("click", { page: "other" });
    const d = diagnoseFailure(
      failedBase({
        events: [actual],
        captureWarnings: ["w"],
        stepLog: [
          {
            index: 0,
            action: "waitForEvent",
            status: "failed",
            detail: "click",
            reason: 'waiting for "click"',
          },
        ],
        verification: {
          pass: false,
          matched: [],
          missing: [
            {
              expected: { eventName: "click", properties: { page: "home" } },
              nearMiss: { actual, diff: "diff" },
            },
          ],
          unexpected: [ev("noise")],
          options: { ordered: false, match: "partial", forbidExtra: true },
        },
      }),
    );
    const codes = d!.findings.map((f) => f.code);
    expect(codes.indexOf("wait_for_event_timeout")).toBeLessThan(
      codes.indexOf("event_missing_near_miss"),
    );
    expect(codes.indexOf("event_missing_near_miss")).toBeLessThan(
      codes.indexOf("forbid_extra_failed"),
    );
    expect(codes.indexOf("forbid_extra_failed")).toBeLessThan(
      codes.indexOf("capture_warnings"),
    );
  });

  it("diagnoseReportJson ignores embedded diagnosis and recomputes", () => {
    const report = {
      ...failedBase({
        stepLog: [
          {
            index: 0,
            action: "click",
            status: "failed",
            detail: "#x",
            reason: "no",
          },
        ],
      }),
      runId: "j-1",
      diagnosis: {
        version: 1 as const,
        pass: false as const,
        summary: "stale",
        findings: [],
      },
    };
    const d = diagnoseReportJson(report);
    expect(d?.summary).not.toBe("stale");
    expect(d?.findings[0]?.code).toBe("step_failed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/diagnoseFailure.test.ts`

Expected: FAIL (module not found / `diagnoseFailure` not defined)

- [ ] **Step 3: Implement types + diagnoseFailure**

Create `src/diagnose/types.ts` with the types above.

Create `src/diagnose/diagnoseFailure.ts` implementing the rule logic and both exports. Keep helpers private in the same file (no `rules/` split unless the file exceeds ~250 lines).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/diagnoseFailure.test.ts`

Expected: PASS

- [ ] **Step 5: Commit (optional — only if user asked)**

```bash
git add src/diagnose/types.ts src/diagnose/diagnoseFailure.ts tests/unit/diagnoseFailure.test.ts
git commit -m "$(cat <<'EOF'
feat: add deterministic failure diagnosis rules

EOF
)"
```

---

### Task 2: Human formatter

**Files:**
- Create: `src/diagnose/formatDiagnosis.ts`
- Test: `tests/unit/formatDiagnosis.test.ts`

**Interfaces:**
- Consumes: `DiagnosisResult`
- Produces: `export function formatDiagnosisText(diagnosis: DiagnosisResult): string`
  - First line: `Diagnosis: ${summary}` (if summary is multi-line, use first line only for the header; still list full finding messages below)
  - Then blank line
  - Then for each finding: `- [${code}] ${message}` (message may be multi-line; indent continuation lines with two spaces)

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { formatDiagnosisText } from "../../src/diagnose/formatDiagnosis.js";

describe("formatDiagnosisText", () => {
  it("formats summary and findings", () => {
    const text = formatDiagnosisText({
      version: 1,
      pass: false,
      summary: "2 findings: step_failed, capture_warnings",
      findings: [
        {
          code: "step_failed",
          severity: "error",
          message: "Step 1 (click) failed: Timeout",
          evidence: {},
        },
        {
          code: "event_missing_near_miss",
          severity: "error",
          message: 'Expected "click" was close — property/field mismatch:\ndiff-line',
          evidence: {},
        },
      ],
    });
    expect(text).toContain("Diagnosis: 2 findings:");
    expect(text).toContain("- [step_failed] Step 1 (click) failed: Timeout");
    expect(text).toContain("- [event_missing_near_miss]");
    expect(text).toContain("diff-line");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/formatDiagnosis.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement formatter**

```ts
import type { DiagnosisResult } from "./types.js";

export function formatDiagnosisText(diagnosis: DiagnosisResult): string {
  const summaryLine = diagnosis.summary.split("\n")[0] ?? diagnosis.summary;
  const lines = [`Diagnosis: ${summaryLine}`, ""];
  for (const f of diagnosis.findings) {
    const msgLines = f.message.split("\n");
    lines.push(`- [${f.code}] ${msgLines[0] ?? ""}`);
    for (const cont of msgLines.slice(1)) {
      lines.push(`  ${cont}`);
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/formatDiagnosis.test.ts`

Expected: PASS

- [ ] **Step 5: Commit (optional)**

```bash
git add src/diagnose/formatDiagnosis.ts tests/unit/formatDiagnosis.test.ts
git commit -m "$(cat <<'EOF'
feat: format diagnosis findings for CLI text output

EOF
)"
```

---

### Task 3: Embed diagnosis in reports

**Files:**
- Modify: `src/report/writeReports.ts`
- Modify: `tests/unit/writeReports.test.ts`

**Interfaces:**
- Consumes: `diagnoseFailure` from `../diagnose/diagnoseFailure.js`
- Produces: FAIL `report.json` includes `diagnosis: DiagnosisResult`; PASS omits it; HTML + Markdown gain a Diagnosis section when present

**Implementation notes for `writeReports`:**

```ts
import { diagnoseFailure } from "../diagnose/diagnoseFailure.js";

// inside writeReports, after building paths / before writes:
const diagnosis = !result.pass ? diagnoseFailure(result) : undefined;

// JSON payload:
{
  runId,
  ...rest,
  ...(screenshotPath ? { artifacts: { screenshotPath } } : {}),
  ...(diagnosis ? { diagnosis } : {}),
}

// HTML: after status header / before verification table, if diagnosis:
<section>
  <h2>Diagnosis</h2>
  <p>${escapeHtml(diagnosis.summary.split("\n")[0] ?? "")}</p>
  <ul>
    ${diagnosis.findings.map(f =>
      `<li><code>${escapeHtml(f.code)}</code> <pre>${escapeHtml(f.message)}</pre></li>`
    ).join("")}
  </ul>
</section>

// Markdown: after error/screenshot blocks, before Capture warnings (or before Missing):
## Diagnosis
- summary line
- for each finding: `- \`code\` —` then message (fenced if multi-line)
```

- [ ] **Step 1: Extend writeReports tests**

Add to `tests/unit/writeReports.test.ts`:

```ts
it("embeds diagnosis on FAIL and omits on PASS", () => {
  const failDir = mkdtempSync(join(tmpdir(), "analytics-reports-"));
  const failPaths = writeReports(baseResult(), failDir);
  const failJson = JSON.parse(readFileSync(failPaths.json, "utf8")) as {
    diagnosis?: { version: number; findings: { code: string }[] };
  };
  expect(failJson.diagnosis?.version).toBe(1);
  expect(failJson.diagnosis?.findings.length).toBeGreaterThan(0);

  const failMd = readFileSync(failPaths.markdown, "utf8");
  expect(failMd).toMatch(/## Diagnosis/);
  const failHtml = readFileSync(failPaths.html, "utf8");
  expect(failHtml).toMatch(/Diagnosis/);

  const passDir = mkdtempSync(join(tmpdir(), "analytics-reports-"));
  const passPaths = writeReports(
    baseResult({
      pass: true,
      error: undefined,
      verification: {
        pass: true,
        matched: [],
        missing: [],
        unexpected: [],
        options: { ordered: false, match: "partial", forbidExtra: false },
      },
      captureWarnings: [],
      stepLog: [],
      artifacts: undefined,
    }),
    passDir,
  );
  const passJson = JSON.parse(readFileSync(passPaths.json, "utf8")) as {
    diagnosis?: unknown;
  };
  expect(passJson.diagnosis).toBeUndefined();
  expect(readFileSync(passPaths.markdown, "utf8")).not.toMatch(/## Diagnosis/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/writeReports.test.ts -t "embeds diagnosis"`

Expected: FAIL (diagnosis missing)

- [ ] **Step 3: Wire diagnoseFailure into writeReports**

Modify `src/report/writeReports.ts` as in the implementation notes. Keep existing sections intact.

- [ ] **Step 4: Run writeReports tests**

Run: `npx vitest run tests/unit/writeReports.test.ts`

Expected: PASS

- [ ] **Step 5: Commit (optional)**

```bash
git add src/report/writeReports.ts tests/unit/writeReports.test.ts
git commit -m "$(cat <<'EOF'
feat: embed failure diagnosis in HTML/JSON/Markdown reports

EOF
)"
```

---

### Task 4: `explain` CLI

**Files:**
- Create: `src/cli/parseExplainArgs.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/unit/parseExplainArgs.test.ts`

**Interfaces:**
- Consumes: `diagnoseReportJson`, `formatDiagnosisText`, `readFileSync` / `existsSync` / `statSync`
- Produces:
  - `export type ExplainCliOptions = { reportPath: string; json: boolean }`
  - `export function parseExplainArgs(args: string[]): ExplainCliOptions`
    - First positional required: path to report dir or `report.json`
    - Optional `--json` (also `--json=true` not required; bare `--json` is enough)
    - Unknown flags throw `Usage: analytics-tracker explain <reportDir|report.json> [--json]`
  - `cmdExplain(inputPath, cwd): number` — resolve file, parse JSON, diagnose, print, return exit code

**Resolve path:**

```ts
function resolveReportJson(input: string, cwd: string): string {
  const abs = resolve(cwd, input);
  if (!existsSync(abs)) {
    throw new Error(`Report not found: ${abs}`);
  }
  const st = statSync(abs);
  if (st.isDirectory()) {
    const candidate = join(abs, "report.json");
    if (!existsSync(candidate)) {
      throw new Error(`No report.json in directory: ${abs}`);
    }
    return candidate;
  }
  return abs;
}
```

**cmdExplain behavior:**

1. Resolve path; `JSON.parse` file.
2. `const diagnosis = diagnoseReportJson(parsed)`.
3. If `diagnosis` undefined (PASS report) → print `No diagnosis: report passed.` (human) or `{"pass":true,"diagnosis":null}` when `--json`; exit `0`.
4. If FAIL → `--json` prints `JSON.stringify(diagnosis, null, 2)`; else `formatDiagnosisText(diagnosis)`; exit `0`.
5. Missing/invalid JSON → message to stderr, exit `1`.

Wire in `main`:

```ts
if (cmd === "explain") {
  try {
    const opts = parseExplainArgs(args.slice(1));
    process.exit(cmdExplain(opts.reportPath, cwd, opts.json));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
```

Update `printHelp` Usage + a short Explain section.

Also print diagnosis summary on failed `cmdRun` after existing FAIL lines (optional but recommended):

```ts
import { diagnoseFailure } from "../diagnose/diagnoseFailure.js";
import { formatDiagnosisText } from "../diagnose/formatDiagnosis.js";
// after console.log FAIL / matched counts:
const diagnosis = diagnoseFailure(result);
if (diagnosis) {
  console.log("");
  console.log(formatDiagnosisText(diagnosis));
}
```

- [ ] **Step 1: Write parseExplainArgs tests**

```ts
import { describe, it, expect } from "vitest";
import { parseExplainArgs } from "../../src/cli/parseExplainArgs.js";

describe("parseExplainArgs", () => {
  it("parses report path", () => {
    expect(parseExplainArgs(["reports/run-1"])).toEqual({
      reportPath: "reports/run-1",
      json: false,
    });
  });

  it("parses --json", () => {
    expect(parseExplainArgs(["reports/run-1", "--json"])).toEqual({
      reportPath: "reports/run-1",
      json: true,
    });
  });

  it("rejects missing path", () => {
    expect(() => parseExplainArgs([])).toThrow(/Usage: analytics-tracker explain/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseExplainArgs(["r.json", "--foo"])).toThrow(/Unknown option/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/parseExplainArgs.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement parseExplainArgs + cmdExplain + help + run summary**

Create `src/cli/parseExplainArgs.ts`. Add `cmdExplain` and wiring in `src/cli/index.ts`.

- [ ] **Step 4: Manual smoke (no browser re-run)**

If a FAIL report dir exists under `reports/`, run:

```bash
npm run track -- explain reports/<some-fail-runId>
npm run track -- explain reports/<some-fail-runId> --json
```

Expected: human bullets / JSON with `version: 1` and findings. If no FAIL report exists, skip manual smoke — unit tests suffice.

- [ ] **Step 5: Run unit tests**

Run: `npx vitest run tests/unit/parseExplainArgs.test.ts tests/unit/diagnoseFailure.test.ts tests/unit/writeReports.test.ts`

Expected: PASS

- [ ] **Step 6: Commit (optional)**

```bash
git add src/cli/parseExplainArgs.ts src/cli/index.ts tests/unit/parseExplainArgs.test.ts
git commit -m "$(cat <<'EOF'
feat: add track explain for report diagnosis

EOF
)"
```

---

### Task 5: API export + README

**Files:**
- Modify: `src/api/runJourney.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: re-export `diagnoseFailure`, `diagnoseReportJson`, `formatDiagnosisText`, and diagnosis types from the API entry (or from `runJourney.ts` alongside existing exports)

```ts
export {
  diagnoseFailure,
  diagnoseReportJson,
} from "../diagnose/diagnoseFailure.js";
export { formatDiagnosisText } from "../diagnose/formatDiagnosis.js";
export type {
  DiagnosisCode,
  DiagnosisFinding,
  DiagnosisResult,
  ReportJson,
} from "../diagnose/types.js";
```

(Put `ReportJson` in `types.ts` if it currently lives only in `diagnoseFailure.ts` — prefer `types.ts` for the re-export path.)

**README section** (after Reports / CLI, concise):

```markdown
## Failure diagnosis

Failed tracking runs include a structured `diagnosis` object in `report.json` (and a Diagnosis section in HTML/Markdown). Codes are stable for SaaS consumers (`findings[].code`). Diagnosis never changes pass/fail.

```bash
npm run track -- explain reports/<runId>
npm run track -- explain reports/<runId>/report.json --json
```

Optional LLM prose belongs in a future SaaS layer that calls this CLI/API — not in this package.
```

- [ ] **Step 1: Add exports + README**

Apply the changes above. Move `ReportJson` to `src/diagnose/types.ts` if needed so the API re-export is clean.

- [ ] **Step 2: Typecheck + full CI**

Run: `npm run ci`

Expected: PASS (vitest + tsc)

- [ ] **Step 3: Commit (optional)**

```bash
git add src/api/runJourney.ts src/diagnose/types.ts README.md
git commit -m "$(cat <<'EOF'
docs: document failure diagnosis and export diagnose API

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `diagnoseFailure` / codes / sort / templates | Task 1 |
| `diagnoseReportJson` recompute | Task 1 |
| PASS → no diagnosis | Tasks 1, 3 |
| Embed in report.json / HTML / MD | Task 3 |
| `track explain` + `--json` + exit codes | Task 4 |
| CLI text formatter | Task 2, 4 |
| Print on failed `run` (nice-to-have in design) | Task 4 |
| TS API export | Task 5 |
| README SaaS handoff | Task 5 |
| No model deps | Global + all tasks |
| Unit tests per code | Task 1 |
| Auth diagnosis deferred | Out of scope (no task) |

## Self-review notes

- No placeholders left in steps.
- `ReportJson` must live in `types.ts` by end of Task 5 for clean API exports (Task 1 may define it in `diagnoseFailure.ts` and Task 5 moves it — or Task 1 puts it in `types.ts` immediately; **prefer Task 1 puts `ReportJson` in `types.ts`**).
- `unexpected_events` vs `forbid_extra_failed` mutual exclusion matches the spec’s “not both” intent.
