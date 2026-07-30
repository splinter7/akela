import { describe, it, expect, vi, afterEach } from "vitest";
import type { Page } from "playwright";
import { executeStep } from "../../src/runner/steps.js";
import type { NetworkCapture } from "../../src/capture/NetworkCapture.js";

const capture = { getEvents: () => [] } as unknown as NetworkCapture;

function mockPage(
  waitForFunction = vi.fn().mockResolvedValue(undefined),
): { page: Page; waitForFunction: ReturnType<typeof vi.fn> } {
  const page = { waitForFunction } as unknown as Page;
  return { page, waitForFunction };
}

/** Runs the browser-side predicate against a stubbed document. */
function runPredicate(
  predicate: (selector: string) => boolean,
  selector: string,
  element: Record<string, unknown> | null,
): boolean {
  const original = globalThis.document;
  globalThis.document = {
    querySelector: (q: string) => (q === selector ? element : null),
  } as unknown as Document;
  try {
    return predicate(selector);
  } finally {
    globalThis.document = original;
  }
}

describe("waitForHydrated step", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("waits on the selector with the given timeout", async () => {
    const { page, waitForFunction } = mockPage();

    const result = await executeStep(
      page,
      {
        action: "waitForHydrated",
        selector: "[data-testid=submit]",
        timeoutMs: 9000,
      },
      "http://localhost",
      capture,
    );

    expect(result.status).toBe("ran");
    expect(waitForFunction).toHaveBeenCalledTimes(1);
    const [, arg, options] = waitForFunction.mock.calls[0]!;
    expect(arg).toBe("[data-testid=submit]");
    expect(options).toEqual({ timeout: 9000 });
  });

  it("defaults the timeout to 15000ms", async () => {
    const { page, waitForFunction } = mockPage();

    await executeStep(
      page,
      { action: "waitForHydrated", selector: "#submit" },
      "http://localhost",
      capture,
    );

    const [, , options] = waitForFunction.mock.calls[0]!;
    expect(options).toEqual({ timeout: 15000 });
  });

  it("predicate is false for server-rendered HTML and true once React attaches", async () => {
    const { page, waitForFunction } = mockPage();

    await executeStep(
      page,
      { action: "waitForHydrated", selector: "#submit" },
      "http://localhost",
      capture,
    );

    const predicate = waitForFunction.mock.calls[0]![0] as (
      selector: string,
    ) => boolean;

    // Server-rendered node: present, but no framework keys yet.
    const el: Record<string, unknown> = { id: "submit" };
    expect(runPredicate(predicate, "#submit", el)).toBe(false);

    // React attaches __reactProps$<hash> / __reactFiber$<hash> on hydration.
    el["__reactProps$k1x2"] = {};
    expect(runPredicate(predicate, "#submit", el)).toBe(true);
  });

  it("predicate is false when the element is absent", async () => {
    const { page, waitForFunction } = mockPage();

    await executeStep(
      page,
      { action: "waitForHydrated", selector: "#submit" },
      "http://localhost",
      capture,
    );

    const predicate = waitForFunction.mock.calls[0]![0] as (
      selector: string,
    ) => boolean;

    expect(runPredicate(predicate, "#submit", null)).toBe(false);
  });

  it("fails with a hydration-specific error when handlers never attach", async () => {
    const { page } = mockPage(
      vi.fn().mockRejectedValue(new Error("Timeout 15000ms exceeded")),
    );

    await expect(
      executeStep(
        page,
        { action: "waitForHydrated", selector: "[data-testid=submit]" },
        "http://localhost",
        capture,
      ),
    ).rejects.toThrow(
      /waitForHydrated timed out after 15000ms.*\[data-testid=submit\]/s,
    );
  });
});
