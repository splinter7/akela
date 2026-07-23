import { describe, it, expect } from "vitest";
import {
  diagnoseFailure,
  diagnoseReportJson,
} from "../../src/diagnose/diagnoseFailure.js";
import type { RunResult } from "../../src/runner/JourneyRunner.js";
import type { NormalizedEvent } from "../../src/normalize/types.js";

function ev(
  eventName: string,
  properties: Record<string, unknown> = {},
): NormalizedEvent {
  return {
    platform: "test",
    eventName,
    properties,
    fields: { ...properties },
    raw: { url: "https://x", method: "GET", payload: {} },
  };
}

function failedBase(overrides: Partial<RunResult> = {}): RunResult {
  return {
    journeyName: "j",
    baseUrl: "http://localhost",
    durationMs: 1,
    events: [],
    verification: {
      pass: false,
      matched: [],
      missing: [],
      unexpected: [],
      options: { ordered: false, match: "partial", forbidExtra: false },
    },
    pass: false,
    captureWarnings: [],
    stepLog: [],
    ...overrides,
  };
}

describe("diagnoseFailure", () => {
  it("returns undefined on PASS", () => {
    expect(
      diagnoseFailure(
        failedBase({
          pass: true,
          verification: {
            pass: true,
            matched: [],
            missing: [],
            unexpected: [],
            options: { ordered: false, match: "partial", forbidExtra: false },
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("emits wait_for_event_timeout for failed waitForEvent steps", () => {
    const d = diagnoseFailure(
      failedBase({
        stepLog: [
          {
            index: 2,
            action: "waitForEvent",
            status: "failed",
            detail: "purchase",
            reason: 'waitForEvent timed out after 300ms waiting for "purchase"',
          },
        ],
      }),
    );
    expect(d?.findings[0]?.code).toBe("wait_for_event_timeout");
    expect(d?.findings[0]?.evidence).toMatchObject({
      index: 2,
      eventName: "purchase",
    });
  });

  it("emits step_failed for other failed steps", () => {
    const d = diagnoseFailure(
      failedBase({
        stepLog: [
          {
            index: 0,
            action: "click",
            status: "failed",
            detail: "#pay",
            reason: "Timeout",
          },
        ],
      }),
    );
    expect(d?.findings.some((f) => f.code === "step_failed")).toBe(true);
    expect(d?.findings.some((f) => f.code === "wait_for_event_timeout")).toBe(
      false,
    );
  });

  it("emits step_failed from orphan error when no failed steps", () => {
    const d = diagnoseFailure(failedBase({ error: "browser crashed" }));
    expect(d?.findings[0]?.code).toBe("step_failed");
    expect(d?.findings[0]?.message).toMatch(/browser crashed/);
  });

  it("emits no_events_captured when events empty", () => {
    const d = diagnoseFailure(failedBase({ events: [] }));
    expect(d?.findings.some((f) => f.code === "no_events_captured")).toBe(true);
  });

  it("emits event_missing_near_miss with verifier diff", () => {
    const actual = ev("click", { page: "other" });
    const diff = '  properties.page: expected "home", got "other"';
    const d = diagnoseFailure(
      failedBase({
        events: [actual],
        verification: {
          pass: false,
          matched: [],
          missing: [
            {
              expected: { eventName: "click", properties: { page: "home" } },
              nearMiss: { actual, diff },
            },
          ],
          unexpected: [],
          options: { ordered: false, match: "partial", forbidExtra: false },
        },
      }),
    );
    const f = d?.findings.find((x) => x.code === "event_missing_near_miss");
    expect(f?.evidence.diff).toBe(diff);
    expect(f?.message).toContain(diff);
  });

  it("emits event_missing_no_near_miss without nearMiss", () => {
    const d = diagnoseFailure(
      failedBase({
        events: [ev("other")],
        verification: {
          pass: false,
          matched: [],
          missing: [{ expected: { eventName: "click" } }],
          unexpected: [],
          options: { ordered: false, match: "partial", forbidExtra: false },
        },
      }),
    );
    expect(
      d?.findings.some((f) => f.code === "event_missing_no_near_miss"),
    ).toBe(true);
  });

  it("emits forbid_extra_failed instead of unexpected_events when forbidExtra", () => {
    const d = diagnoseFailure(
      failedBase({
        events: [ev("noise")],
        verification: {
          pass: false,
          matched: [],
          missing: [],
          unexpected: [ev("noise")],
          options: { ordered: false, match: "partial", forbidExtra: true },
        },
      }),
    );
    expect(d?.findings.some((f) => f.code === "forbid_extra_failed")).toBe(
      true,
    );
    expect(d?.findings.some((f) => f.code === "unexpected_events")).toBe(
      false,
    );
  });

  it("emits unexpected_events as info when forbidExtra is off", () => {
    const d = diagnoseFailure(
      failedBase({
        error: "boom",
        events: [ev("noise")],
        verification: {
          pass: false,
          matched: [],
          missing: [],
          unexpected: [ev("noise")],
          options: { ordered: false, match: "partial", forbidExtra: false },
        },
      }),
    );
    const f = d?.findings.find((x) => x.code === "unexpected_events");
    expect(f?.severity).toBe("info");
  });

  it("emits capture_warnings", () => {
    const d = diagnoseFailure(
      failedBase({ error: "x", captureWarnings: ["bad parse"] }),
    );
    expect(d?.findings.some((f) => f.code === "capture_warnings")).toBe(true);
  });

  it("sorts findings by priority", () => {
    const actual = ev("click", { page: "other" });
    const d = diagnoseFailure(
      failedBase({
        events: [actual],
        captureWarnings: ["w"],
        stepLog: [
          {
            index: 0,
            action: "waitForEvent",
            status: "failed",
            detail: "click",
            reason: 'waiting for "click"',
          },
        ],
        verification: {
          pass: false,
          matched: [],
          missing: [
            {
              expected: { eventName: "click", properties: { page: "home" } },
              nearMiss: { actual, diff: "diff" },
            },
          ],
          unexpected: [ev("noise")],
          options: { ordered: false, match: "partial", forbidExtra: true },
        },
      }),
    );
    const codes = d!.findings.map((f) => f.code);
    expect(codes.indexOf("wait_for_event_timeout")).toBeLessThan(
      codes.indexOf("event_missing_near_miss"),
    );
    expect(codes.indexOf("event_missing_near_miss")).toBeLessThan(
      codes.indexOf("forbid_extra_failed"),
    );
    expect(codes.indexOf("forbid_extra_failed")).toBeLessThan(
      codes.indexOf("capture_warnings"),
    );
  });

  it("attaches human presentation fields and collapses cascade", () => {
    const actual = ev("page_shown", { page: "service_empty_state" });
    const d = diagnoseFailure(
      failedBase({
        events: [actual],
        stepLog: [
          {
            index: 1,
            action: "waitForSelector",
            status: "failed",
            detail: "text=Select a service",
            reason: "page.waitForSelector: Timeout 15000ms exceeded.",
          },
        ],
        verification: {
          pass: false,
          matched: [],
          missing: [
            {
              expected: {
                eventName: "page_shown",
                properties: { page: "service_selection" },
              },
              nearMiss: {
                actual,
                diff: '  properties.page: expected "service_selection", got "service_empty_state"',
              },
            },
            {
              expected: {
                eventName: "page_shown",
                properties: { page: "review" },
              },
              nearMiss: {
                actual,
                diff: '  properties.page: expected "review", got "service_empty_state"',
              },
            },
            {
              expected: {
                eventName: "page_shown",
                properties: { page: "success" },
              },
              nearMiss: {
                actual,
                diff: '  properties.page: expected "success", got "service_empty_state"',
              },
            },
            { expected: { eventName: "clicked" } },
          ],
          unexpected: [],
          options: { ordered: false, match: "partial", forbidExtra: false },
        },
      }),
    );
    expect(d?.findings.length).toBe(5);
    expect(d?.primaryFindingIndexes.length).toBeLessThan(d!.findings.length);
    expect(d?.summary).toContain("service_empty_state");
    expect(d?.cascadeNote).toMatch(/later analytics checks/);
    expect(d?.guidance.length).toBeGreaterThan(0);
  });

  it("diagnoseReportJson ignores embedded diagnosis and recomputes", () => {
    const report = {
      ...failedBase({
        stepLog: [
          {
            index: 0,
            action: "click",
            status: "failed",
            detail: "#x",
            reason: "no",
          },
        ],
      }),
      runId: "j-1",
      diagnosis: {
        version: 1 as const,
        pass: false as const,
        summary: "stale",
        findings: [],
      },
    };
    const d = diagnoseReportJson(report);
    expect(d?.summary).not.toBe("stale");
    expect(d?.findings[0]?.code).toBe("step_failed");
  });
});
