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
  <div id="scroll-region" style="max-height:80px;overflow:auto;border:1px solid #000">
    <div style="height:400px">Tall content</div>
    <p id="scroll-end">End of list</p>
  </div>
  <div style="height:1200px">Page spacer for window scroll</div>
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

  it("records scroll on a scrollable region and page scroll without a selector", async () => {
    const session = new RecorderSession({
      startUrl,
      adapters: ["snowplow"],
      config: config(),
      headless: true,
    });

    await session.start();
    const page = session.getPage();

    await page.locator("#scroll-region").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    // Debounce window so a burst collapses to one recorded scroll.
    await page.waitForTimeout(400);

    await page.evaluate(() => {
      window.scrollBy(0, 600);
    });
    await page.waitForTimeout(400);

    const result = await session.stop();

    expect(result.steps).toContainEqual({
      action: "scroll",
      selector: "#scroll-region",
    });
    expect(result.steps).toContainEqual({ action: "scroll" });
  }, 60_000);

  it("does not record a page scroll when only a region scrolls", async () => {
    const session = new RecorderSession({
      startUrl,
      adapters: ["snowplow"],
      config: config(),
      headless: true,
    });

    await session.start();
    const page = session.getPage();

    await page.locator("#scroll-region").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(400);

    const result = await session.stop();
    const scrolls = result.steps.filter((s) => s.action === "scroll");

    expect(scrolls).toEqual([{ action: "scroll", selector: "#scroll-region" }]);
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
