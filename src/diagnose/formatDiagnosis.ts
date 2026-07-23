import { diagnosisLabel } from "./labels.js";
import type { DiagnosisResult } from "./types.js";

export type FormatDiagnosisOptions = {
  verbose?: boolean;
};

function normalizePresentation(diagnosis: DiagnosisResult): DiagnosisResult {
  const primaryFindingIndexes =
    diagnosis.primaryFindingIndexes ??
    diagnosis.findings.map((_, i) => i);
  return {
    ...diagnosis,
    guidance: diagnosis.guidance ?? [],
    primaryFindingIndexes,
  };
}

function appendFinding(
  lines: string[],
  label: string,
  message: string,
): void {
  const msgLines = message.split("\n");
  lines.push(`- [${label}] ${msgLines[0] ?? ""}`);
  for (const cont of msgLines.slice(1)) {
    lines.push(`  ${cont}`);
  }
}

export function formatDiagnosisText(
  diagnosis: DiagnosisResult,
  options: FormatDiagnosisOptions = {},
): string {
  const d = normalizePresentation(diagnosis);
  const verbose = options.verbose === true;
  const summaryLine = d.summary.split("\n")[0] ?? d.summary;
  const lines = [`Diagnosis: ${summaryLine}`, ""];

  if (d.guidance.length > 0) {
    lines.push("What to try:");
    for (const g of d.guidance) {
      lines.push(`- ${g}`);
    }
    lines.push("");
  }

  if (verbose) {
    for (const f of d.findings) {
      appendFinding(lines, f.code, f.message);
    }
  } else {
    for (const idx of d.primaryFindingIndexes) {
      const f = d.findings[idx];
      if (!f) continue;
      appendFinding(lines, diagnosisLabel(f.code), f.message);
    }
    if (d.cascadeNote) {
      lines.push("");
      lines.push(d.cascadeNote);
    }
    const truncated =
      d.cascadeNote !== undefined ||
      d.primaryFindingIndexes.length < d.findings.length;
    if (truncated) {
      lines.push("");
      lines.push(
        "(Use: npm run track -- explain <report> --verbose for full technical findings)",
      );
    }
  }

  return lines.join("\n");
}
