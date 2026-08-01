# Human Diagnosis Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add human-friendly diagnosis presentation (headline, guidance, cascade collapse, labels) while keeping full `findings[]` for SaaS/engineers.

**Architecture:** Pure `buildPresentation(findings)` derives `summary`, `guidance`, `primaryFindingIndexes`, `cascadeNote`. `diagnoseFailure` attaches them. Formatters and reports use presentation by default; `--verbose` / Technical details show all findings.

**Tech Stack:** TypeScript, Vitest, existing CLI — no new dependencies

**Spec:** [`docs/superpowers/specs/2026-07-19-human-diagnosis-presentation-design.md`](../specs/2026-07-19-human-diagnosis-presentation-design.md)

## Global Constraints

- `DiagnosisResult.version` stays `1`; findings list stays complete
- PASS still omits `diagnosis`
- No LLM / network inference
- Default human view uses labels; verbose uses `[code]`
- `npm run ci` is the gate
- Do not commit unless the user explicitly asks

## File map

| File | Role |
|------|------|
| `src/diagnose/types.ts` | Extend `DiagnosisResult` |
| `src/diagnose/labels.ts` | Code → plain label |
| `src/diagnose/buildPresentation.ts` | Cascade, headline, guidance |
| `src/diagnose/diagnoseFailure.ts` | Call buildPresentation |
| `src/diagnose/formatDiagnosis.ts` | Default vs verbose text |
| `src/report/writeReports.ts` | HTML/MD summary + technical details |
| `src/cli/parseExplainArgs.ts` | `--verbose` |
| `src/cli/explainReport.ts` | Pass verbose |
| `src/cli/index.ts` | Help + wire verbose |
| `README.md` | Document presentation + `--verbose` |
| `tests/unit/buildPresentation.test.ts` | Presentation rules |
| `tests/unit/formatDiagnosis.test.ts` | Default vs verbose |
| `tests/unit/diagnoseFailure.test.ts` | Assert new fields exist |
| `tests/unit/parseExplainArgs.test.ts` | `--verbose` |
| `tests/unit/explainReport.test.ts` | Verbose path |
| `tests/unit/writeReports.test.ts` | Human section + technical details |

---

### Task 1: Types, labels, buildPresentation

**Files:**
- Modify: `src/diagnose/types.ts`
- Create: `src/diagnose/labels.ts`
- Create: `src/diagnose/buildPresentation.ts`
- Test: `tests/unit/buildPresentation.test.ts`

**Interfaces:**

```ts
// types — DiagnosisResult adds:
guidance: string[];
primaryFindingIndexes: number[];
cascadeNote?: string;
// summary becomes human headline

// labels.ts
export function diagnosisLabel(code: DiagnosisCode): string;

// buildPresentation.ts
export type Presentation = {
  summary: string;
  guidance: string[];
  primaryFindingIndexes: number[];
  cascadeNote?: string;
};
export function buildPresentation(findings: DiagnosisFinding[]): Presentation;
```

Rules per design spec (cascade, headline priority, guidance max 3, labels).

- [ ] **Step 1: Write failing tests** for cascade indexes, headline with `actualProperties.page`, empty_state guidance, no-cascade when no step fail
- [ ] **Step 2: Run RED** — `npx vitest run tests/unit/buildPresentation.test.ts`
- [ ] **Step 3: Implement** types, labels, buildPresentation
- [ ] **Step 4: GREEN** — same vitest command
- [ ] **Step 5: Commit (optional)**

---

### Task 2: Wire diagnoseFailure + formatDiagnosis

**Files:**
- Modify: `src/diagnose/diagnoseFailure.ts`
- Modify: `src/diagnose/formatDiagnosis.ts`
- Modify: `tests/unit/diagnoseFailure.test.ts`
- Modify: `tests/unit/formatDiagnosis.test.ts`

**Interfaces:**

```ts
export function formatDiagnosisText(
  diagnosis: DiagnosisResult,
  options?: { verbose?: boolean },
): string;
```

Default: `Diagnosis: {summary}`, blank, `What to try:` + guidance, blank, primary findings with labels, cascadeNote, hint about `--verbose` when cascade or findings truncated.  
Verbose: today’s full `[code]` list (all findings); still show summary/guidance first.

- [ ] **Step 1: Failing formatter + diagnoseFailure field asserts**
- [ ] **Step 2: Implement wire-up; remove old buildSummary rollup**
- [ ] **Step 3: `npx vitest run tests/unit/diagnoseFailure.test.ts tests/unit/formatDiagnosis.test.ts`**
- [ ] **Step 4: Commit (optional)**

---

### Task 3: Reports + explain --verbose + README

**Files:**
- Modify: `src/report/writeReports.ts`
- Modify: `src/cli/parseExplainArgs.ts`
- Modify: `src/cli/explainReport.ts`
- Modify: `src/cli/index.ts`
- Modify: `README.md`
- Modify tests: `writeReports`, `parseExplainArgs`, `explainReport`

- [ ] **Step 1: Tests for HTML/MD structure, `--verbose`, explain verbose output**
- [ ] **Step 2: Implement report sections + CLI**
- [ ] **Step 3: `npm run ci`**
- [ ] **Step 4: Commit (optional)**

## Spec coverage

| Requirement | Task |
|-------------|------|
| Contract fields | 1–2 |
| Cascade / headline / guidance / labels | 1 |
| formatDiagnosis default/verbose | 2 |
| HTML/MD + explain --verbose + README | 3 |
| Full findings in JSON | 2–3 |
