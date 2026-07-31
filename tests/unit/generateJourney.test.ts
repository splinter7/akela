import { describe, it, expect } from "vitest";
import { generateJourneyYaml } from "../../src/plan/generateJourney.js";
import type { PlanRow } from "../../src/plan/parsePlanCsv.js";
import { parse as parseYaml } from "yaml";
import type { Journey } from "../../src/normalize/types.js";

describe("generateJourneyYaml", () => {
  it("maps page_load, click, and fill rows into steps and expect", () => {
    const rows: PlanRow[] = [
      {
        eventName: "page_view",
        trigger: "page_load",
        path: "/",
        properties: { page: "home" },
        notes: "Home page load",
      },
      {
        eventName: "cta_click",
        trigger: "click",
        selector: "#cta",
        properties: { button_id: "cta" },
      },
      {
        eventName: "email_filled",
        trigger: "fill",
        selector: "#email",
        value: "user@example.com",
      },
    ];

    const yamlText = generateJourneyYaml(rows, {
      name: "demo",
      adapters: ["snowplow"],
    });

    expect(yamlText).toContain("# Home page load");

    const journey = parseYaml(yamlText) as Journey;
    expect(journey.name).toBe("demo");
    expect(journey.adapters).toEqual(["snowplow"]);
    expect(journey.options).toEqual({
      ordered: true,
      match: "partial",
      forbidExtra: false,
    });
    expect(journey.steps).toEqual([
      { action: "goto", path: "/" },
      {
        action: "waitForEvent",
        eventName: "page_view",
        timeoutMs: 5000,
        properties: { page: "home" },
      },
      { action: "click", selector: "#cta" },
      {
        action: "waitForEvent",
        eventName: "cta_click",
        timeoutMs: 5000,
        properties: { button_id: "cta" },
      },
      { action: "fill", selector: "#email", value: "user@example.com" },
      { action: "waitForEvent", eventName: "email_filled", timeoutMs: 5000 },
    ]);
    expect(journey.expect).toEqual([
      { eventName: "page_view", properties: { page: "home" } },
      { eventName: "cta_click", properties: { button_id: "cta" } },
      { eventName: "email_filled" },
    ]);
  });

  it("maps fields into waitForEvent and expect", () => {
    const rows: PlanRow[] = [
      {
        eventName: "banner_shown",
        trigger: "page_load",
        path: "/details",
        properties: { page: "product_page" },
        fields: { product_id: 179 },
      },
    ];
    const yamlText = generateJourneyYaml(rows, { name: "promo" });
    const journey = parseYaml(yamlText) as Journey;
    expect(journey.steps).toContainEqual({
      action: "waitForEvent",
      eventName: "banner_shown",
      timeoutMs: 5000,
      properties: { page: "product_page" },
      fields: { product_id: 179 },
    });
    expect(journey.expect).toEqual([
      {
        eventName: "banner_shown",
        properties: { page: "product_page" },
        fields: { product_id: 179 },
      },
    ]);
  });

  it("maps scroll trigger to scroll step without inventing selector", () => {
    const rows: PlanRow[] = [
      { eventName: "list_scrolled", trigger: "scroll" },
      { eventName: "list_scrolled", trigger: "scroll", selector: "#feed" },
    ];
    const yamlText = generateJourneyYaml(rows, { name: "scroll-demo" });
    const journey = parseYaml(yamlText) as Journey;
    expect(journey.steps).toContainEqual({ action: "scroll" });
    expect(journey.steps).toContainEqual({ action: "scroll", selector: "#feed" });
    expect(journey.steps).toContainEqual({
      action: "waitForEvent",
      eventName: "list_scrolled",
      timeoutMs: 5000,
    });
  });

  it("uses TODO placeholder selectors when selector is missing", () => {
    const rows: PlanRow[] = [
      { eventName: "cta_click", trigger: "click" },
      { eventName: "email_filled", trigger: "fill", value: "x@y.com" },
    ];

    const yamlText = generateJourneyYaml(rows, { name: "checkout" });
    const journey = parseYaml(yamlText) as Journey;

    expect(journey.steps).toContainEqual({
      action: "click",
      selector: "#TODO-cta-click",
    });
    expect(journey.steps).toContainEqual({
      action: "fill",
      selector: "#TODO-email-filled",
      value: "x@y.com",
    });
  });

  it("includes baseUrl when provided", () => {
    const yamlText = generateJourneyYaml(
      [{ eventName: "page_view", trigger: "page_load", path: "/x" }],
      { name: "x", baseUrl: "https://staging.example.com" },
    );
    const journey = parseYaml(yamlText) as Journey;
    expect(journey.baseUrl).toBe("https://staging.example.com");
  });

  it("omits baseUrl when not provided", () => {
    const yamlText = generateJourneyYaml(
      [{ eventName: "page_view", trigger: "page_load", path: "/x" }],
      { name: "x" },
    );
    expect(yamlText).not.toMatch(/^baseUrl:/m);
  });
});
