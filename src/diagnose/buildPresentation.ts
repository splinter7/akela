import type { DiagnosisFinding } from "./types.js";

export type Presentation = {
  summary: string;
  guidance: string[];
  primaryFindingIndexes: number[];
  cascadeNote?: string;
};

const STEP_CODES = new Set(["step_failed", "wait_for_event_timeout"]);
const MISSING_CODES = new Set([
  "event_missing_near_miss",
  "event_missing_no_near_miss",
]);
const ALWAYS_PRIMARY = new Set([
  "unexpected_events",
  "forbid_extra_failed",
  "capture_warnings",
  "no_events_captured",
]);

function shortReason(reason: unknown): string {
  if (typeof reason !== "string" || !reason.trim()) return "unknown error";
  const first = reason.split(/\nCall log:/i)[0]?.trim() ?? reason.trim();
  const line = first.split("\n")[0]?.trim() ?? first;
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

function actualPage(finding: DiagnosisFinding): string | undefined {
  const props = finding.evidence.actualProperties;
  if (typeof props === "object" && props !== null && "page" in props) {
    const page = (props as { page?: unknown }).page;
    if (typeof page === "string" && page.length > 0) return page;
  }
  return undefined;
}

function buildPrimaryIndexes(findings: DiagnosisFinding[]): {
  indexes: number[];
  cascadeNote?: string;
} {
  const hasStepAbort = findings.some((f) => STEP_CODES.has(f.code));
  const missingIndexes = findings
    .map((f, i) => (MISSING_CODES.has(f.code) ? i : -1))
    .filter((i) => i >= 0);

  if (!hasStepAbort || missingIndexes.length === 0) {
    return { indexes: findings.map((_, i) => i) };
  }

  const indexes: number[] = [];
  let nearMissKept = 0;
  let collapsedMissing = 0;

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i]!;
    if (STEP_CODES.has(f.code) || ALWAYS_PRIMARY.has(f.code)) {
      indexes.push(i);
      continue;
    }
    if (f.code === "event_missing_near_miss" && nearMissKept < 2) {
      indexes.push(i);
      nearMissKept++;
      continue;
    }
    if (MISSING_CODES.has(f.code)) {
      collapsedMissing++;
      continue;
    }
    indexes.push(i);
  }

  if (collapsedMissing === 0) {
    return { indexes };
  }

  return {
    indexes,
    cascadeNote: `${collapsedMissing} later analytics checks were not reached because the journey stopped early.`,
  };
}

function buildSummary(
  findings: DiagnosisFinding[],
  primaryIndexes: number[],
): string {
  const step = findings.find((f) => f.code === "step_failed");
  const waitTimeout = findings.find((f) => f.code === "wait_for_event_timeout");
  const nearMiss = findings.find((f) => f.code === "event_missing_near_miss");
  const page = nearMiss ? actualPage(nearMiss) : undefined;

  if (step && page) {
    const n = Number(step.evidence.index) + 1;
    const action =
      typeof step.evidence.action === "string" ? step.evidence.action : "step";
    return `The journey stopped at step ${n} (${action}). The app was on "${page}" instead of the expected screen.`;
  }

  if (step) {
    const n = Number(step.evidence.index) + 1;
    const action =
      typeof step.evidence.action === "string" ? step.evidence.action : "step";
    if (Number.isFinite(n) && step.evidence.index !== undefined) {
      return `The journey stopped at step ${n} (${action}): ${shortReason(step.evidence.reason ?? step.message)}.`;
    }
    return `The journey stopped: ${shortReason(step.evidence.error ?? step.message)}.`;
  }

  if (waitTimeout) {
    const n = Number(waitTimeout.evidence.index) + 1;
    const eventName =
      (typeof waitTimeout.evidence.eventName === "string"
        ? waitTimeout.evidence.eventName
        : undefined) ??
      (typeof waitTimeout.evidence.detail === "string"
        ? waitTimeout.evidence.detail
        : "event");
    return `Timed out waiting for analytics event "${eventName}" after step ${n}.`;
  }

  if (findings.some((f) => f.code === "no_events_captured")) {
    return "No analytics events were captured during this run.";
  }

  const onlyNearMiss =
    findings.length > 0 &&
    findings.every((f) => f.code === "event_missing_near_miss");
  if (onlyNearMiss && nearMiss) {
    const eventName =
      typeof nearMiss.evidence.eventName === "string"
        ? nearMiss.evidence.eventName
        : "event";
    return `An analytics event fired with the wrong details (closest match: "${eventName}").`;
  }

  const onlyNoNearMiss =
    findings.length > 0 &&
    findings.every((f) => f.code === "event_missing_no_near_miss");
  if (onlyNoNearMiss) {
    return "Expected analytics events never fired.";
  }

  const primary = findings[primaryIndexes[0]!];
  if (primary) {
    return shortReason(primary.message.split("\n")[0] ?? primary.message);
  }
  return "Run failed with no specific diagnosis rules matched.";
}

function buildGuidance(findings: DiagnosisFinding[], summary: string): string[] {
  const guidance: string[] = [];
  const push = (line: string) => {
    if (guidance.length < 3 && !guidance.includes(line)) guidance.push(line);
  };

  const step = findings.find((f) => f.code === "step_failed");
  const action = step?.evidence.action;
  const reason =
    typeof step?.evidence.reason === "string" ? step.evidence.reason : "";
  if (
    action === "waitForSelector" ||
    /waitForSelector|Timeout|locator/i.test(reason) ||
    /waitForSelector/i.test(step?.message ?? "")
  ) {
    push(
      "Check that you are logged in with the right account and that this screen’s content is visible (not an empty or error state).",
    );
  }

  const pages = findings
    .filter((f) => f.code === "event_missing_near_miss")
    .map(actualPage)
    .filter((p): p is string => !!p);
  if (
    summary.includes("empty_state") ||
    pages.some((p) => /empty/i.test(p))
  ) {
    push(
      "This looks like an empty state. Use a test account that has the required data, or adjust the journey for that state.",
    );
  }

  if (findings.some((f) => f.code === "no_events_captured")) {
    push(
      "Confirm the site is instrumented and collector patterns in config match this environment.",
    );
  }

  const hasStep = findings.some((f) => f.code === "step_failed");
  if (
    !hasStep &&
    findings.some((f) => f.code === "wait_for_event_timeout")
  ) {
    push(
      "The UI may have moved on without firing the expected event, or the event name/properties in the journey do not match production.",
    );
  }

  if (guidance.length === 0) {
    push(
      "Open the HTML report screenshot and Technical findings if you need more detail.",
    );
  }

  return guidance;
}

export function buildPresentation(findings: DiagnosisFinding[]): Presentation {
  const { indexes, cascadeNote } = buildPrimaryIndexes(findings);
  const summary = buildSummary(findings, indexes);
  const guidance = buildGuidance(findings, summary);
  return {
    summary,
    guidance,
    primaryFindingIndexes: indexes,
    ...(cascadeNote ? { cascadeNote } : {}),
  };
}
