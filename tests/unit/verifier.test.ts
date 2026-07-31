import { describe, it, expect } from "vitest";
import {
  verifyEvents,
  isDeepSubset,
  findMatchingEvent,
} from "../../src/verify/EventVerifier.js";
import type { NormalizedEvent } from "../../src/normalize/types.js";

function ev(
  eventName: string,
  properties: Record<string, unknown> = {},
  fields?: Record<string, unknown>,
): NormalizedEvent {
  return {
    platform: "test",
    eventName,
    properties,
    fields: fields ?? { ...properties },
    raw: { url: "https://x", method: "GET", payload: {} },
  };
}

describe("isDeepSubset", () => {
  it("matches nested partial objects", () => {
    expect(isDeepSubset({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2, d: 3 }, e: 4 })).toBe(true);
  });

  it("fails on mismatch", () => {
    expect(isDeepSubset({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("soft-matches number and canonical numeric string", () => {
    expect(isDeepSubset(450, "450")).toBe(true);
    expect(isDeepSubset("450", 450)).toBe(true);
    expect(isDeepSubset({ product_id: 450 }, { product_id: "450" })).toBe(true);
  });

  it("rejects non-canonical numeric strings", () => {
    expect(isDeepSubset(450, "450px")).toBe(false);
    expect(isDeepSubset(450, "")).toBe(false);
    expect(isDeepSubset(450, "0450")).toBe(false);
  });
});

describe("verifyEvents", () => {
  it("passes unordered partial match by default", () => {
    const result = verifyEvents(
      [ev("b", { x: 1, y: 2 }), ev("a", { p: true })],
      [
        { eventName: "a", properties: { p: true } },
        { eventName: "b", properties: { x: 1 } },
      ],
    );
    expect(result.pass).toBe(true);
    expect(result.matched).toHaveLength(2);
    expect(result.missing).toHaveLength(0);
  });

  it("reports missing events", () => {
    const result = verifyEvents([ev("a")], [{ eventName: "b" }]);
    expect(result.pass).toBe(false);
    expect(result.missing).toEqual([{ expected: { eventName: "b" } }]);
  });

  it("attaches near-miss for same eventName with property diffs", () => {
    const actual = ev("click", { page: "other", element: "cta" });
    const result = verifyEvents(
      [actual],
      [{ eventName: "click", properties: { page: "home", element: "cta" } }],
    );
    expect(result.pass).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]!.nearMiss?.actual).toBe(actual);
    expect(result.missing[0]!.nearMiss?.diff).toMatch(/properties\.page/);
  });

  it("fails when expect is empty (no vacuous PASS)", () => {
    const result = verifyEvents([ev("a")], []);
    expect(result.pass).toBe(false);
    expect(result.matched).toHaveLength(0);
  });

  it("does not double-match the same captured event", () => {
    const result = verifyEvents(
      [ev("click", { id: 1 })],
      [
        { eventName: "click", properties: { id: 1 } },
        { eventName: "click", properties: { id: 1 } },
      ],
    );
    expect(result.pass).toBe(false);
    expect(result.matched).toHaveLength(1);
    expect(result.missing).toHaveLength(1);
  });

  it("enforces order when ordered: true", () => {
    const fail = verifyEvents(
      [ev("b"), ev("a")],
      [{ eventName: "a" }, { eventName: "b" }],
      { ordered: true },
    );
    expect(fail.pass).toBe(false);

    const ok = verifyEvents(
      [ev("a"), ev("b")],
      [{ eventName: "a" }, { eventName: "b" }],
      { ordered: true },
    );
    expect(ok.pass).toBe(true);
  });

  it("supports exact property match", () => {
    const fail = verifyEvents(
      [ev("a", { x: 1, y: 2 })],
      [{ eventName: "a", properties: { x: 1 } }],
      { match: "exact" },
    );
    expect(fail.pass).toBe(false);

    const ok = verifyEvents(
      [ev("a", { x: 1 })],
      [{ eventName: "a", properties: { x: 1 } }],
      { match: "exact" },
    );
    expect(ok.pass).toBe(true);
  });

  it("flags unexpected when forbidExtra: true", () => {
    const result = verifyEvents(
      [ev("a"), ev("noise")],
      [{ eventName: "a" }],
      { forbidExtra: true },
    );
    expect(result.pass).toBe(false);
    expect(result.unexpected.map((e) => e.eventName)).toEqual(["noise"]);
  });

  it("matches fields against flattened bag (subset)", () => {
    const result = verifyEvents(
      [ev("banner", { page: "product_page" }, { page: "product_page", product_id: 179 })],
      [{ eventName: "banner", fields: { product_id: 179 } }],
    );
    expect(result.pass).toBe(true);
  });

  it("fails when fields value is missing from flattened bag", () => {
    const result = verifyEvents(
      [ev("banner", { page: "product_page" })],
      [{ eventName: "banner", fields: { product_id: 179 } }],
    );
    expect(result.pass).toBe(false);
    expect(result.missing).toHaveLength(1);
  });

  it("requires both properties and fields when both are set", () => {
    const ok = verifyEvents(
      [ev("banner", { page: "product_page" }, { page: "product_page", product_id: 179 })],
      [
        {
          eventName: "banner",
          properties: { page: "product_page" },
          fields: { product_id: 179 },
        },
      ],
    );
    expect(ok.pass).toBe(true);

    const failProps = verifyEvents(
      [ev("banner", { page: "other" }, { page: "other", product_id: 179 })],
      [
        {
          eventName: "banner",
          properties: { page: "product_page" },
          fields: { product_id: 179 },
        },
      ],
    );
    expect(failProps.pass).toBe(false);

    const failFields = verifyEvents(
      [ev("banner", { page: "product_page" }, { page: "product_page", product_id: 1 })],
      [
        {
          eventName: "banner",
          properties: { page: "product_page" },
          fields: { product_id: 179 },
        },
      ],
    );
    expect(failFields.pass).toBe(false);
  });

  it("fields matching ignores match: exact (always subset)", () => {
    const result = verifyEvents(
      [
        ev(
          "a",
          { x: 1 },
          { x: 1, product_id: 179, "product_context.product_id": 179 },
        ),
      ],
      [{ eventName: "a", properties: { x: 1 }, fields: { product_id: 179 } }],
      { match: "exact" },
    );
    expect(result.pass).toBe(true);
  });

  it("soft-matches numeric fields string vs number", () => {
    const result = verifyEvents(
      [ev("banner", {}, { product_id: "450" })],
      [{ eventName: "banner", fields: { product_id: 450 } }],
    );
    expect(result.pass).toBe(true);
  });
});

describe("findMatchingEvent", () => {
  it("ignores events before fromIndex and returns index", () => {
    const events = [ev("click", { id: 1 }), ev("click", { id: 2 })];
    const found = findMatchingEvent(events, { eventName: "click" }, "partial", 1);
    expect(found?.event.properties.id).toBe(2);
    expect(found?.index).toBe(1);
  });

  it("returns undefined when only prior events match", () => {
    const events = [ev("click", { id: 1 })];
    expect(findMatchingEvent(events, { eventName: "click" }, "partial", 1)).toBeUndefined();
  });
});
