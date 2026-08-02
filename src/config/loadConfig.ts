import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { AppConfig } from "../normalize/types.js";
import {
  appConfigSchema,
  formatZodConfigErrors,
  type AppConfigSchema,
} from "./configSchema.js";

const DEFAULT_CONFIG: AppConfig = {
  baseUrl: "http://127.0.0.1:4173",
  headless: true,
  reportDir: "reports",
  plansDir: "plans",
  journeysDir: "journeys",
  quietMs: 200,
  quietTimeoutMs: 2000,
  snowplow: {
    collectorPatterns: [
      "/i",
      "/com.snowplowanalytics.snowplow/tp2",
      "/snowplow/",
    ],
  },
};

export function loadConfig(cwd = process.cwd()): AppConfigSchema {
  const path = resolve(cwd, "akela.config.yaml");
  if (!existsSync(path)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = parseYaml(readFileSync(path, "utf8")) as Record<string, unknown>;
  const merged: AppConfig = {
    ...DEFAULT_CONFIG,
    ...raw,
    storageState:
      (raw.storageState as string | undefined) ?? DEFAULT_CONFIG.storageState,
    gotoWaitUntil:
      (raw.gotoWaitUntil as AppConfig["gotoWaitUntil"]) ??
      DEFAULT_CONFIG.gotoWaitUntil,
    quietMs: (raw.quietMs as number | undefined) ?? DEFAULT_CONFIG.quietMs,
    quietTimeoutMs:
      (raw.quietTimeoutMs as number | undefined) ?? DEFAULT_CONFIG.quietTimeoutMs,
    snowplow: {
      ...DEFAULT_CONFIG.snowplow,
      ...(raw.snowplow as AppConfig["snowplow"]),
      collectorPatterns:
        (raw.snowplow as AppConfig["snowplow"])?.collectorPatterns ??
        DEFAULT_CONFIG.snowplow?.collectorPatterns,
    },
  };

  const parsed = appConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(
      `Invalid akela.config.yaml:\n${formatZodConfigErrors(parsed.error)}`,
    );
  }
  return parsed.data;
}
