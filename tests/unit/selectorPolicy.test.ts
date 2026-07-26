import { describe, it, expect } from "vitest";
import {
  resolveSelector,
  isDynamicLookingId,
} from "../../src/record/selectorPolicy.js";

describe("isDynamicLookingId", () => {
  it("flags hex/uuid-like ids", () => {
    expect(isDynamicLookingId("a1b2c3d4")).toBe(true);
    expect(isDynamicLookingId("A1B2-C3D4-E5F6")).toBe(true);
  });

  it("flags ids containing ember or react", () => {
    expect(isDynamicLookingId("ember123")).toBe(true);
    expect(isDynamicLookingId("react-root")).toBe(true);
  });

  it("flags ids ending in long numeric suffixes", () => {
    expect(isDynamicLookingId("item-12345678")).toBe(true);
    expect(isDynamicLookingId("btn12345")).toBe(true);
  });

  it("accepts stable-looking ids", () => {
    expect(isDynamicLookingId("submit-btn")).toBe(false);
    expect(isDynamicLookingId("checkout-form")).toBe(false);
    expect(isDynamicLookingId("btn-1")).toBe(false);
  });
});

describe("resolveSelector", () => {
  it("prefers data-analytics-id over other sources", () => {
    expect(
      resolveSelector({
        tagName: "BUTTON",
        id: "submit-btn",
        attributes: {
          "data-analytics-id": "checkout-submit",
          "data-testid": "submit",
        },
      }),
    ).toEqual({
      selector: '[data-analytics-id="checkout-submit"]',
      fragile: false,
      source: "data-analytics-id",
    });
  });

  it("falls back to data-testid when analytics-id is absent", () => {
    expect(
      resolveSelector({
        tagName: "BUTTON",
        attributes: { "data-testid": "submit" },
      }),
    ).toEqual({
      selector: '[data-testid="submit"]',
      fragile: false,
      source: "data-testid",
    });
  });

  it("reorders attribute prefs when prefer is supplied", () => {
    expect(
      resolveSelector(
        {
          tagName: "BUTTON",
          attributes: {
            "data-analytics-id": "checkout-submit",
            "data-testid": "submit",
          },
        },
        ["data-testid", "data-analytics-id"],
      ),
    ).toEqual({
      selector: '[data-testid="submit"]',
      fragile: false,
      source: "data-testid",
    });
  });

  it("uses stable id when attribute prefs are absent", () => {
    expect(
      resolveSelector({
        tagName: "BUTTON",
        id: "submit-btn",
        attributes: {},
      }),
    ).toEqual({
      selector: "#submit-btn",
      fragile: false,
      source: "id",
    });
  });

  it("rejects dynamic-looking ids and falls back to fragile css", () => {
    expect(
      resolveSelector({
        tagName: "BUTTON",
        id: "a1b2c3d4e5f6",
        attributes: { class: "primary" },
      }),
    ).toEqual({
      selector: "button.primary",
      fragile: true,
      source: "css",
    });
  });

  it("emits fragile css path when no stable source exists", () => {
    expect(
      resolveSelector({
        tagName: "INPUT",
        attributes: { type: "email", class: "field" },
      }),
    ).toEqual({
      selector: 'input[type="email"]',
      fragile: true,
      source: "css",
    });
  });

  it("skips role/name selectors in v1 even when present", () => {
    expect(
      resolveSelector({
        tagName: "BUTTON",
        role: "button",
        accessibleName: "Submit",
        id: "submit-btn",
        attributes: {},
      }),
    ).toEqual({
      selector: "#submit-btn",
      fragile: false,
      source: "id",
    });
  });

  it("ignores empty attribute values and continues down the ladder", () => {
    expect(
      resolveSelector({
        tagName: "BUTTON",
        id: "submit-btn",
        attributes: {
          "data-analytics-id": "",
          "data-testid": "",
        },
      }),
    ).toEqual({
      selector: "#submit-btn",
      fragile: false,
      source: "id",
    });
  });
});
