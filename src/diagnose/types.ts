import type { RunResult } from "../runner/JourneyRunner.js";

export type DiagnosisCode =
  | "step_failed"
  | "wait_for_event_timeout"
  | "event_missing_no_near_miss"
  | "event_missing_near_miss"
  | "unexpected_events"
  | "forbid_extra_failed"
  | "capture_warnings"
  | "no_events_captured";

export type DiagnosisFinding = {
  code: DiagnosisCode;
  severity: "error" | "warning" | "info";
  message: string;
  evidence: Record<string, unknown>;
};

export type DiagnosisResult = {
  version: 1;
  pass: false;
  /** Complete list — SaaS keys off findings[].code */
  findings: DiagnosisFinding[];
  /** Human one-liner for CLI / report summary */
  summary: string;
  /** 1–3 plain next-step lines for non-technical readers */
  guidance: string[];
  /** Indexes into findings[] shown in default human view */
  primaryFindingIndexes: number[];
  /** Present when missing-event findings were collapsed after a step abort */
  cascadeNote?: string;
};

export type ReportJson = Omit<RunResult, "artifacts"> & {
  runId?: string;
  artifacts?: { screenshotPath?: string };
  diagnosis?: DiagnosisResult;
};
