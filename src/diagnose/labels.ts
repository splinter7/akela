import type { DiagnosisCode } from "./types.js";

const LABELS: Record<DiagnosisCode, string> = {
  step_failed: "Stopped on a page step",
  wait_for_event_timeout: "Timed out waiting for an analytics event",
  event_missing_near_miss: "Analytics event had the wrong details",
  event_missing_no_near_miss: "Expected analytics event never fired",
  no_events_captured: "No analytics events captured",
  forbid_extra_failed: "Extra analytics events were not allowed",
  unexpected_events: "Extra analytics events were seen",
  capture_warnings: "Some network events could not be parsed",
};

export function diagnosisLabel(code: DiagnosisCode): string {
  return LABELS[code];
}
