import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AppConfig } from "../../src/normalize/types.js";
import { RecorderSession } from "../../src/record/RecorderSession.js";

const FIXTURE_HTML = `<!DOCTYPE html>
<html>
<head><title>recorder fixture</title></head>
<body>
  <button data-analytics-id="demo-cta" id="cta">CTA</button>
  <button class="orphan-btn">Fragile</button>
  <label>Email <input id="email" name="email" type="text" /></label>
  <label>Password <input id="secret" name="password" type="password" /></label>
</body>
</html>`;

describe("RecorderSession", () => {
  let server: Server;
  let startUrl: string;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(FIXTURE_HTML);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });

    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Failed to bind fixture server");
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
    startUrl = `${baseUrl}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  function config(overrides: Partial<AppConfig> = {}): AppConfig {
    return {
      baseUrl,
      headless: true,
      quietMs: 50,
      quietTimeoutMs: 300,
      ...overrides,
    };
  }

  it("records goto, stable click, fill, and fragile click", async () => {
    const session = new RecorderSession({
      startUrl,
      adapters: ["snowplow"],
      config: config(),
      headless: true,
    });

    await session.start();
    const page = session.getPage();

    await page.click('[data-analytics-id="demo-cta"]');
    await page.fill("#email", "user@example.com");
    await page.locator("#email").blur();
    await page.click(".orphan-btn");

    const result = await session.stop();

    expect(result.steps[0]).toEqual({ action: "goto", path: "/" });
    expect(result.steps).toContainEqual({
      action: "click",
      selector: '[data-analytics-id="demo-cta"]',
    });
    expect(result.steps).toContainEqual({
      action: "fill",
      selector: "#email",
      value: "user@example.com",
    });
    expect(result.steps).toContainEqual({
      action: "click",
      selector: "button.orphan-btn",
    });

    expect(result.fragileCount).toBeGreaterThanOrEqual(1);
    expect(result.actionTimestamps).toHaveLength(result.steps.length);
    expect(result.events).toEqual([]);
  }, 60_000);

  it("warns when recording password-like fills but still records the value", async () => {
    const session = new RecorderSession({
      startUrl,
      adapters: ["snowplow"],
      config: config(),
      headless: true,
    });

    await session.start();
    const page = session.getPage();

    await page.fill("#secret", "super-secret");
    await page.locator("#secret").blur();

    const result = await session.stop();

    expect(result.steps).toContainEqual({
      action: "fill",
      selector: "#secret",
      value: "super-secret",
    });
    expect(result.warnings.some((w) => /password|secret|auth|storageState/i.test(w))).toBe(
      true,
    );
  }, 60_000);
});
