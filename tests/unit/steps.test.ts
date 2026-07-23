import { describe, it, expect, vi } from "vitest";
import type { Page, Locator } from "playwright";
import { executeStep } from "../../src/runner/steps.js";
import type { NetworkCapture } from "../../src/capture/NetworkCapture.js";
import type { NormalizedEvent } from "../../src/normalize/types.js";

function mockLocator(overrides: Partial<Locator> = {}): Locator {
  return {
    isVisible: vi.fn().mockResolvedValue(false),
    or: vi.fn(function (this: Locator, other: Locator) {
      return mockLocator({ ...overrides, ...other });
    }),
    first: vi.fn(function (this: Locator) {
      return this;
    }),
    waitFor: vi.fn().mockResolvedValue(undefined),
    waitForSelector: undefined,
    ...overrides,
  } as unknown as Locator;
}

function mockPage(options: {
  /** Selectors that become visible within the when.visible wait. */
  visibleBySelector?: Record<string, boolean>;
  locators?: Map<string, Locator>;
} = {}): Page {
  const locators = options.locators ?? new Map<string, Locator>();
  const visibleBySelector = options.visibleBySelector ?? {};

  return {
    locator: vi.fn((selector: string) => {
      if (locators.has(selector)) return locators.get(selector)!;
      const visible = visibleBySelector[selector] ?? false;
      const loc = mockLocator({
        waitFor: visible
          ? vi.fn().mockResolvedValue(undefined)
          : vi.fn().mockRejectedValue(new Error("Timeout 500ms exceeded")),
        isVisible: vi.fn().mockResolvedValue(visible),
      });
      locators.set(selector, loc);
      return loc;
    }),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForURL: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
  } as unknown as Page;
}

function ev(eventName: string): NormalizedEvent {
  return {
    platform: "test",
    eventName,
    properties: {},
    fields: {},
    raw: { url: "https://x", method: "GET", payload: {} },
  };
}

const capture = {
  getEvents: () => [],
} as unknown as NetworkCapture;

describe("executeStep branching", () => {
  it("skips click when when.visible does not become visible", async () => {
    const page = mockPage({ visibleBySelector: { "#gate": false } });

    const result = await executeStep(
      page,
      {
        action: "click",
        selector: "#btn",
        when: { visible: "#gate" },
      },
      "http://localhost",
      capture,
    );

    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/when\.visible/);
    expect(page.click).not.toHaveBeenCalled();
    const gate = (page.locator as ReturnType<typeof vi.fn>).mock.results[0]
      ?.value as Locator;
    expect(gate.waitFor).toHaveBeenCalledWith({
      state: "visible",
      timeout: 500,
    });
  });

  it("runs click when when.visible becomes visible within timeout", async () => {
    const page = mockPage({ visibleBySelector: { "#gate": true } });

    const result = await executeStep(
      page,
      {
        action: "click",
        selector: "#btn",
        when: { visible: "#gate" },
      },
      "http://localhost",
      capture,
    );

    expect(result.status).toBe("ran");
    expect(page.click).toHaveBeenCalledWith("#btn", {});
    const gate = (page.locator as ReturnType<typeof vi.fn>).mock.results[0]
      ?.value as Locator;
    expect(gate.waitFor).toHaveBeenCalledWith({
      state: "visible",
      timeout: 500,
    });
  });

  it("waitForAny waits on combined locator", async () => {
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const combined = mockLocator({
      first: vi.fn(function (this: Locator) {
        return this;
      }),
      waitFor,
    });
    const a = mockLocator({
      or: vi.fn().mockReturnValue(combined),
    });
    const b = mockLocator();
    const locators = new Map<string, Locator>([
      ["#a", a],
      ["#b", b],
    ]);
    const page = mockPage({ locators });

    await executeStep(
      page,
      {
        action: "waitForAny",
        selectors: ["#a", "#b"],
        timeoutMs: 1234,
      },
      "http://localhost",
      capture,
    );

    expect(page.locator).toHaveBeenCalledWith("#a");
    expect(page.locator).toHaveBeenCalledWith("#b");
    expect(a.or).toHaveBeenCalledWith(b);
    expect(combined.first).toHaveBeenCalled();
    expect(waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 1234 });
  });

  it("waitForAny propagates timeout errors", async () => {
    const waitFor = vi.fn().mockRejectedValue(new Error("Timeout 5000ms exceeded"));
    const combined = mockLocator({
      first: vi.fn(function (this: Locator) {
        return this;
      }),
      waitFor,
    });
    const a = mockLocator({
      or: vi.fn().mockReturnValue(combined),
    });
    const page = mockPage({
      locators: new Map([
        ["#a", a],
        ["#b", mockLocator()],
      ]),
    });

    await expect(
      executeStep(
        page,
        { action: "waitForAny", selectors: ["#a", "#b"] },
        "http://localhost",
        capture,
      ),
    ).rejects.toThrow(/Timeout/);
  });
});

describe("executeStep waitForEvent sinceIndex", () => {
  it("does not resolve on events before eventSinceIndex", async () => {
    vi.useFakeTimers();
    const events = [ev("click")];
    const localCapture = {
      getEvents: () => events,
    } as unknown as NetworkCapture;
    const page = mockPage();

    const pending = executeStep(
      page,
      { action: "waitForEvent", eventName: "click", timeoutMs: 300 },
      "http://localhost",
      localCapture,
      "partial",
      { gotoWaitUntil: "domcontentloaded", eventSinceIndex: 1 },
    );

    const expectation = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(400);
    await expectation;
    vi.useRealTimers();
  });

  it("resolves for events at or after eventSinceIndex (e.g. fired during prior goto)", async () => {
    const events: NormalizedEvent[] = [ev("noise"), ev("click")];
    const localCapture = {
      getEvents: () => events,
    } as unknown as NetworkCapture;
    const page = mockPage();
    const progress: string[] = [];

    await expect(
      executeStep(
        page,
        { action: "waitForEvent", eventName: "click", timeoutMs: 1000 },
        "http://localhost",
        localCapture,
        "partial",
        {
          gotoWaitUntil: "domcontentloaded",
          onProgress: (m) => progress.push(m),
          eventSinceIndex: 1,
        },
      ),
    ).resolves.toEqual({ status: "ran", matchedEventIndex: 1 });
    expect(progress.some((p) => /found event/.test(p))).toBe(true);
  });

  it("does not rematch the same beacon when sinceIndex advances past match", async () => {
    vi.useFakeTimers();
    const events = [ev("click")];
    const localCapture = {
      getEvents: () => events,
    } as unknown as NetworkCapture;
    const page = mockPage();

    const first = await executeStep(
      page,
      { action: "waitForEvent", eventName: "click", timeoutMs: 1000 },
      "http://localhost",
      localCapture,
      "partial",
      { gotoWaitUntil: "domcontentloaded", eventSinceIndex: 0 },
    );
    expect(first).toEqual({ status: "ran", matchedEventIndex: 0 });

    const pending = executeStep(
      page,
      { action: "waitForEvent", eventName: "click", timeoutMs: 300 },
      "http://localhost",
      localCapture,
      "partial",
      {
        gotoWaitUntil: "domcontentloaded",
        eventSinceIndex: first.matchedEventIndex! + 1,
      },
    );
    const expectation = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(400);
    await expectation;
    vi.useRealTimers();
  });
});

describe("executeStep click timeout/retries", () => {
  it("passes timeoutMs to page.click", async () => {
    const page = mockPage();
    await executeStep(
      page,
      { action: "click", selector: "#btn", timeoutMs: 1234 },
      "http://localhost",
      capture,
    );
    expect(page.click).toHaveBeenCalledWith("#btn", { timeout: 1234 });
  });

  it("retries click on failure", async () => {
    const page = mockPage();
    const click = page.click as ReturnType<typeof vi.fn>;
    click
      .mockRejectedValueOnce(new Error("element not found"))
      .mockResolvedValueOnce(undefined);

    const progress: string[] = [];
    await executeStep(
      page,
      { action: "click", selector: "#btn", retries: 1 },
      "http://localhost",
      capture,
      "partial",
      {
        gotoWaitUntil: "domcontentloaded",
        onProgress: (m) => progress.push(m),
      },
    );

    expect(click).toHaveBeenCalledTimes(2);
    expect(progress.some((p) => /retry 1\/1/.test(p))).toBe(true);
  });
});
