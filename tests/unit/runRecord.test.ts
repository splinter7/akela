import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig, NormalizedEvent, Step } from "../../src/normalize/types.js";
import type { RecorderSessionResult } from "../../src/record/RecorderSession.js";
import { runRecord } from "../../src/record/runRecord.js";

const PLAN_CSV = `eventName,trigger,path,selector,value,properties,notes
page_view,page_load,/,,,"{""page"":""home""}",Home
cta_click,click,,#cta,,"{""button_id"":""cta""}",CTA
`;

function event(
  eventName: string,
  properties: Record<string, unknown> = {},
): NormalizedEvent {
  return {
    platform: "snowplow",
    eventName,
    properties,
    fields: { ...properties },
    raw: { url: "http://x", method: "GET", payload: null },
  };
}

function sessionResult(
  overrides: Partial<RecorderSessionResult> & {
    fragileStepIndexes?: number[];
  } = {},
): RecorderSessionResult & { fragileStepIndexes: number[] } {
  const steps: Step[] = overrides.steps ?? [
    { action: "goto", path: "/" },
    { action: "click", selector: '[data-analytics-id="demo-cta"]' },
  ];
  const fragileStepIndexes = overrides.fragileStepIndexes ?? [];
  return {
    steps,
    fragileCount: overrides.fragileCount ?? fragileStepIndexes.length,
    actionTimestamps: overrides.actionTimestamps ?? steps.map((_, i) => i * 100),
    events: overrides.events ?? [
      event("page_view", { page: "home" }),
      event("cta_click", { button_id: "cta" }),
    ],
    warnings: overrides.warnings ?? [],
    fragileStepIndexes,
  };
}

function baseConfig(): AppConfig {
  return {
    baseUrl: "http://127.0.0.1:4173",
    headless: true,
    quietMs: 50,
    quietTimeoutMs: 200,
  };
}

describe("runRecord", () => {
  it("does not write when zero steps unless --force", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "run-record-zero-"));
    const outPath = "journeys/empty.yaml";
    const logs: string[] = [];

    const result = await runRecord(
      {
        startUrl: "http://127.0.0.1:4173/",
        name: "empty",
        adapters: ["snowplow"],
        outPath,
        overwrite: false,
        force: false,
        allowIncomplete: true,
        includeUnplanned: false,
        cwd,
        autoStop: true,
      },
      baseConfig(),
      {
        captureSession: async () =>
          sessionResult({
            steps: [],
            events: [],
            actionTimestamps: [],
            fragileStepIndexes: [],
            fragileCount: 0,
          }),
        log: (m) => logs.push(m),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(cwd, outPath))).toBe(false);
    expect(logs.some((l) => /no steps|zero steps|--force/i.test(l))).toBe(true);
  });

  it("writes empty draft when zero steps and --force", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "run-record-force-"));
    const outPath = "journeys/empty.yaml";

    const result = await runRecord(
      {
        startUrl: "http://127.0.0.1:4173/",
        name: "empty",
        adapters: ["snowplow"],
        outPath,
        overwrite: false,
        force: true,
        allowIncomplete: true,
        includeUnplanned: false,
        cwd,
        autoStop: true,
      },
      baseConfig(),
      {
        captureSession: async () =>
          sessionResult({
            steps: [],
            events: [],
            actionTimestamps: [],
            fragileStepIndexes: [],
            fragileCount: 0,
          }),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(cwd, outPath))).toBe(true);
    const yaml = readFileSync(join(cwd, outPath), "utf8");
    expect(yaml).toContain("# DRAFT — exploratory");
    expect(yaml).toContain("name: empty");
  });

  it("exits 1 when plan events are missing and not --allow-incomplete", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "run-record-miss-"));
    writeFileSync(join(cwd, "plan.csv"), PLAN_CSV, "utf8");
    const outPath = "journeys/miss.yaml";
    const logs: string[] = [];

    const result = await runRecord(
      {
        startUrl: "http://127.0.0.1:4173/",
        planPath: "plan.csv",
        name: "miss",
        adapters: ["snowplow"],
        outPath,
        overwrite: false,
        force: false,
        allowIncomplete: false,
        includeUnplanned: false,
        cwd,
        autoStop: true,
      },
      baseConfig(),
      {
        captureSession: async () =>
          sessionResult({
            events: [event("page_view", { page: "home" })],
          }),
        log: (m) => logs.push(m),
      },
    );

    expect(result.exitCode).toBe(1);
    expect(existsSync(join(cwd, outPath))).toBe(true);
    const summary = logs.join("\n");
    expect(summary).toMatch(/missing/i);
    expect(summary).toMatch(/cta_click/);
    expect(summary).toContain("Next: npm run track -- run journeys/miss.yaml");
  });

  it("happy path: writes draft with plan coverage and exit 0", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "run-record-ok-"));
    writeFileSync(join(cwd, "plan.csv"), PLAN_CSV, "utf8");
    const outPath = "journeys/ok.yaml";
    const logs: string[] = [];

    const result = await runRecord(
      {
        startUrl: "http://127.0.0.1:4173/",
        planPath: "plan.csv",
        name: "ok",
        adapters: ["snowplow"],
        outPath,
        baseUrl: "http://127.0.0.1:4173",
        overwrite: false,
        force: false,
        allowIncomplete: false,
        includeUnplanned: false,
        cwd,
        autoStop: true,
      },
      baseConfig(),
      {
        captureSession: async () => sessionResult(),
        log: (m) => logs.push(m),
      },
    );

    expect(result.exitCode).toBe(0);
    const yaml = readFileSync(join(cwd, outPath), "utf8");
    expect(yaml).toContain("# DRAFT — review selectors; expect seeded from plan plan.csv");
    expect(yaml).toContain("gotoWaitUntil: domcontentloaded");
    expect(yaml).toContain("ordered: true");
    expect(yaml).toContain("eventName: page_view");
    expect(yaml).toContain("eventName: cta_click");
    expect(yaml).toMatch(/action: waitForEvent/);
    const summary = logs.join("\n");
    expect(summary).toMatch(/2 matched, 0 missing/);
    expect(summary).toContain("Next: npm run track -- run journeys/ok.yaml");
  });

  it("fails before session when plan CSV is invalid", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "run-record-badplan-"));
    writeFileSync(join(cwd, "plan.csv"), "not,a,valid\nplan\n", "utf8");
    let sessionCalled = false;

    const result = await runRecord(
      {
        startUrl: "http://127.0.0.1:4173/",
        planPath: "plan.csv",
        name: "bad",
        adapters: ["snowplow"],
        outPath: "journeys/bad.yaml",
        overwrite: false,
        force: false,
        allowIncomplete: false,
        includeUnplanned: false,
        cwd,
        autoStop: true,
      },
      baseConfig(),
      {
        captureSession: async () => {
          sessionCalled = true;
          return sessionResult();
        },
      },
    );

    expect(result.exitCode).toBe(1);
    expect(sessionCalled).toBe(false);
    expect(existsSync(join(cwd, "journeys/bad.yaml"))).toBe(false);
  });

  it("fails when out exists without --overwrite", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "run-record-ow-"));
    const outPath = "journeys/exists.yaml";
    mkdirSync(join(cwd, "journeys"), { recursive: true });
    writeFileSync(join(cwd, outPath), "name: old\n", "utf8");
    writeFileSync(join(cwd, "plan.csv"), PLAN_CSV, "utf8");
    let sessionCalled = false;
    const errors: string[] = [];

    const result = await runRecord(
      {
        startUrl: "http://127.0.0.1:4173/",
        planPath: "plan.csv",
        name: "exists",
        adapters: ["snowplow"],
        outPath,
        overwrite: false,
        force: false,
        allowIncomplete: false,
        includeUnplanned: false,
        cwd,
        autoStop: true,
      },
      baseConfig(),
      {
        captureSession: async () => {
          sessionCalled = true;
          return sessionResult();
        },
        error: (m) => errors.push(m),
      },
    );

    expect(result.exitCode).toBe(1);
    expect(sessionCalled).toBe(false);
    expect(errors.some((e) => e.includes("use --overwrite to replace"))).toBe(true);
  });
});
