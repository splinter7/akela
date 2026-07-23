import type { RunResult } from "../runner/JourneyRunner.js";
import type { ExpectedEvent } from "../normalize/types.js";
import type { MissingMatch } from "../verify/EventVerifier.js";
import { buildPresentation } from "./buildPresentation.js";
import type {
  DiagnosisCode,
  DiagnosisFinding,
  DiagnosisResult,
  ReportJson,
} from "./types.js";

export type { ReportJson } from "./types.js";

const CODE_PRIORITY: DiagnosisCode[] = [
  "wait_for_event_timeout",
  "step_failed",
  "no_events_captured",
  "event_missing_near_miss",
  "event_missing_no_near_miss",
  "forbid_extra_failed",
  "unexpected_events",
  "capture_warnings",
];

function parseEventNameFromReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const match = reason.match(/waiting for "([^"]+)"/);
  return match?.[1];
}

function waitForEventName(
  detail: string | undefined,
  reason: string | undefined,
): string | undefined {
  if (detail) return detail;
  return parseEventNameFromReason(reason);
}

function isExpectedEvent(value: unknown): value is ExpectedEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "eventName" in value &&
    typeof value.eventName === "string"
  );
}

function normalizeMissingMatch(value: unknown): MissingMatch | undefined {
  if (typeof value === "object" && value !== null && "expected" in value) {
    const { expected, nearMiss } = value as {
      expected: unknown;
      nearMiss?: unknown;
    };
    if (isExpectedEvent(expected)) {
      return { expected, nearMiss: nearMiss as MissingMatch["nearMiss"] };
    }
  }

  return isExpectedEvent(value) ? { expected: value } : undefined;
}

function sortFindings(findings: DiagnosisFinding[]): DiagnosisFinding[] {
  return [...findings].sort(
    (a, b) => CODE_PRIORITY.indexOf(a.code) - CODE_PRIORITY.indexOf(b.code),
  );
}

export function diagnoseFailure(result: RunResult): DiagnosisResult | undefined {
  if (result.pass) {
    return undefined;
  }

  const findings: DiagnosisFinding[] = [];
  let hasFailedStep = false;

  for (const step of result.stepLog ?? []) {
    if (step.status !== "failed") continue;
    hasFailedStep = true;

    if (step.action === "waitForEvent") {
      const eventName = waitForEventName(step.detail, step.reason);
      const displayName = eventName ?? step.detail ?? "event";
      let message = `Step ${step.index + 1} (waitForEvent) timed out waiting for "${displayName}"`;
      if (step.reason) {
        message += `: ${step.reason}`;
      }
      const evidence: Record<string, unknown> = {
        index: step.index,
        action: step.action,
        detail: step.detail,
        reason: step.reason,
      };
      if (eventName !== undefined) {
        evidence.eventName = eventName;
      }
      findings.push({
        code: "wait_for_event_timeout",
        severity: "error",
        message,
        evidence,
      });
    } else {
      findings.push({
        code: "step_failed",
        severity: "error",
        message: `Step ${step.index + 1} (${step.action}) failed: ${step.reason || "unknown error"}`,
        evidence: {
          index: step.index,
          action: step.action,
          detail: step.detail,
          reason: step.reason,
        },
      });
    }
  }

  if (result.error && !hasFailedStep) {
    findings.push({
      code: "step_failed",
      severity: "error",
      message: `Run failed: ${result.error}`,
      evidence: { error: result.error },
    });
  }

  const events = result.events ?? [];
  if (events.length === 0) {
    findings.push({
      code: "no_events_captured",
      severity: "error",
      message:
        "No analytics events were captured. Check adapters, collector patterns, and that the journey reached instrumented UI.",
      evidence: { baseUrl: result.baseUrl, eventCount: 0 },
    });
  }

  for (const rawMissing of result.verification?.missing ?? []) {
    const missing = normalizeMissingMatch(rawMissing);
    if (!missing) continue;
    const eventName = missing.expected.eventName;
    if (missing.nearMiss) {
      const { actual, diff } = missing.nearMiss;
      findings.push({
        code: "event_missing_near_miss",
        severity: "error",
        message: `Expected "${eventName}" was close — property/field mismatch:\n${diff}`,
        evidence: {
          eventName,
          expected: missing.expected,
          diff,
          actualProperties: actual.properties,
          actualFields: actual.fields,
        },
      });
    } else {
      findings.push({
        code: "event_missing_no_near_miss",
        severity: "error",
        message: `Expected "${eventName}" never matched; no near-miss in unused events.`,
        evidence: {
          eventName,
          expected: missing.expected,
          seenEventNames: events.map((e) => e.eventName),
        },
      });
    }
  }

  const unexpected = result.verification?.unexpected ?? [];
  const names = unexpected.map((e) => e.eventName).slice(0, 10);
  const count = unexpected.length;

  if (result.verification?.options?.forbidExtra && count > 0) {
    findings.push({
      code: "forbid_extra_failed",
      severity: "error",
      message: `forbidExtra is on and ${count} unexpected event(s) were captured: ${names.join(", ")}`,
      evidence: { count, eventNames: names },
    });
  } else if (count > 0) {
    findings.push({
      code: "unexpected_events",
      severity: "info",
      message: `${count} unexpected event(s) were captured: ${names.join(", ")}`,
      evidence: { count, eventNames: names },
    });
  }

  const captureWarnings = result.captureWarnings ?? [];
  if (captureWarnings.length > 0) {
    findings.push({
      code: "capture_warnings",
      severity: "warning",
      message: `${captureWarnings.length} capture warning(s) during the run`,
      evidence: { warnings: captureWarnings.slice(0, 10) },
    });
  }

  const sorted = sortFindings(findings);
  const presentation = buildPresentation(sorted);

  return {
    version: 1,
    pass: false,
    findings: sorted,
    ...presentation,
  };
}

export function diagnoseReportJson(
  report: ReportJson,
): DiagnosisResult | undefined {
  const { runId: _runId, diagnosis: _diagnosis, artifacts: _artifacts, ...rest } =
    report;
  return diagnoseFailure(rest);
}
