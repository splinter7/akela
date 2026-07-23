import { describe, it, expect } from "vitest";
import { AdapterRegistry } from "../../src/adapters/registry.js";
import type { AnalyticsAdapter } from "../../src/adapters/types.js";
import type { CapturedRequest, NormalizedEvent } from "../../src/normalize/types.js";

function fakeAdapter(name: string, matchUrlPart: string): AnalyticsAdapter {
  return {
    name,
    matches(req) {
      return req.url.includes(matchUrlPart);
    },
    parse(req): NormalizedEvent[] {
      return [
        {
          platform: name,
          eventName: "fake_event",
          properties: { url: req.url },
          fields: { url: req.url },
          raw: { url: req.url, method: req.method, payload: null },
        },
      ];
    },
  };
}

describe("AdapterRegistry", () => {
  it("parses with the first matching selected adapter", () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter("a", "/a/"));
    registry.register(fakeAdapter("b", "/b/"));

    const req: CapturedRequest = {
      url: "https://example.com/b/collect",
      method: "GET",
      headers: {},
      timestamp: Date.now(),
    };

    const { events } = registry.parseRequest(req, ["a", "b"]);
    expect(events).toHaveLength(1);
    expect(events[0]!.platform).toBe("b");
  });

  it("returns empty when no adapter matches", () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter("a", "/a/"));
    const req: CapturedRequest = {
      url: "https://example.com/other",
      method: "GET",
      headers: {},
      timestamp: Date.now(),
    };
    expect(registry.parseRequest(req, ["a"])).toEqual({ events: [], warnings: [] });
  });

  it("throws on unknown adapter name", () => {
    const registry = new AdapterRegistry();
    const req: CapturedRequest = {
      url: "https://example.com/x",
      method: "GET",
      headers: {},
      timestamp: Date.now(),
    };
    expect(() => registry.parseRequest(req, ["missing"])).toThrow(/Unknown adapter/);
  });

  it("assertKnown throws for unregistered adapters", () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter("snowplow", "/i"));
    expect(() => registry.assertKnown(["snowplow"])).not.toThrow();
    expect(() => registry.assertKnown(["missing"])).toThrow(/Unknown adapter: missing/);
  });

  it("warns when adapter matches but postData is empty and parse returns []", () => {
    const registry = new AdapterRegistry();
    registry.register({
      name: "empty",
      matches: () => true,
      parse: () => [],
    });
    const req: CapturedRequest = {
      url: "https://collector.example/i",
      method: "POST",
      postData: "",
      headers: {},
      timestamp: Date.now(),
    };
    const result = registry.parseRequest(req, ["empty"]);
    expect(result.events).toEqual([]);
    expect(result.warnings[0]).toMatch(/empty\/missing postData/);
  });

  it("returns parse failure as warning instead of throwing", () => {
    const registry = new AdapterRegistry();
    registry.register({
      name: "boom",
      matches: () => true,
      parse: () => {
        throw new Error("bad payload");
      },
    });
    const req: CapturedRequest = {
      url: "https://collector.example/i",
      method: "POST",
      postData: "{}",
      headers: {},
      timestamp: Date.now(),
    };
    const result = registry.parseRequest(req, ["boom"]);
    expect(result.events).toEqual([]);
    expect(result.warnings[0]).toMatch(/bad payload/);
  });
});
