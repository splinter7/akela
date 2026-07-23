import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config/loadConfig.js";
import { loadJourney } from "../../src/journey/loadJourney.js";
import { RecorderSession } from "../../src/record/RecorderSession.js";
import { runRecord } from "../../src/record/runRecord.js";
import { runJourneyWithConfig } from "../../src/runner/JourneyRunner.js";
import type { AppConfig } from "../../src/normalize/types.js";

const demoDir = join(process.cwd(), "demo");

const INCOMPLETE_PLAN = `eventName,trigger,path,selector,value,properties,notes
page_view,page_load,/,,,"{""page"":""home""}",Home page load
cta_click,click,,#cta,,"{""button_id"":""cta""}",Click primary CTA
never_fires,click,,#missing-button,,,Does not exist on demo
`;

describe("record demo integration", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (
        url.pathname.includes("/snowplow/") ||
        url.pathname.includes("/i") ||
        url.pathname.includes("/tp2")
      ) {
        req.on("data", () => {});
        req.on("end", () => {
          res.writeHead(204);
          res.end();
        });
        return;
      }
      const path = url.pathname === "/" ? "/index.html" : url.pathname;
      const filePath = join(demoDir, path);
      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(readFileSync(filePath));
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });

    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Failed to bind demo server");
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  function sessionConfig(): AppConfig {
    const config = loadConfig(process.cwd());
    return {
      ...config,
      baseUrl,
      headless: true,
      quietMs: 50,
      quietTimeoutMs: 800,
    };
  }

  async function captureDemoSession(): Promise<
    Awaited<ReturnType<RecorderSession["stop"]>>
  > {
    const session = new RecorderSession({
      startUrl: `${baseUrl}/`,
      adapters: ["snowplow"],
      config: sessionConfig(),
      headless: true,
    });
    await session.start();
    const page = session.getPage();
    // page_view auto-fires on load; CTA click covers cta_click + stable selector
    await page.click('[data-analytics-id="demo-cta"]');
    return session.stop();
  }

  it("records plans/demo.csv; draft loads and PASSes", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "record-demo-ok-"));
    const outAbs = join(outDir, "demo-recorded.yaml");
    const logs: string[] = [];
    const config = sessionConfig();

    const result = await runRecord(
      {
        startUrl: `${baseUrl}/`,
        planPath: "plans/demo.csv",
        name: "demo-recorded",
        adapters: ["snowplow"],
        outPath: outAbs,
        baseUrl,
        overwrite: true,
        force: false,
        allowIncomplete: false,
        includeUnplanned: false,
        cwd: process.cwd(),
        autoStop: true,
        headless: true,
      },
      config,
      {
        captureSession: captureDemoSession,
        log: (m) => logs.push(m),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.coverage).toBeDefined();
    expect(result.coverage!.missing).toHaveLength(0);
    expect(
      result.coverage!.matched.some((m) => m.row.eventName === "page_view"),
    ).toBe(true);
    expect(
      result.coverage!.matched.some((m) => m.row.eventName === "cta_click"),
    ).toBe(true);
    expect(existsSync(outAbs)).toBe(true);
    const yaml = readFileSync(outAbs, "utf8");
    expect(yaml).toMatch(/data-analytics-id/);

    const journey = loadJourney(outAbs, process.cwd());
    journey.baseUrl = baseUrl;

    const runResult = await runJourneyWithConfig(journey, config);
    expect(runResult.error).toBeUndefined();
    expect(runResult.pass).toBe(true);
    expect(runResult.events.some((e) => e.eventName === "page_view")).toBe(
      true,
    );
    expect(runResult.events.some((e) => e.eventName === "cta_click")).toBe(
      true,
    );
  }, 120_000);

  it("exits 1 with Missing when plan has a nonexistent event", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "record-demo-miss-"));
    const planAbs = join(outDir, "incomplete.csv");
    const outAbs = join(outDir, "incomplete.yaml");
    writeFileSync(planAbs, INCOMPLETE_PLAN, "utf8");
    const logs: string[] = [];
    const config = sessionConfig();

    const result = await runRecord(
      {
        startUrl: `${baseUrl}/`,
        planPath: planAbs,
        name: "incomplete",
        adapters: ["snowplow"],
        outPath: outAbs,
        baseUrl,
        overwrite: true,
        force: false,
        allowIncomplete: false,
        includeUnplanned: false,
        cwd: process.cwd(),
        autoStop: true,
        headless: true,
      },
      config,
      {
        captureSession: captureDemoSession,
        log: (m) => logs.push(m),
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.coverage?.missing.some((r) => r.eventName === "never_fires")).toBe(
      true,
    );
    const summary = logs.join("\n");
    expect(summary).toMatch(/missing/i);
    expect(summary).toMatch(/never_fires/);
  }, 120_000);
});
