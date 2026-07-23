import type { ExpectedEvent, NormalizedEvent } from "../normalize/types.js";
import type { PlanRow } from "../plan/parsePlanCsv.js";
import { findMatchingEvent } from "../verify/EventVerifier.js";

export type PlanCoverage = {
  matched: { row: PlanRow; actual: NormalizedEvent }[];
  missing: PlanRow[];
  unexpected: NormalizedEvent[];
};

const DEFAULT_NOISE_EVENT_NAMES = ["page_ping"];

function rowToExpected(row: PlanRow): ExpectedEvent {
  return {
    eventName: row.eventName,
    ...(row.properties !== undefined ? { properties: row.properties } : {}),
    ...(row.fields !== undefined ? { fields: row.fields } : {}),
  };
}

function findFirstUnusedMatch(
  captured: NormalizedEvent[],
  expected: ExpectedEvent,
  used: Set<number>,
): { event: NormalizedEvent; index: number } | undefined {
  for (let i = 0; i < captured.length; i++) {
    if (used.has(i)) continue;
    const hit = findMatchingEvent(captured, expected, "partial", i);
    if (hit && hit.index === i) return hit;
  }
  return undefined;
}

function formatMissingRow(row: PlanRow): string {
  const parts: string[] = [];
  if (row.properties) {
    for (const key of Object.keys(row.properties)) {
      parts.push(`properties.${key}`);
    }
  }
  if (row.fields) {
    for (const key of Object.keys(row.fields)) {
      parts.push(`fields.${key}`);
    }
  }
  if (parts.length === 0) {
    return row.eventName;
  }
  return `${row.eventName} (${parts.join(", ")})`;
}

export function computePlanCoverage(
  rows: PlanRow[],
  captured: NormalizedEvent[],
  options?: { noiseEventNames?: string[] },
): PlanCoverage {
  const used = new Set<number>();
  const matched: PlanCoverage["matched"] = [];
  const missing: PlanRow[] = [];

  for (const row of rows) {
    const expected = rowToExpected(row);
    const hit = findFirstUnusedMatch(captured, expected, used);
    if (hit) {
      used.add(hit.index);
      matched.push({ row, actual: hit.event });
    } else {
      missing.push(row);
    }
  }

  const planEventNames = new Set(rows.map((r) => r.eventName));
  const noise = new Set(options?.noiseEventNames ?? DEFAULT_NOISE_EVENT_NAMES);
  const unexpected = captured.filter(
    (evt, index) =>
      !used.has(index) &&
      !noise.has(evt.eventName) &&
      !planEventNames.has(evt.eventName),
  );

  return { matched, missing, unexpected };
}

export function formatPlanCoverageSummary(
  coverage: PlanCoverage,
  fragileCount: number,
): string {
  const lines: string[] = [
    `Plan coverage: ${coverage.matched.length} matched, ${coverage.missing.length} missing, ${coverage.unexpected.length} unexpected`,
  ];

  if (coverage.missing.length > 0) {
    const entries = coverage.missing.map((row) => formatMissingRow(row));
    lines.push(`  Missing: ${entries.join(", ")}`);
  }

  if (coverage.unexpected.length > 0) {
    const names = coverage.unexpected.map((evt) => evt.eventName);
    lines.push(`  Unexpected: ${names.join(", ")}`);
  }

  lines.push(`Fragile selectors: ${fragileCount}`);
  return lines.join("\n");
}
