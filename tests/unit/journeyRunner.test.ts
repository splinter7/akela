import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";

const screenshotBuf = Buffer.from("fake-png");
const mockPage = {
  screenshot: vi.fn(async () => screenshotBuf),
  goto: vi.fn(async () => {}),
  click: vi.fn(async () => {
    throw new Error("click failed: #missing");
  }),
  route: vi.fn(async () => {}),
};
const mockContext = {
  newPage: vi.fn(async () => mockPage),
};
const mockBrowser = {
  newContext: vi.fn(async () => mockContext),
  close: vi.fn(async () => {}),
};

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(async () => mockBrowser),
  },
}));

import {
  createDefaultRegistry,
  runJourneyWithConfig,
} from "../../src/runner/JourneyRunner.js";
import type { AppConfig, Journey } from "../../src/normalize/types.js";

const baseConfig: AppConfig = {
  baseUrl: "http://127.0.0.1:4173",
  headless: true,
  reportDir: "reports",
  gotoWaitUntil: "domcontentloaded",
  quietMs: 50,
  quietTimeoutMs: 100,
  snowplow: {
    collectorPatterns: ["/i", "/tp2", "/com.snowplowanalytics.snowplow/tp2"],
  },
};

function minimalJourney(overrides: Partial<Journey> = {}): Journey {
  return {
    name: "failure-path",
    adapters: ["snowplow"],
    steps: [{ action: "goto", path: "/" }],
    expect: [{ eventName: "page_view" }],
    ...overrides,
  };
}

describe("runJourneyWithConfig failure paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPage.click.mockImplementation(async () => {
      throw new Error("click failed: #missing");
    });
    mockPage.screenshot.mockResolvedValue(screenshotBuf);
    mockPage.goto.mockResolvedValue(undefined);
  });

  it("fails before launch when adapter is unknown", async () => {
    const journey = minimalJourney({ adapters: ["not-a-real-adapter"] });
    const result = await runJourneyWithConfig(journey, baseConfig);

    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/Unknown adapter: not-a-real-adapter/);
    expect(result.events).toEqual([]);
  });

  it("fails with clear error when storageState file is missing", async () => {
    const cwd = join(tmpdir(), `analytics-tracker-cwd-${Date.now()}`);
    const rel = "missing-storage-state.json";
    const result = await runJourneyWithConfig(
      minimalJourney({ storageState: rel }),
      baseConfig,
      createDefaultRegistry(baseConfig),
      cwd,
    );

    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/storageState file not found/);
    expect(result.error).toContain(rel);
  });

  it("emits progress messages including verify", async () => {
    const progress: string[] = [];
    const result = await runJourneyWithConfig(
      minimalJourney({ adapters: ["not-a-real-adapter"] }),
      baseConfig,
      undefined,
      process.cwd(),
      { onProgress: (m) => progress.push(m) },
    );

    expect(result.pass).toBe(false);
    expect(progress.some((p) => /error:/.test(p))).toBe(true);
    expect(progress.some((p) => /verifying events/.test(p))).toBe(true);
    expect(progress.some((p) => /verify FAIL/.test(p))).toBe(true);
  });

  it("records failed step in stepLog before rethrowing", async () => {
    const result = await runJourneyWithConfig(
      minimalJourney({
        steps: [
          { action: "goto", path: "/" },
          { action: "click", selector: "#missing", timeoutMs: 10, retries: 0 },
        ],
      }),
      baseConfig,
    );

    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/click failed/);
    expect(result.stepLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "click",
          status: "failed",
          reason: expect.stringMatching(/click failed/),
        }),
      ]),
    );
    expect(result.stepLog.at(-1)?.status).toBe("failed");
  });

  it("captures screenshot on expect-only FAIL", async () => {
    mockPage.click.mockResolvedValue(undefined);
    const result = await runJourneyWithConfig(
      minimalJourney({
        steps: [{ action: "goto", path: "/" }],
        expect: [{ eventName: "never_fires" }],
      }),
      baseConfig,
    );

    expect(result.pass).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.verification.pass).toBe(false);
    expect(result.artifacts?.screenshot).toEqual(screenshotBuf);
    expect(mockPage.screenshot).toHaveBeenCalled();
    expect(mockBrowser.close).toHaveBeenCalled();
  });
});
