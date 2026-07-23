import { describe, it, expect } from "vitest";
import type { PlanRow } from "../../src/plan/parsePlanCsv.js";
import type { NormalizedEvent } from "../../src/normalize/types.js";
import {
  computePlanCoverage,
  formatPlanCoverageSummary,
} from "../../src/record/planCoverage.js";

function event(
  eventName: string,
  properties: Record<string, unknown> = {},
  fields: Record<string, unknown> = {},
): NormalizedEvent {
  return {
    platform: "snowplow",
    eventName,
    properties,
    fields,
    raw: { url: "https://example.com/t", method: "POST", payload: {} },
  };
}

function row(
  eventName: string,
  overrides: Partial<Omit<PlanRow, "eventName" | "trigger">> = {},
): PlanRow {
  return {
    eventName,
    trigger: "click",
    selector: "#btn",
    ...overrides,
  };
}

describe("computePlanCoverage", () => {
  it("matches plan rows to captured events by name and property subset", () => {
    const rows = [
      row("page_view"),
      row("checkout_submit", { properties: { currency: "USD" } }),
    ];
    const captured = [
      event("page_view", { page: "/home" }),
      event("checkout_submit", { currency: "USD", amount: 99 }),
    ];

    const coverage = computePlanCoverage(rows, captured);

    expect(coverage.matched).toHaveLength(2);
    expect(coverage.matched[0]).toEqual({
      row: rows[0],
      actual: captured[0],
    });
    expect(coverage.matched[1]).toEqual({
      row: rows[1],
      actual: captured[1],
    });
    expect(coverage.missing).toEqual([]);
    expect(coverage.unexpected).toEqual([]);
  });

  it("marks rows missing when required properties are not a subset of capture", () => {
    const rows = [
      row("checkout_submit", { properties: { currency: "USD", amount: 100 } }),
    ];
    const captured = [event("checkout_submit", { currency: "USD", amount: 99 })];

    const coverage = computePlanCoverage(rows, captured);

    expect(coverage.matched).toEqual([]);
    expect(coverage.missing).toEqual([rows[0]]);
    expect(coverage.unexpected).toEqual([]);
  });

  it("lists unexpected captured events not required by any plan row", () => {
    const rows = [row("page_view")];
    const captured = [
      event("page_view"),
      event("debug_event", { source: "dev" }),
    ];

    const coverage = computePlanCoverage(rows, captured);

    expect(coverage.matched).toHaveLength(1);
    expect(coverage.missing).toEqual([]);
    expect(coverage.unexpected).toEqual([captured[1]]);
  });

  it("filters default noise events from unexpected", () => {
    const rows = [row("page_view")];
    const captured = [event("page_view"), event("page_ping")];

    const coverage = computePlanCoverage(rows, captured);

    expect(coverage.unexpected).toEqual([]);
  });

  it("consumes each captured event at most once across plan rows", () => {
    const rows = [row("signup"), row("signup")];
    const captured = [event("signup", { step: 1 })];

    const coverage = computePlanCoverage(rows, captured);

    expect(coverage.matched).toHaveLength(1);
    expect(coverage.matched[0]!.actual).toBe(captured[0]);
    expect(coverage.missing).toEqual([rows[1]]);
    expect(coverage.unexpected).toEqual([]);
  });

  it("does not reuse a captured index via forward scan past a non-match", () => {
    const rows = [row("signup"), row("signup")];
    const captured = [event("page_view"), event("signup", { step: 1 })];

    const coverage = computePlanCoverage(rows, captured);

    expect(coverage.matched).toHaveLength(1);
    expect(coverage.matched[0]!.actual).toBe(captured[1]);
    expect(coverage.missing).toEqual([rows[1]]);
    expect(coverage.unexpected).toEqual([captured[0]]);
  });

  it("matches plan rows to captured events by name and field subset", () => {
    const rows = [row("checkout_submit", { fields: { currency: "USD" } })];
    const captured = [
      event("checkout_submit", {}, { currency: "USD", amount: 99 }),
    ];

    const coverage = computePlanCoverage(rows, captured);

    expect(coverage.matched).toHaveLength(1);
    expect(coverage.matched[0]).toEqual({
      row: rows[0],
      actual: captured[0],
    });
    expect(coverage.missing).toEqual([]);
    expect(coverage.unexpected).toEqual([]);
  });
});

describe("formatPlanCoverageSummary", () => {
  it("formats matched, missing, unexpected, and fragile selector counts", () => {
    const rows = [
      row("page_view"),
      row("checkout_submit", { properties: { currency: "USD" } }),
    ];
    const captured = [
      event("page_view"),
      event("checkout_submit", { currency: "EUR" }),
      event("debug_event"),
    ];
    const coverage = computePlanCoverage(rows, captured);

    const summary = formatPlanCoverageSummary(coverage, 1);

    expect(summary).toBe(
      [
        "Plan coverage: 1 matched, 1 missing, 1 unexpected",
        "  Missing: checkout_submit (properties.currency)",
        "  Unexpected: debug_event",
        "Fragile selectors: 1",
      ].join("\n"),
    );
  });
});
