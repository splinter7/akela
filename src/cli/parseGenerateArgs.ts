import { basename, join } from "node:path";

export type GenerateCliOptions = {
  csvPath: string;
  name: string;
  adapters: string[];
  outPath: string;
  baseUrl?: string;
  force: boolean;
};

function defaultNameFromCsv(csvPath: string): string {
  const base = basename(csvPath);
  return base.replace(/\.csv$/i, "") || "journey";
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

export function parseGenerateArgs(args: string[]): GenerateCliOptions {
  if (args.length === 0 || args[0]!.startsWith("-")) {
    throw new Error(
      "Usage: akela generate <plan.csv> [--name <name>] [--adapters a,b] [--out <file>] [--base-url <url>] [--overwrite]",
    );
  }

  const csvPath = args[0]!;
  let name = defaultNameFromCsv(csvPath);
  let adapters = ["snowplow"];
  let outPath: string | undefined;
  let baseUrl: string | undefined;
  let force = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--name" || arg.startsWith("--name=")) {
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
    } else if (arg === "--overwrite" || arg === "--force") {
      force = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    csvPath,
    name,
    adapters,
    outPath: outPath ?? join("journeys", `${name}.yaml`),
    baseUrl,
    force,
  };
}
