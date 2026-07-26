#!/usr/bin/env node
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { loadConfig } from "../config/loadConfig.js";
import { diagnoseFailure } from "../diagnose/diagnoseFailure.js";
import { formatDiagnosisText } from "../diagnose/formatDiagnosis.js";
import { loadJourney } from "../journey/loadJourney.js";
import {
  runAuthJourneyWithConfig,
  runJourneyWithConfig,
} from "../runner/JourneyRunner.js";
import { writeReports } from "../report/writeReports.js";
import { generatePlanCsvToYaml } from "../plan/generateJourney.js";
import {
  formatPlanValidationErrors,
  validatePlanCsv,
} from "../plan/validatePlanCsv.js";
import { parseAuthArgs } from "./parseAuthArgs.js";
import { resolveReportJson, runExplain } from "./explainReport.js";
import { parseExplainArgs } from "./parseExplainArgs.js";
import { parseGenerateArgs } from "./parseGenerateArgs.js";
import { parseRecordArgs } from "./parseRecordArgs.js";
import { parseRunArgs } from "./parseRunArgs.js";
import { runRecord } from "../record/runRecord.js";

function printHelp(): void {
  console.log(`Analytics Tracker — verify analytics events in the browser

Usage:
  analytics-tracker init
  analytics-tracker validate <plan.csv>
  analytics-tracker generate <plan.csv> [options]
  analytics-tracker record <startUrl> [options]
  analytics-tracker run <journey.yaml|json> [--var name=value ...]
  analytics-tracker auth <journey.yaml|json> [--var name=value ...] [--headed|--headless]
  analytics-tracker explain <reportDir|report.json> [--json] [--verbose]
  analytics-tracker help

Validate:
  Checks the CSV against the canonical plan format. Extra columns are ignored.
  Exit 0 on PASS, 1 on FAIL (prints all errors).

Generate options:
  --name <name>         Journey name (default: CSV filename)
  --adapters a,b        Adapter list (default: snowplow)
  --out <file>          Output path (default: journeys/<name>.yaml)
  --base-url <url>      Optional baseUrl in the journey
  --overwrite           Overwrite existing output file

Record options:
  --plan <plan.csv>     Plan CSV to seed expect + coverage (recommended)
  --name <name>         Journey name (default: plan basename or recorded)
  --adapters a,b        Adapter list (default: snowplow)
  --out <file>          Output path (default: journeys/<name>.yaml)
  --base-url <url>      Optional baseUrl in the journey
  --storage-state <f>   Playwright storageState for logged-in sessions
  --overwrite           Overwrite existing output file
  --force               Allow writing when zero steps were recorded
  --allow-incomplete    Exit 0 even if plan events are missing
  --include-unplanned   Add expect entries for unplanned captured events

Run options:
  --var name=value      Substitute \${name} in the journey file (repeatable)

Auth options:
  --var name=value      Substitute \${name} in the journey file (repeatable)
  --headed              Run with a visible browser window (default)
  --headless            Run without a visible browser window
                         (last of --headed/--headless wins if both given)

Explain:
  Shows a human-friendly diagnosis (recomputed from report data).
  --json                Print the full diagnosis object as JSON
  --verbose             List every technical finding (default is summary-first)

  Tip: prefer --out=path / --var=name=value form. In PowerShell, quote flags:
  '--out=journeys/x.yaml' '--var=service_id=450'

npm scripts:
  npm run track -- init
  npm run track -- validate plans/demo.csv
  npm run track -- generate plans/demo.csv
  npm run track -- record http://127.0.0.1:4173/ --plan plans/demo.csv
  npm run track -- run journeys/demo.yaml
  npm run track -- run journeys/add-areas-via-upsell.yaml --var service_id=450
  npm run track -- auth journeys/login.example.yaml --var AUTH_EMAIL=a@b.com --var AUTH_PASSWORD=secret
  npm run demo
`);
}

function cmdInit(cwd: string): void {
  const journeysDir = join(cwd, "journeys");
  mkdirSync(journeysDir, { recursive: true });

  const configPath = join(cwd, "analytics-tracker.config.yaml");
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      `# Default config for Analytics Tracker
baseUrl: http://127.0.0.1:4173
headless: true
reportDir: reports
snowplow:
  collectorPatterns:
    - "/i"
    - "/com.snowplowanalytics.snowplow/tp2"
    - "/snowplow/"
`,
      "utf8",
    );
    console.log(`Created ${configPath}`);
  } else {
    console.log(`Config already exists: ${configPath}`);
  }

  const examplePath = join(journeysDir, "example.yaml");
  if (!existsSync(examplePath)) {
    writeFileSync(
      examplePath,
      `name: example
baseUrl: http://127.0.0.1:4173
options:
  ordered: false
  match: partial
  forbidExtra: false
adapters:
  - snowplow
steps:
  - action: goto
    path: /
  - action: click
    selector: "#track-page-view"
  - action: waitForEvent
    eventName: page_view
    timeoutMs: 5000
expect:
  - eventName: page_view
    properties:
      page: home
`,
      "utf8",
    );
    console.log(`Created ${examplePath}`);
  } else {
    console.log(`Example journey already exists: ${examplePath}`);
  }

  const loginExamplePath = join(journeysDir, "login.example.yaml");
  if (!existsSync(loginExamplePath)) {
    writeFileSync(
      loginExamplePath,
      `# Example auth journey — copy and fill real selectors for your site.
# Usage:
#   npm run track -- auth journeys/login.example.yaml \\
#     --var AUTH_EMAIL=you@example.com \\
#     --var AUTH_PASSWORD=secret
# Then point tracking journeys at the written storageState path.

name: login-example
baseUrl: https://staging.example.com
adapters:
  - snowplow
expect: []
steps:
  - action: goto
    path: /login
  - action: fill
    selector: "#TODO-email"
    value: "\${AUTH_EMAIL}"
  - action: fill
    selector: "#TODO-password"
    value: "\${AUTH_PASSWORD}"
  - action: click
    selector: "#TODO-login-submit"
  - action: waitForSelector
    selector: "#TODO-logged-in-marker"
  - action: saveStorageState
    path: .auth/storage-state.json
`,
      "utf8",
    );
    console.log(`Created ${loginExamplePath}`);
  } else {
    console.log(`Login example already exists: ${loginExamplePath}`);
  }

  console.log("\nNext: npm run demo  (in another terminal)");
  console.log("Then:  npm run track -- run journeys/example.yaml");
}

function cmdValidate(csvPath: string, cwd: string): number {
  const csvAbs = resolve(cwd, csvPath);
  if (!existsSync(csvAbs)) {
    console.error(`Plan CSV not found: ${csvAbs}`);
    return 1;
  }

  const csvText = readFileSync(csvAbs, "utf8");
  const result = validatePlanCsv(csvText);
  if (!result.ok) {
    console.error("FAIL");
    console.error(formatPlanValidationErrors(result.errors));
    return 1;
  }

  console.log(`PASS (${result.rows.length} row${result.rows.length === 1 ? "" : "s"})`);
  return 0;
}

function cmdGenerate(args: string[], cwd: string): number {
  const opts = parseGenerateArgs(args);
  const csvAbs = resolve(cwd, opts.csvPath);
  if (!existsSync(csvAbs)) {
    console.error(`Plan CSV not found: ${csvAbs}`);
    return 1;
  }

  const outAbs = resolve(cwd, opts.outPath);
  if (existsSync(outAbs) && !opts.force) {
    console.error(`Output already exists: ${outAbs} (use --overwrite to replace)`);
    return 1;
  }

  const csvText = readFileSync(csvAbs, "utf8");
  const generated = generatePlanCsvToYaml(csvText, {
    name: opts.name,
    adapters: opts.adapters,
    baseUrl: opts.baseUrl,
  });

  if (!generated.ok) {
    console.error("FAIL — plan CSV is invalid; journey not written");
    console.error(formatPlanValidationErrors(generated.errors));
    return 1;
  }

  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, generated.yaml, "utf8");
  console.log(`Generated ${outAbs}`);
  console.log(`Review TODO selectors (if any), then: npm run track -- run ${opts.outPath}`);
  return 0;
}

export function cmdExplain(
  inputPath: string,
  cwd: string,
  options: { json?: boolean; verbose?: boolean } = {},
): number {
  const reportPath = resolveReportJson(inputPath, cwd);
  const result = runExplain(reportPath, options);
  console.log(result.stdout);
  return result.exitCode;
}

async function cmdRun(
  journeyPath: string,
  cwd: string,
  vars: Record<string, string> = {},
): Promise<number> {
  const config = loadConfig(cwd);
  const journey = loadJourney(journeyPath, cwd, vars);
  console.log(`Running journey: ${journey.name}`);
  console.log(`baseUrl: ${journey.baseUrl ?? config.baseUrl}`);
  if (Object.keys(vars).length > 0) {
    console.log(`vars: ${JSON.stringify(vars)}`);
  }

  const result = await runJourneyWithConfig(journey, config, undefined, cwd, {
    onProgress: (message) => console.log(message),
  });
  const reports = writeReports(result, resolve(cwd, config.reportDir ?? "reports"));

  console.log("");
  console.log(result.pass ? "PASS" : "FAIL");
  console.log(`Events captured: ${result.events.length}`);
  console.log(`Matched: ${result.verification.matched.length}`);
  console.log(`Missing: ${result.verification.missing.length}`);
  if (result.verification.unexpected.length) {
    console.log(`Unexpected: ${result.verification.unexpected.length}`);
  }
  if (result.captureWarnings.length) {
    console.log(`Capture warnings: ${result.captureWarnings.length}`);
  }
  if (result.error) {
    console.log(`Error: ${result.error}`);
  }
  if (!result.pass) {
    const diagnosis = diagnoseFailure(result);
    if (diagnosis) {
      console.log("");
      console.log(formatDiagnosisText(diagnosis));
    }
  }
  if (reports.screenshot) {
    console.log(`Screenshot:  ${reports.screenshot}`);
  }
  console.log(`HTML report: ${reports.html}`);
  console.log(`JSON report: ${reports.json}`);
  console.log(`Markdown:    ${reports.markdown}`);

  return result.pass ? 0 : 1;
}

async function cmdAuth(
  journeyPath: string,
  cwd: string,
  vars: Record<string, string> = {},
  headless?: boolean,
): Promise<number> {
  const config = loadConfig(cwd);
  const journey = loadJourney(journeyPath, cwd, vars, { mode: "auth" });
  console.log(`Running auth journey: ${journey.name}`);
  console.log(`baseUrl: ${journey.baseUrl ?? config.baseUrl}`);
  if (Object.keys(vars).length > 0) {
    console.log(`vars: ${Object.keys(vars).join(", ")}`);
  }

  const result = await runAuthJourneyWithConfig(journey, config, cwd, {
    headless: headless ?? false,
    onProgress: (message) => console.log(message),
  });

  console.log("");
  console.log(result.pass ? "PASS" : "FAIL");
  for (const path of result.storageStatePaths) {
    console.log(`Wrote storageState: ${path}`);
  }
  if (result.error) {
    console.log(`Error: ${result.error}`);
  }

  return result.pass ? 0 : 1;
}

async function cmdRecord(
  opts: ReturnType<typeof parseRecordArgs>,
  cwd: string,
  config: ReturnType<typeof loadConfig>,
): Promise<number> {
  const result = await runRecord(
    {
      ...opts,
      cwd,
      headless: false,
    },
    config,
  );
  return result.exitCode;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cwd = process.cwd();
  const cmd = args[0];

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    process.exit(0);
  }

  if (cmd === "init") {
    cmdInit(cwd);
    process.exit(0);
  }

  if (cmd === "validate") {
    const csvPath = args[1];
    if (!csvPath) {
      console.error("Usage: analytics-tracker validate <plan.csv>");
      process.exit(1);
    }
    process.exit(cmdValidate(csvPath, cwd));
  }

  if (cmd === "generate") {
    try {
      process.exit(cmdGenerate(args.slice(1), cwd));
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  if (cmd === "record") {
    try {
      const opts = parseRecordArgs(args.slice(1));
      const config = loadConfig(cwd);
      const code = await cmdRecord(opts, cwd, config);
      process.exit(code);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  if (cmd === "run") {
    try {
      const opts = parseRunArgs(args.slice(1));
      const code = await cmdRun(opts.journeyPath, cwd, opts.vars);
      process.exit(code);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  if (cmd === "auth") {
    try {
      const opts = parseAuthArgs(args.slice(1));
      const code = await cmdAuth(opts.journeyPath, cwd, opts.vars, opts.headless);
      process.exit(code);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  if (cmd === "explain") {
    try {
      const opts = parseExplainArgs(args.slice(1));
      process.exit(
        cmdExplain(opts.reportPath, cwd, {
          json: opts.json,
          verbose: opts.verbose,
        }),
      );
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
