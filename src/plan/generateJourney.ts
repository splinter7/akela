import { stringify } from "yaml";
import type { ExpectedEvent, Journey, Step } from "../normalize/types.js";
import type { PlanRow } from "./parsePlanCsv.js";
import {
  validatePlanCsv,
  type PlanValidationError,
} from "./validatePlanCsv.js";

export type GenerateJourneyOptions = {
  name: string;
  adapters?: string[];
  baseUrl?: string;
};

export function slugifyEventName(eventName: string): string {
  const slug = eventName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "element";
}

export function placeholderSelector(eventName: string): string {
  return `#TODO-${slugifyEventName(eventName)}`;
}

function rowToTriggerSteps(row: PlanRow): Step[] {
  switch (row.trigger) {
    case "page_load":
      return [{ action: "goto", path: row.path! }];
    case "click": {
      const selector = row.selector ?? placeholderSelector(row.eventName);
      return [{ action: "click", selector }];
    }
    case "fill": {
      const selector = row.selector ?? placeholderSelector(row.eventName);
      return [{ action: "fill", selector, value: row.value! }];
    }
    case "scroll":
      return [
        row.selector
          ? { action: "scroll", selector: row.selector }
          : { action: "scroll" },
      ];
  }
}

function rowToExpected(row: PlanRow): ExpectedEvent {
  return {
    eventName: row.eventName,
    ...(row.properties !== undefined ? { properties: row.properties } : {}),
    ...(row.fields !== undefined ? { fields: row.fields } : {}),
  };
}

function rowToWaitStep(row: PlanRow): Step {
  return {
    action: "waitForEvent",
    eventName: row.eventName,
    timeoutMs: 5000,
    ...(row.properties !== undefined ? { properties: row.properties } : {}),
    ...(row.fields !== undefined ? { fields: row.fields } : {}),
  };
}

export function planRowsToJourney(rows: PlanRow[], options: GenerateJourneyOptions): Journey {
  const steps: Step[] = [];
  const expect: ExpectedEvent[] = [];

  for (const row of rows) {
    steps.push(...rowToTriggerSteps(row));
    steps.push(rowToWaitStep(row));
    expect.push(rowToExpected(row));
  }

  return {
    name: options.name,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    options: {
      ordered: true,
      match: "partial",
      forbidExtra: false,
    },
    adapters: options.adapters ?? ["snowplow"],
    steps,
    expect,
  };
}

function indentBlock(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

/** Emit journey YAML with optional `# notes` comments above each row's trigger steps. */
export function generateJourneyYaml(rows: PlanRow[], options: GenerateJourneyOptions): string {
  const journey = planRowsToJourney(rows, options);
  const lines: string[] = [];

  lines.push(`name: ${journey.name}`);
  if (journey.baseUrl !== undefined) {
    lines.push(`baseUrl: ${journey.baseUrl}`);
  }
  lines.push("options:");
  lines.push(indentBlock(stringify(journey.options).trimEnd(), 2));
  lines.push("adapters:");
  for (const adapter of journey.adapters) {
    lines.push(`  - ${adapter}`);
  }

  lines.push("steps:");
  for (const row of rows) {
    const triggerSteps = rowToTriggerSteps(row);
    const waitStep = rowToWaitStep(row);
    const rowSteps = [...triggerSteps, waitStep];

    if (row.notes) {
      const safeNote = row.notes.replace(/\r?\n/g, " ").trim();
      lines.push(`  # ${safeNote}`);
    }

    const chunk = stringify(rowSteps).trimEnd();
    lines.push(indentBlock(chunk, 2));
  }

  lines.push("expect:");
  lines.push(indentBlock(stringify(journey.expect).trimEnd(), 2));
  lines.push("");
  return lines.join("\n");
}

/** Validate CSV then produce journey YAML — does not write to disk. */
export function generatePlanCsvToYaml(
  csvText: string,
  options: GenerateJourneyOptions,
): { ok: true; yaml: string; rows: PlanRow[] } | { ok: false; errors: PlanValidationError[] } {
  const result = validatePlanCsv(csvText);
  if (!result.ok) return result;
  return {
    ok: true,
    rows: result.rows,
    yaml: generateJourneyYaml(result.rows, options),
  };
}
