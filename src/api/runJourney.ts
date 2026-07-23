import type { Journey, ProgressFn } from "../normalize/types.js";
import { loadConfig } from "../config/loadConfig.js";
import { runJourneyWithConfig, type RunResult } from "../runner/JourneyRunner.js";
import { writeReports, type ReportPaths } from "../report/writeReports.js";
import { resolve } from "node:path";

export type RunJourneyResult = RunResult & { reports: ReportPaths };

/**
 * TypeScript API — same engine as the CLI.
 */
export async function runJourney(
  journey: Journey,
  options?: { cwd?: string; onProgress?: ProgressFn },
): Promise<RunJourneyResult> {
  const cwd = options?.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const result = await runJourneyWithConfig(journey, config, undefined, cwd, {
    onProgress: options?.onProgress,
  });
  const reports = writeReports(result, resolve(cwd, config.reportDir ?? "reports"));
  return { ...result, reports };
}

export type { Journey, RunResult, ReportPaths };
export {
  diagnoseFailure,
  diagnoseReportJson,
} from "../diagnose/diagnoseFailure.js";
export { formatDiagnosisText } from "../diagnose/formatDiagnosis.js";
export type {
  DiagnosisCode,
  DiagnosisFinding,
  DiagnosisResult,
  ReportJson,
} from "../diagnose/types.js";
