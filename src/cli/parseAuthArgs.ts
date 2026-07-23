import { parseVarAssignment, takeFlagValue } from "./parseVarFlags.js";

export type AuthCliOptions = {
  journeyPath: string;
  vars: Record<string, string>;
  /** undefined = default headed (false headless) */
  headless?: boolean;
};

/**
 * Parse `auth` CLI args: <journey> [--var name=value ...] [--headed|--headless]
 * Last of --headed/--headless wins if both are passed.
 */
export function parseAuthArgs(args: string[]): AuthCliOptions {
  if (args.length === 0 || args[0]!.startsWith("-")) {
    throw new Error(
      "Usage: analytics-tracker auth <journey.yaml|json> [--var name=value ...] [--headed|--headless]",
    );
  }

  const journeyPath = args[0]!;
  const vars: Record<string, string> = {};
  let headless: boolean | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--var" || arg.startsWith("--var=")) {
      const { value, nextIndex } = takeFlagValue(args, i, "--var");
      const { name, value: varValue } = parseVarAssignment(value);
      vars[name] = varValue;
      i = nextIndex;
    } else if (arg === "--headed") {
      headless = false;
    } else if (arg === "--headless") {
      headless = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { journeyPath, vars, headless };
}
