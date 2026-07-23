import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadJourney } from "../../src/journey/loadJourney.js";
import { loadConfig } from "../../src/config/loadConfig.js";
import { runJourneyWithConfig } from "../../src/runner/JourneyRunner.js";
import { writeReports } from "../../src/report/writeReports.js";

const demoDir = join(process.cwd(), "demo");

describe("demo journey integration", () => {
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

  it("passes journeys/demo.yaml against the demo page", async () => {
    const config = loadConfig(process.cwd());
    const journey = loadJourney("journeys/demo.yaml", process.cwd());
    journey.baseUrl = baseUrl;

    const result = await runJourneyWithConfig(journey, config);
    const reports = writeReports(result, join(process.cwd(), "reports"));

    expect(result.error).toBeUndefined();
    expect(result.pass).toBe(true);
    expect(result.events.some((e) => e.eventName === "page_view")).toBe(true);
    expect(result.events.some((e) => e.eventName === "cta_click")).toBe(true);
    expect(existsSync(reports.html)).toBe(true);
    expect(existsSync(reports.json)).toBe(true);
    expect(existsSync(reports.markdown)).toBe(true);
  }, 90_000);
});
