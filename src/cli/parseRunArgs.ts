import { parseVarAssignment, takeFlagValue } from "./parseVarFlags.js";

export type RunCliOptions = {
  journeyPath: string;
  vars: Record<string, string>;
};

/**
 * Parse `run` CLI args: <journey> [--var name=value ...]
 */
export function parseRunArgs(args: string[]): RunCliOptions {
  if (args.length === 0 || args[0]!.startsWith("-")) {
    throw new Error(
      "Usage: akela run <journey.yaml|json> [--var name=value ...]",
    );
  }

  const journeyPath = args[0]!;
  const vars: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--var" || arg.startsWith("--var=")) {
      const { value, nextIndex } = takeFlagValue(args, i, "--var");
      const { name, value: varValue } = parseVarAssignment(value);
      vars[name] = varValue;
      i = nextIndex;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { journeyPath, vars };
}
