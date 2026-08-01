import { basename } from "node:path";

export type RecordCliOptions = {
  startUrl: string;
  planPath?: string;
  name: string;
  adapters: string[];
  outPath?: string;
  baseUrl?: string;
  storageState?: string;
  overwrite: boolean;
  force: boolean;
  allowIncomplete: boolean;
  includeUnplanned: boolean;
};

function defaultNameFromPlan(planPath: string): string {
  const base = basename(planPath);
  return base.replace(/\.csv$/i, "") || "recorded";
}

function takeFlagValue(
  args: string[],
  i: number,
  flag: string,
): { value: string; nextIndex: number } {
  const arg = args[i]!;
  if (arg.startsWith(`${flag}=`)) {
    const value = arg.slice(flag.length + 1);
    if (!value) throw new Error(`${flag} requires a value`);
    return { value, nextIndex: i };
  }
  const next = args[i + 1];
  if (!next || next.startsWith("-")) throw new Error(`${flag} requires a value`);
  return { value: next, nextIndex: i + 1 };
}

export function parseRecordArgs(args: string[]): RecordCliOptions {
  if (args.length === 0 || args[0]!.startsWith("-")) {
    throw new Error(
      "Usage: akela record <startUrl> [--plan <plan.csv>] [--name <name>] [--adapters a,b] [--out <file>] [--base-url <url>] [--storage-state <file>] [--overwrite] [--force] [--allow-incomplete] [--include-unplanned]",
    );
  }

  const startUrl = args[0]!;
  let planPath: string | undefined;
  let name: string | undefined;
  let adapters = ["snowplow"];
  let outPath: string | undefined;
  let baseUrl: string | undefined;
  let storageState: string | undefined;
  let overwrite = false;
  let force = false;
  let allowIncomplete = false;
  let includeUnplanned = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--plan" || arg.startsWith("--plan=")) {
      const { value, nextIndex } = takeFlagValue(args, i, "--plan");
      planPath = value;
      i = nextIndex;
    } else if (arg === "--name" || arg.startsWith("--name=")) {
      const { value, nextIndex } = takeFlagValue(args, i, "--name");
      name = value;
      i = nextIndex;
    } else if (arg === "--adapters" || arg.startsWith("--adapters=")) {
      const { value, nextIndex } = takeFlagValue(args, i, "--adapters");
      adapters = value
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      if (adapters.length === 0) throw new Error("--adapters must list at least one adapter");
      i = nextIndex;
    } else if (arg === "--out" || arg === "-o" || arg.startsWith("--out=")) {
      const flag = arg.startsWith("--out=") ? "--out" : arg === "-o" ? "-o" : "--out";
      const { value, nextIndex } = takeFlagValue(args, i, flag);
      outPath = value;
      i = nextIndex;
    } else if (arg === "--base-url" || arg.startsWith("--base-url=")) {
      const { value, nextIndex } = takeFlagValue(args, i, "--base-url");
      baseUrl = value;
      i = nextIndex;
    } else if (arg === "--storage-state" || arg.startsWith("--storage-state=")) {
      const { value, nextIndex } = takeFlagValue(args, i, "--storage-state");
      storageState = value;
      i = nextIndex;
    } else if (arg === "--overwrite") {
      overwrite = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--allow-incomplete") {
      allowIncomplete = true;
    } else if (arg === "--include-unplanned") {
      includeUnplanned = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  const resolvedName =
    name ?? (planPath ? defaultNameFromPlan(planPath) : "recorded");

  return {
    startUrl,
    planPath,
    name: resolvedName,
    adapters,
    outPath,
    baseUrl,
    storageState,
    overwrite,
    force,
    allowIncomplete,
    includeUnplanned,
  };
}
