import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveReportJson,
  runExplain,
} from "../../src/cli/explainReport.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "analytics-explain-"));
}

function passingReport() {
  return {
    journeyName: "report-test",
    baseUrl: "http://localhost",
    durationMs: 1,
    events: [],
    verification: {
      pass: true,
      matched: [],
      missing: [],
      unexpected: [],
      options: { ordered: false, match: "partial", forbidExtra: false },
    },
    pass: true,
    captureWarnings: [],
    stepLog: [],
  };
}

function failingReport() {
  return {
    ...passingReport(),
    pass: false,
    verification: {
      ...passingReport().verification,
      pass: false,
      missing: [{ expected: { eventName: "purchase" } }],
    },
  };
}

describe("explain report", () => {
  it("rejects a missing path and a directory without report.json", () => {
    const cwd = tempDir();
    const emptyReportDir = join(cwd, "empty-report");
    mkdirSync(emptyReportDir);

    expect(() => resolveReportJson("missing.json", cwd)).toThrow(/Report not found/);
    expect(() => resolveReportJson(emptyReportDir, cwd)).toThrow(
      /No report\.json in directory/,
    );
  });

  it("returns exit 0 and a PASS response", () => {
    const cwd = tempDir();
    const reportPath = join(cwd, "report.json");
    writeFileSync(reportPath, JSON.stringify(passingReport()));

    expect(runExplain(reportPath, false)).toEqual({
      exitCode: 0,
      stdout: "No diagnosis: report passed.",
    });
    expect(runExplain(reportPath, true)).toEqual({
      exitCode: 0,
      stdout: JSON.stringify({ pass: true, diagnosis: null }),
    });
  });

  it("returns exit 0 with findings in human and JSON output", () => {
    const cwd = tempDir();
    const reportPath = join(cwd, "report.json");
    writeFileSync(reportPath, JSON.stringify(failingReport()));

    expect(runExplain(reportPath, false)).toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining(
        "[Expected analytics event never fired]",
      ),
    });
    expect(
      runExplain(reportPath, { verbose: true }).stdout,
    ).toContain("[event_missing_no_near_miss]");
    expect(JSON.parse(runExplain(reportPath, true).stdout)).toMatchObject({
      pass: false,
      guidance: expect.any(Array),
      primaryFindingIndexes: expect.any(Array),
      findings: expect.arrayContaining([
        expect.objectContaining({ code: "event_missing_no_near_miss" }),
      ]),
    });
  });

  it("returns findings for legacy failing reports without diagnostic arrays", () => {
    const cwd = tempDir();
    const reportPath = join(cwd, "report.json");
    const report = failingReport() as Record<string, unknown>;
    delete report.stepLog;
    delete report.captureWarnings;
    (report.verification as { missing: unknown[] }).missing = [
      { eventName: "purchase" },
    ];
    writeFileSync(reportPath, JSON.stringify(report));

    expect(runExplain(reportPath, false)).toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining(
        "[Expected analytics event never fired]",
      ),
    });
  });

  it("throws for invalid report JSON", () => {
    const cwd = tempDir();
    const reportPath = join(cwd, "report.json");
    writeFileSync(reportPath, "{invalid");

    expect(() => runExplain(reportPath, false)).toThrow(SyntaxError);
  });
});
