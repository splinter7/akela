import { describe, it, expect } from "vitest";
import { formatDiagnosisText } from "../../src/diagnose/formatDiagnosis.js";
import type { DiagnosisResult } from "../../src/diagnose/types.js";

function sample(): DiagnosisResult {
  return {
    version: 1,
    pass: false,
    summary:
      'The journey stopped at step 2 (waitForSelector). The app was on "service_empty_state" instead of the expected screen.',
    guidance: [
      "Check that you are logged in with the right account and that this screen’s content is visible (not an empty or error state).",
      "This looks like an empty state. Use a test account that has the required data, or adjust the journey for that state.",
    ],
    primaryFindingIndexes: [0, 1],
    cascadeNote:
      "12 later analytics checks were not reached because the journey stopped early.",
    findings: [
      {
        code: "step_failed",
        severity: "error",
        message: "Step 2 (waitForSelector) failed: Timeout",
        evidence: {},
      },
      {
        code: "event_missing_near_miss",
        severity: "error",
        message:
          'Expected "click" was close — property/field mismatch:\ndiff-line',
        evidence: {},
      },
      {
        code: "event_missing_no_near_miss",
        severity: "error",
        message: 'Expected "other" never matched; no near-miss in unused events.',
        evidence: {},
      },
    ],
  };
}

describe("formatDiagnosisText", () => {
  it("formats human summary by default with labels and cascade", () => {
    const text = formatDiagnosisText(sample());
    expect(text).toContain("Diagnosis: The journey stopped at step 2");
    expect(text).toContain("What to try:");
    expect(text).toContain("- [Stopped on a page step]");
    expect(text).toContain("- [Analytics event had the wrong details]");
    expect(text).toContain("diff-line");
    expect(text).not.toContain("[event_missing_no_near_miss]");
    expect(text).toContain("12 later analytics checks");
    expect(text).toContain("--verbose");
  });

  it("lists all findings with codes when verbose", () => {
    const text = formatDiagnosisText(sample(), { verbose: true });
    expect(text).toContain("- [step_failed]");
    expect(text).toContain("- [event_missing_near_miss]");
    expect(text).toContain("- [event_missing_no_near_miss]");
    expect(text).not.toContain("--verbose");
  });
});
