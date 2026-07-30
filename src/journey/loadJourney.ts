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

function extractFileVars(raw: string, isJson: boolean): Record<string, string> {
  try {
    const data: unknown = isJson ? JSON.parse(raw) : parseYaml(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return {};
    }
    const vars = (data as Record<string, unknown>).vars;
    if (vars === undefined || vars === null) {
      return {};
    }
    if (typeof vars !== "object" || Array.isArray(vars)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(vars)) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        out[key] = String(value);
      }
    }
    return out;
  } catch {
    // Soft-parse failure: fall back to CLI + inline defaults only.
    return {};
  }
}

function stripVars(data: Record<string, unknown>): Journey {
  const { vars: _vars, ...journey } = data;
  return journey as Journey;
}

export function loadJourney(
  filePath: string,
  cwd = process.cwd(),
  cliVars: Record<string, string> = {},
  options: LoadJourneyOptions = {},
): Journey {
  const absolute = resolve(cwd, filePath);
  const isJson = absolute.endsWith(".json");
  const raw = readFileSync(absolute, "utf8");
  const fileVars = extractFileVars(raw, isJson);
  const merged = { ...fileVars, ...cliVars };
  const text = substituteVars(raw, merged);
  const data: unknown = isJson ? JSON.parse(text) : parseYaml(text);

  const mode = options.mode ?? "run";
  const schema = mode === "auth" ? authJourneySchema : journeySchema;
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Invalid journey ${filePath}:\n${formatZodJourneyErrors(parsed.error)}`,
    );
  }

  return stripVars(parsed.data as Record<string, unknown>);
}
