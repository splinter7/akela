import { describe, it, expect, vi, afterEach } from "vitest";
import type { Page, Route, Request } from "playwright";
import { NetworkCapture } from "../../src/capture/NetworkCapture.js";
import { AdapterRegistry } from "../../src/adapters/registry.js";

describe("NetworkCapture", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("route handler continues and records warning when adapter is unknown", async () => {
    const registry = new AdapterRegistry();
    const capture = new NetworkCapture(registry, ["missing"]);

    let routeHandler!: (route: Route) => Promise<void>;
    const page = {
      route: vi.fn(async (_pattern: string, handler: (route: Route) => Promise<void>) => {
        routeHandler = handler;
      }),
    } as unknown as Page;

    await capture.attach(page);

    const continueFn = vi.fn().mockResolvedValue(undefined);
    const request = {
      url: () => "https://example.com/i",
      method: () => "GET",
      postData: () => null,
      headers: () => ({}),
    } as unknown as Request;

    const route = {
      request: () => request,
      continue: continueFn,
    } as unknown as Route;

    await expect(routeHandler(route)).resolves.toBeUndefined();
    expect(continueFn).toHaveBeenCalled();
    expect(capture.getWarnings().some((w) => /Unknown adapter/.test(w))).toBe(true);
    expect(capture.getEvents()).toEqual([]);
  });

  it("records warning when matched adapter returns no events with empty body", async () => {
    const registry = new AdapterRegistry();
    registry.register({
      name: "snowplow",
      matches: () => true,
      parse: () => [],
    });
    const progress: string[] = [];
    const capture = new NetworkCapture(registry, ["snowplow"], {
      onProgress: (m) => progress.push(m),
    });

    let routeHandler!: (route: Route) => Promise<void>;
    const page = {
      route: vi.fn(async (_pattern: string, handler: (route: Route) => Promise<void>) => {
        routeHandler = handler;
      }),
    } as unknown as Page;

    await capture.attach(page);

    const route = {
      request: () =>
        ({
          url: () => "https://collector/i",
          method: () => "POST",
          postData: () => null,
          headers: () => ({}),
        }) as unknown as Request,
      continue: vi.fn().mockResolvedValue(undefined),
    } as unknown as Route;

    await routeHandler(route);
    expect(capture.getWarnings()[0]).toMatch(/empty\/missing postData/);
    expect(progress.some((p) => /capture warning/.test(p))).toBe(true);
  });
});
