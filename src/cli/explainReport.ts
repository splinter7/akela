import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { diagnoseReportJson } from "../diagnose/diagnoseFailure.js";
import { formatDiagnosisText } from "../diagnose/formatDiagnosis.js";
import type { ReportJson } from "../diagnose/types.js";

export interface ExplainResult {
  exitCode: number;
  stdout: string;
}

export function resolveReportJson(input: string, cwd: string): string {
  const abs = resolve(cwd, input);
  if (!existsSync(abs)) {
    throw new Error(`Report not found: ${abs}`);
  }

  if (statSync(abs).isDirectory()) {
    const candidate = join(abs, "report.json");
    if (!existsSync(candidate)) {
      throw new Error(`No report.json in directory: ${abs}`);
    }
    return candidate;
  }

  return abs;
}

export function runExplain(
  reportPath: string,
  options: boolean | { json?: boolean; verbose?: boolean } = {},
): ExplainResult {
  const opts = typeof options === "boolean" ? { json: options } : options;
  const json = opts.json === true;
  const verbose = opts.verbose === true;
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as ReportJson;
  const diagnosis = diagnoseReportJson(report);

  if (!diagnosis) {
    return {
      exitCode: 0,
      stdout: json
        ? JSON.stringify({ pass: true, diagnosis: null })
        : "No diagnosis: report passed.",
    };
  }

  return {
    exitCode: 0,
    stdout: json
      ? JSON.stringify(diagnosis, null, 2)
      : formatDiagnosisText(diagnosis, { verbose }),
  };
}
