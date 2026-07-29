import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, existsSync, rmSync } from "node:fs";

const storageStateFn = vi.fn(async ({ path }: { path: string }) => {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path, JSON.stringify({ cookies: [], origins: [] }), "utf8");
});

const mockPage = {
  goto: vi.fn(async () => {}),
  context: () => ({ storageState: storageStateFn }),
  screenshot: vi.fn(async () => Buffer.from("x")),
};
const mockContext = { newPage: vi.fn(async () => mockPage) };
const mockBrowser = {
  newContext: vi.fn(async () => mockContext),
  close: vi.fn(async () => {}),
};

vi.mock("playwright", () => ({
  chromium: { launch: vi.fn(async () => mockBrowser) },
}));

import { runAuthJourneyWithConfig } from "../../src/runner/JourneyRunner.js";
import type { Journey, AppConfig } from "../../src/normalize/types.js";

const config: AppConfig = { headless: true, baseUrl: "http://example.com" };

const tempDirs: string[] = [];

function authJourney(over: Partial<Journey> = {}): Journey {
  return {
    name: "login",
    adapters: ["snowplow"],
    expect: [],
    steps: [
      { action: "goto", path: "/login" },
      { action: "saveStorageState", path: ".auth/out.json" },
    ],
    ...over,
  };
}

describe("runAuthJourneyWithConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes storage state and passes without verification", async () => {
    const cwd = join(tmpdir(), `at-auth-${Date.now()}`);
    tempDirs.push(cwd);
    mkdirSync(cwd, { recursive: true });
    const result = await runAuthJourneyWithConfig(
      authJourney(),
      config,
      cwd,
      { headless: true },
    );
    expect(result.pass).toBe(true);
    expect(result.storageStatePaths[0]).toBe(join(cwd, ".auth/out.json"));
    expect(existsSync(result.storageStatePaths[0]!)).toBe(true);
    expect(mockBrowser.newContext).toHaveBeenCalledWith({});
  });

  it("defaults to headed when headless option omitted", async () => {
    const { chromium } = await import("playwright");
    await runAuthJourneyWithConfig(authJourney(), config, process.cwd(), {});
    expect(chromium.launch).toHaveBeenCalledWith({ headless: false });
  });

  it("writes a failure screenshot when a step fails", async () => {
    const cwd = join(tmpdir(), `at-auth-shot-${Date.now()}`);
    tempDirs.push(cwd);
    mkdirSync(cwd, { recursive: true });
    mockPage.goto.mockRejectedValueOnce(new Error("nav failed"));

    const result = await runAuthJourneyWithConfig(
      authJourney(),
      { ...config, reportDir: "reports" },
      cwd,
      { headless: true },
    );

    expect(result.pass).toBe(false);
    expect(mockPage.screenshot).toHaveBeenCalled();
    expect(result.screenshotPath).toBe(join(cwd, "reports", "auth-failure.png"));
    expect(existsSync(result.screenshotPath!)).toBe(true);
  });

  it("does not screenshot on success", async () => {
    const cwd = join(tmpdir(), `at-auth-ok-${Date.now()}`);
    tempDirs.push(cwd);
    mkdirSync(cwd, { recursive: true });

    const result = await runAuthJourneyWithConfig(authJourney(), config, cwd, {
      headless: true,
    });

    expect(result.pass).toBe(true);
    expect(result.screenshotPath).toBeUndefined();
    expect(mockPage.screenshot).not.toHaveBeenCalled();
  });

  it("fails when saveStorageState never runs (all steps skipped)", async () => {
    // Force goto to throw so save never runs:
    mockPage.goto.mockRejectedValueOnce(new Error("nav failed"));
    const result = await runAuthJourneyWithConfig(
      authJourney(),
      config,
      process.cwd(),
      { headless: true },
    );
    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/nav failed/);
    expect(result.storageStatePaths).toEqual([]);
  });
});
