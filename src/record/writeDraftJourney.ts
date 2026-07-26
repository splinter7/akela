import { stringify } from "yaml";
import type { Journey, Step } from "../normalize/types.js";

export type DraftJourneyMeta = {
  planPath?: string;
  exploratory: boolean;
  fragileStepIndexes: number[];
};

function indentBlock(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

function draftHeader(meta: DraftJourneyMeta): string {
  if (meta.exploratory) {
    return "# DRAFT — exploratory (no --plan)";
  }
  const planPath = meta.planPath ?? "";
  return `# DRAFT — review selectors; expect seeded from plan ${planPath}`;
}

function emitStep(step: Step): string {
  return indentBlock(stringify([step]).trimEnd(), 2);
}

/** Emit draft journey YAML with DRAFT header and optional FRAGILE-SELECTOR comments. */
export function writeDraftJourneyYaml(
  journey: Journey,
  meta: DraftJourneyMeta,
): string {
  const fragile = new Set(meta.fragileStepIndexes);
  const lines: string[] = [];

  lines.push(draftHeader(meta));
  lines.push(`name: ${journey.name}`);
  if (journey.baseUrl !== undefined) {
    lines.push(`baseUrl: ${journey.baseUrl}`);
  }
  if (journey.gotoWaitUntil !== undefined) {
    lines.push(`gotoWaitUntil: ${journey.gotoWaitUntil}`);
  }
  if (journey.storageState !== undefined) {
    lines.push(`storageState: ${journey.storageState}`);
  }
  if (journey.options !== undefined) {
    lines.push("options:");
    lines.push(indentBlock(stringify(journey.options).trimEnd(), 2));
  }
  lines.push("adapters:");
  for (const adapter of journey.adapters) {
    lines.push(`  - ${adapter}`);
  }

  lines.push("steps:");
  for (let i = 0; i < journey.steps.length; i++) {
    if (fragile.has(i)) {
      lines.push("  # FRAGILE-SELECTOR");
    }
    lines.push(emitStep(journey.steps[i]!));
  }

  lines.push("expect:");
  lines.push(indentBlock(stringify(journey.expect).trimEnd(), 2));
  lines.push("");
  return lines.join("\n");
}
