import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Journey } from "../normalize/types.js";
import {
  authJourneySchema,
  formatZodJourneyErrors,
  journeySchema,
} from "./journeySchema.js";
import { substituteVars } from "./substituteVars.js";

export type LoadJourneyOptions = { mode?: "run" | "auth" };

export function loadJourney(
  filePath: string,
  cwd = process.cwd(),
  vars: Record<string, string> = {},
  options: LoadJourneyOptions = {},
): Journey {
  const absolute = resolve(cwd, filePath);
  const raw = readFileSync(absolute, "utf8");
  const text = substituteVars(raw, vars);
  const data: unknown = absolute.endsWith(".json")
    ? JSON.parse(text)
    : parseYaml(text);

  const mode = options.mode ?? "run";
  const schema = mode === "auth" ? authJourneySchema : journeySchema;
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Invalid journey ${filePath}:\n${formatZodJourneyErrors(parsed.error)}`,
    );
  }

  return parsed.data as Journey;
}
