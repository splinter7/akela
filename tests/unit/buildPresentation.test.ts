import { describe, expect, it } from "vitest";
import { buildPresentation } from "../../src/diagnose/buildPresentation.js";
import type { DiagnosisFinding } from "../../src/diagnose/types.js";

function finding(
  code: DiagnosisFinding["code"],
  evidence: Record<string, unknown> = {},
  message = code,
): DiagnosisFinding {
  return { code, severity: "error", message, evidence };
}

describe("buildPresentation", () => {
  it("collapses missing-event findings after a step abort", () => {
    const findings: DiagnosisFinding[] = [
      finding("step_failed", {
        index: 1,
        action: "waitForSelector",
        reason: "Timeout",
      }),
      finding("event_missing_near_miss", {
        eventName: "page_shown",
        actualProperties: { page: "service_empty_state" },
        diff: "diff1",
      }),
      finding("event_missing_near_miss", {
        eventName: "page_shown",
        actualProperties: { page: "service_empty_state" },
        diff: "diff2",
      }),
      finding("event_missing_near_miss", {
        eventName: "page_shown",
        actualProperties: { page: "service_empty_state" },
        diff: "diff3",
      }),
      finding("event_missing_no_near_miss", { eventName: "clicked" }),
      finding("event_missing_no_near_miss", { eventName: "completed" }),
    ];

    const p = buildPresentation(findings);
    expect(p.primaryFindingIndexes).toEqual([0, 1, 2]);
    expect(p.cascadeNote).toMatch(/3 later analytics checks/);
    expect(p.summary).toContain("service_empty_state");
    expect(p.summary).toContain("step 2");
    expect(p.guidance.some((g) => /empty state/i.test(g))).toBe(true);
    expect(p.guidance.some((g) => /logged in/i.test(g))).toBe(true);
  });

  it("keeps all findings primary when there is no step abort", () => {
    const findings: DiagnosisFinding[] = [
      finding("event_missing_no_near_miss", { eventName: "a" }),
      finding("event_missing_no_near_miss", { eventName: "b" }),
    ];
    const p = buildPresentation(findings);
    expect(p.primaryFindingIndexes).toEqual([0, 1]);
    expect(p.cascadeNote).toBeUndefined();
    expect(p.summary).toBe("Expected analytics events never fired.");
  });

  it("builds wait_for_event_timeout headline", () => {
    const p = buildPresentation([
      finding(
        "wait_for_event_timeout",
        { index: 2, eventName: "purchase", action: "waitForEvent" },
        'Step 3 (waitForEvent) timed out waiting for "purchase"',
      ),
    ]);
    expect(p.summary).toBe(
      'Timed out waiting for analytics event "purchase" after step 3.',
    );
  });
});
