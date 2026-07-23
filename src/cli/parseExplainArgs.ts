export type ExplainCliOptions = {
  reportPath: string;
  json: boolean;
  verbose: boolean;
};

const usage =
  "Usage: analytics-tracker explain <reportDir|report.json> [--json] [--verbose]";

export function parseExplainArgs(args: string[]): ExplainCliOptions {
  if (args.length === 0 || args[0]!.startsWith("-")) {
    throw new Error(usage);
  }

  const reportPath = args[0]!;
  let json = false;
  let verbose = false;

  for (const arg of args.slice(1)) {
    if (arg === "--json") {
      json = true;
    } else if (arg === "--verbose") {
      verbose = true;
    } else {
      throw new Error(`Unknown option: ${arg}\n${usage}`);
    }
  }

  return { reportPath, json, verbose };
}
