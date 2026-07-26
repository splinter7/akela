import { describe, it, expect } from "vitest";
import type { PlanRow } from "../../src/plan/parsePlanCsv.js";
import type { NormalizedEvent, Step } from "../../src/normalize/types.js";
import type { PlanCoverage } from "../../src/record/planCoverage.js";
import {
  buildExpectFromPlan,
  buildExpectExploratory,
  suggestWaitForEventSteps,
} from "../../src/record/expectBuilder.js";

function event(
  eventName: string,
  properties: Record<string, unknown> = {},
  fields: Record<string, unknown> = {},
  timestamp?: string,
): NormalizedEvent {
  return {
    platform: "snowplow",
    eventName,
    ...(timestamp !== undefined ? { timestamp } : {}),
    properties,
    fields,
    raw: { url: "https://example.com/t", method: "POST", payload: {} },
  };
}

function row(
  eventName: string,
  overrides: Partial<Omit<PlanRow, "eventName">> = {},
): PlanRow {
  return {
    eventName,
    trigger: "click",
    selector: "#btn",
    ...overrides,
  };
}

describe("buildExpectFromPlan", () => {
  it("seeds one expect per plan row including missing rows", () => {
    const rows = [
      row("page_view"),
      row("checkout_submit", { properties: { currency: "USD" } }),
    ];
    const coverage: PlanCoverage = {
      matched: [{ row: rows[0]!, actual: event("page_view") }],
      missing: [rows[1]!],
      unexpected: [],
    };

    const expects = buildExpectFromPlan(rows, coverage);

    expect(expects).toEqual([
      { eventName: "page_view" },
      { eventName: "checkout_submit", properties: { currency: "USD" } },
    ]);
  });

  it("backfills observed values only for keys already listed on the plan", () => {
    const planRow = row("checkout_submit", {
      properties: { currency: "" },
      fields: { schema: "" },
    });
    const actual = event(
      "checkout_submit",
      { currency: "USD", amount: 99 },
      { schema: "iglu:com.example/checkout/jsonschema/1-0-0", extra: true },
    );
    const coverage: PlanCoverage = {
      matched: [{ row: planRow, actual }],
      missing: [],
      unexpected: [],
    };

    const expects = buildExpectFromPlan([planRow], coverage);

    expect(expects).toEqual([
      {
        eventName: "checkout_submit",
        properties: { currency: "USD" },
        fields: { schema: "iglu:com.example/checkout/jsonschema/1-0-0" },
      },
    ]);
  });

  it("does not leak unplanned captured keys into expects by default", () => {
    const planRow = row("page_view", { properties: { page: "/home" } });
    const coverage: PlanCoverage = {
      matched: [
        {
          row: planRow,
          actual: event("page_view", { page: "/home", debug: true }),
        },
      ],
      missing: [],
      unexpected: [event("debug_event", { source: "dev" })],
    };

    const expects = buildExpectFromPlan([planRow], coverage);

    expect(expects).toEqual([
      { eventName: "page_view", properties: { page: "/home" } },
    ]);
    expect(expects.some((e) => e.eventName === "debug_event")).toBe(false);
  });

  it("appends exploratory expects for unexpected when includeUnplanned is set", () => {
    const planRow = row("page_view");
    const unexpected = event("debug_event", {
      source: "dev",
      timestamp: 123,
      eid: "abc",
    });
    const coverage: PlanCoverage = {
      matched: [{ row: planRow, actual: event("page_view") }],
      missing: [],
      unexpected: [unexpected],
    };

    const expects = buildExpectFromPlan([planRow], coverage, {
      includeUnplanned: true,
    });

    expect(expects[0]).toEqual({ eventName: "page_view" });
    expect(expects.slice(1)).toEqual([
      { eventName: "debug_event", properties: { source: "dev" } },
    ]);
  });

  it("matches coverage by content key when plan row references differ", () => {
    const coverageRow = row("checkout_submit", {
      properties: { currency: "" },
      fields: { schema: "" },
    });
    const planRows = [
      row("checkout_submit", {
        properties: { currency: "" },
        fields: { schema: "" },
      }),
    ];
    const actual = event(
      "checkout_submit",
      { currency: "USD" },
      { schema: "iglu:com.example/checkout/jsonschema/1-0-0" },
    );
    const coverage: PlanCoverage = {
      matched: [{ row: coverageRow, actual }],
      missing: [],
      unexpected: [],
    };

    const expects = buildExpectFromPlan(planRows, coverage);

    expect(expects).toEqual([
      {
        eventName: "checkout_submit",
        properties: { currency: "USD" },
        fields: { schema: "iglu:com.example/checkout/jsonschema/1-0-0" },
      },
    ]);
  });
});

describe("buildExpectExploratory", () => {
  it("filters noise event names", () => {
    const captured = [
      event("page_view", { page: "/home" }),
      event("page_ping", { pp_yoffset: 100 }),
    ];

    const expects = buildExpectExploratory(captured);

    expect(expects).toEqual([
      { eventName: "page_view", properties: { page: "/home" } },
    ]);
  });

  it("omits default and uuid-like churn keys", () => {
    const captured = [
      event("cta_click", {
        label: "Buy",
        timestamp: 1710000000,
        eid: "evt-1",
        dtm: 1710000001,
        "550e8400-e29b-41d4-a716-446655440000": "x",
        session_id: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ];

    const expects = buildExpectExploratory(captured);

    expect(expects).toEqual([
      { eventName: "cta_click", properties: { label: "Buy" } },
    ]);
  });

  it("uses key intersection of stable props for duplicate event names", () => {
    const captured = [
      event("signup", { step: 1, device: "web", experiment: "A" }),
      event("signup", { step: 2, device: "web", variant: "B" }),
    ];

    const expects = buildExpectExploratory(captured);

    expect(expects).toEqual([
      { eventName: "signup", properties: { device: "web" } },
    ]);
  });

  it("respects custom noiseEventNames and churnKeys", () => {
    const captured = [
      event("heartbeat", { ok: true }),
      event("purchase", { sku: "abc", nonce: "n1" }),
    ];

    const expects = buildExpectExploratory(captured, {
      noiseEventNames: ["heartbeat"],
      churnKeys: ["nonce"],
    });

    expect(expects).toEqual([
      { eventName: "purchase", properties: { sku: "abc" } },
    ]);
  });
});

describe("suggestWaitForEventSteps", () => {
  it("inserts waitForEvent after the user action preceding each matched event", () => {
    const steps: Step[] = [
      { action: "goto", path: "/" },
      { action: "click", selector: "[data-analytics-id='cta']" },
      { action: "fill", selector: "#email", value: "a@b.com" },
    ];
    const pageView = event("page_view", {}, {}, "1000");
    const ctaClick = event("cta_click", {}, {}, "2500");
    const coverage: PlanCoverage = {
      matched: [
        { row: row("page_view", { trigger: "page_load", path: "/" }), actual: pageView },
        { row: row("cta_click", { trigger: "click" }), actual: ctaClick },
      ],
      missing: [],
      unexpected: [],
    };
    // parallel to user-action steps (goto, click, fill)
    const actionTimestamps = [500, 2000, 4000];

    const result = suggestWaitForEventSteps(steps, coverage, actionTimestamps);

    expect(result).toEqual([
      { action: "goto", path: "/" },
      { action: "waitForEvent", eventName: "page_view" },
      { action: "click", selector: "[data-analytics-id='cta']" },
      { action: "waitForEvent", eventName: "cta_click" },
      { action: "fill", selector: "#email", value: "a@b.com" },
    ]);
  });

  it("prefers plan-trigger action so a later scroll does not steal page_view wait", () => {
    const steps: Step[] = [
      { action: "goto", path: "/" },
      { action: "click", selector: "#cta" },
      { action: "scroll", selector: "#scroll-region" },
    ];
    const pageView = event("page_view", {}, {}, "1000");
    const coverage: PlanCoverage = {
      matched: [
        {
          row: row("page_view", { trigger: "page_load", path: "/" }),
          actual: pageView,
        },
      ],
      missing: [],
      unexpected: [],
    };
    // scroll is latest in the wide scroll window; trigger match must pick goto.
    const actionTimestamps = [1030, 1200, 1310];

    const result = suggestWaitForEventSteps(steps, coverage, actionTimestamps);

    expect(result).toEqual([
      { action: "goto", path: "/" },
      { action: "waitForEvent", eventName: "page_view" },
      { action: "click", selector: "#cta" },
      { action: "scroll", selector: "#scroll-region" },
    ]);
  });

  it("falls back by match order when event timestamps are missing", () => {
    const steps: Step[] = [
      { action: "goto", path: "/" },
      { action: "click", selector: "#cta" },
    ];
    const coverage: PlanCoverage = {
      matched: [
        { row: row("page_view"), actual: event("page_view") },
        { row: row("cta_click"), actual: event("cta_click") },
      ],
      missing: [],
      unexpected: [],
    };
    const actionTimestamps = [100, 200];

    const result = suggestWaitForEventSteps(steps, coverage, actionTimestamps);

    expect(result).toEqual([
      { action: "goto", path: "/" },
      { action: "waitForEvent", eventName: "page_view" },
      { action: "click", selector: "#cta" },
      { action: "waitForEvent", eventName: "cta_click" },
    ]);
  });

  it("skips waitForEvent when no user action precedes the event timestamp", () => {
    const steps: Step[] = [
      { action: "goto", path: "/" },
      { action: "click", selector: "#cta" },
    ];
    const coverage: PlanCoverage = {
      matched: [
        { row: row("early_event"), actual: event("early_event", {}, {}, "50") },
        { row: row("cta_click"), actual: event("cta_click", {}, {}, "5500") },
      ],
      missing: [],
      unexpected: [],
    };
    // Both actions occur well after early_event (50); only cta_click has a preceding action.
    const actionTimestamps = [5000, 5200];

    const result = suggestWaitForEventSteps(steps, coverage, actionTimestamps);

    expect(result).toEqual([
      { action: "goto", path: "/" },
      { action: "click", selector: "#cta" },
      { action: "waitForEvent", eventName: "cta_click" },
    ]);
    expect(result.some((s) => s.action === "waitForEvent" && s.eventName === "early_event")).toBe(
      false,
    );
  });

  it("attaches wait after click when action timestamp is slightly after event (async binding)", () => {
    const steps: Step[] = [
      { action: "goto", path: "/" },
      { action: "click", selector: '[data-analytics-id="demo-cta"]' },
    ];
    // Beacon dtm lands before RecorderSession finishes pushAction for the click.
    const ctaClick = event("cta_click", {}, {}, "2000");
    const coverage: PlanCoverage = {
      matched: [{ row: row("cta_click"), actual: ctaClick }],
      missing: [],
      unexpected: [],
    };
    const actionTimestamps = [1000, 2050];

    const result = suggestWaitForEventSteps(steps, coverage, actionTimestamps);

    expect(result).toEqual([
      { action: "goto", path: "/" },
      { action: "click", selector: '[data-analytics-id="demo-cta"]' },
      { action: "waitForEvent", eventName: "cta_click" },
    ]);
  });

  it("treats scroll as a user action for waitForEvent attachment", () => {
    const steps: Step[] = [
      { action: "goto", path: "/" },
      { action: "scroll", selector: "#scroll-region" },
    ];
    const scrolled = event("list_scrolled", {}, {}, "3000");
    const coverage: PlanCoverage = {
      matched: [
        {
          row: row("list_scrolled", { trigger: "scroll", selector: "#scroll-region" }),
          actual: scrolled,
        },
      ],
      missing: [],
      unexpected: [],
    };
    const actionTimestamps = [1000, 2900];

    const result = suggestWaitForEventSteps(steps, coverage, actionTimestamps);

    expect(result).toEqual([
      { action: "goto", path: "/" },
      { action: "scroll", selector: "#scroll-region" },
      { action: "waitForEvent", eventName: "list_scrolled" },
    ]);
  });

  it("attaches wait after scroll when a prior click is closer to the event (debounce lag)", () => {
    const steps: Step[] = [
      { action: "goto", path: "/" },
      { action: "click", selector: '[data-analytics-id="demo-cta"]' },
      { action: "scroll", selector: "#scroll-region" },
    ];
    // Beacon fires when scroll starts; debounced scroll action lands later.
    // Pre-fix "closest" favored the click (200ms) over the scroll (300ms).
    const scrolled = event("list_scrolled", {}, {}, "5300");
    const coverage: PlanCoverage = {
      matched: [
        {
          row: row("list_scrolled", { trigger: "scroll", selector: "#scroll-region" }),
          actual: scrolled,
        },
      ],
      missing: [],
      unexpected: [],
    };
    // scroll at +300ms is within scroll post-slack (400ms); click is earlier.
    const actionTimestamps = [1000, 5100, 5600];

    const result = suggestWaitForEventSteps(steps, coverage, actionTimestamps);

    expect(result).toEqual([
      { action: "goto", path: "/" },
      { action: "click", selector: '[data-analytics-id="demo-cta"]' },
      { action: "scroll", selector: "#scroll-region" },
      { action: "waitForEvent", eventName: "list_scrolled" },
    ]);
  });
});
