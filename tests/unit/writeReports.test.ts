import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeReports } from "../../src/report/writeReports.js";
import type { RunResult } from "../../src/runner/JourneyRunner.js";
import type { NormalizedEvent } from "../../src/normalize/types.js";

function ev(eventName: string, properties: Record<string, unknown> = {}): NormalizedEvent {
  return {
    platform: "test",
    eventName,
    properties,
    fields: { ...properties },
    raw: { url: "https://x", method: "GET", payload: {} },
  };
}

function baseResult(overrides: Partial<RunResult> = {}): RunResult {
  const actual = ev("click", { page: "other" });
  return {
    journeyName: "report-test",
    baseUrl: "http://localhost",
    durationMs: 10,
    events: [actual],
    verification: {
      pass: false,
      matched: [],
      missing: [
        {
          expected: { eventName: "click", properties: { page: "home" } },
          nearMiss: {
            actual,
            diff: '  properties.page: expected "home", got "other"',
          },
        },
      ],
      unexpected: [ev("noise")],
      options: { ordered: false, match: "partial", forbidExtra: true },
    },
    pass: false,
    error: "boom",
    captureWarnings: ["parse failed"],
    stepLog: [
      {
        index: 0,
        action: "click",
        status: "skipped",
        detail: "#btn",
        reason: "when.visible not found: #gate",
      },
    ],
    artifacts: { screenshot: Buffer.from("fake-png") },
    ...overrides,
  };
}

describe("writeReports", () => {
  it("writes failure.png and surfaces near-miss, warnings, unexpected, step log", () => {
    const dir = mkdtempSync(join(tmpdir(), "analytics-reports-"));
    const paths = writeReports(baseResult(), dir);

    expect(paths.screenshot).toBeDefined();
    expect(existsSync(paths.screenshot!)).toBe(true);

    const md = readFileSync(paths.markdown, "utf8");
    expect(md).toMatch(/Capture warnings/);
    expect(md).toMatch(/parse failed/);
    expect(md).toMatch(/Unexpected/);
    expect(md).toMatch(/noise/);
    expect(md).toMatch(/near-miss/);
    expect(md).toMatch(/Step log/);
    expect(md).toMatch(/skipped/);
    expect(md).toMatch(/Failure screenshot/);

    const html = readFileSync(paths.html, "utf8");
    expect(html).toMatch(/near-miss/);
    expect(html).toMatch(/failure\.png/);
    expect(html).toMatch(/Capture warnings/);

    const json = JSON.parse(readFileSync(paths.json, "utf8")) as {
      artifacts?: { screenshotPath?: string };
    };
    expect(json.artifacts?.screenshotPath).toMatch(/failure\.png$/);
  });

  it("styles failed stepLog rows in HTML", () => {
    const dir = mkdtempSync(join(tmpdir(), "analytics-reports-"));
    const paths = writeReports(
      baseResult({
        stepLog: [
          {
            index: 0,
            action: "waitForEvent",
            status: "failed",
            detail: "click",
            reason: "waitForEvent timed out after 300ms waiting for \"click\"",
          },
        ],
      }),
      dir,
    );
    const html = readFileSync(paths.html, "utf8");
    expect(html).toMatch(/tr class="failed"/);
    expect(html).toMatch(/failed/);
    const md = readFileSync(paths.markdown, "utf8");
    expect(md).toMatch(/\*\*failed\*\*/);
  });

  it("embeds diagnosis on FAIL and omits on PASS", () => {
    const failDir = mkdtempSync(join(tmpdir(), "analytics-reports-"));
    const failPaths = writeReports(baseResult(), failDir);
    const failJson = JSON.parse(readFileSync(failPaths.json, "utf8")) as {
      diagnosis?: {
        version: number;
        findings: { code: string }[];
        guidance?: string[];
        primaryFindingIndexes?: number[];
      };
    };
    expect(failJson.diagnosis?.version).toBe(1);
    expect(failJson.diagnosis?.findings.length).toBeGreaterThan(0);
    expect(failJson.diagnosis?.guidance?.length).toBeGreaterThan(0);
    expect(failJson.diagnosis?.primaryFindingIndexes?.length).toBeGreaterThan(
      0,
    );

    const failMd = readFileSync(failPaths.markdown, "utf8");
    expect(failMd).toMatch(/## Diagnosis/);
    expect(failMd).toMatch(/### Technical findings/);
    expect(failMd).toMatch(/What to try/);
    const failHtml = readFileSync(failPaths.html, "utf8");
    expect(failHtml).toMatch(/Diagnosis/);
    expect(failHtml).toMatch(/Technical findings/);
    expect(failHtml).toMatch(/What to try/);

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
});
