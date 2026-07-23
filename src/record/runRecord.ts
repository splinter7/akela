import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AppConfig, Step } from "../normalize/types.js";
import {
  formatPlanValidationErrors,
  validatePlanCsv,
  type PlanRow,
} from "../plan/validatePlanCsv.js";
import { createDefaultRegistry } from "../runner/JourneyRunner.js";
import {
  buildExpectExploratory,
  buildExpectFromPlan,
  suggestWaitForEventSteps,
} from "./expectBuilder.js";
import {
  computePlanCoverage,
  formatPlanCoverageSummary,
  type PlanCoverage,
} from "./planCoverage.js";
import {
  RecorderSession,
  type RecorderSessionResult,
} from "./RecorderSession.js";
import { writeDraftJourneyYaml } from "./writeDraftJourney.js";

export type RunRecordOptions = {
  startUrl: string;
  planPath?: string;
  name: string;
  adapters: string[];
  outPath: string;
  baseUrl?: string;
  storageState?: string;
  overwrite: boolean;
  force: boolean;
  allowIncomplete: boolean;
  includeUnplanned: boolean;
  cwd?: string;
  /** Skip Enter prompt (also skipped when `CI` is set). */
  autoStop?: boolean;
  headless?: boolean;
};

export type RunRecordResult = {
  exitCode: number;
  outAbs?: string;
  coverage?: PlanCoverage;
};

export type RunRecordDeps = {
  /** Inject a fixed session result (no browser). */
  captureSession?: () => Promise<RecorderSessionResult>;
  /** Override stop signal (default: wait for Enter on stdin). */
  waitForStop?: () => Promise<void>;
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function defaultWaitForEnter(log: (m: string) => void): Promise<void> {
  log("Recording… press Enter to stop.");
  return new Promise<void>((resolveWait) => {
    const onData = () => {
      process.stdin.off("data", onData);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode?.(false);
      }
      resolveWait();
    };
    process.stdin.on("data", onData);
    if (process.stdin.isTTY) {
      process.stdin.resume();
    }
  });
}

/** Remap fragile indexes after waitForEvent insertions. */
function remapFragileIndexes(
  originalSteps: Step[],
  stepsWithWaits: Step[],
  fragileOriginal: number[],
): number[] {
  const fragile = new Set(fragileOriginal);
  const remapped: number[] = [];
  let origIdx = 0;
  for (let i = 0; i < stepsWithWaits.length; i++) {
    const step = stepsWithWaits[i]!;
    if (
      step.action === "waitForEvent" &&
      (origIdx >= originalSteps.length ||
        originalSteps[origIdx]?.action !== "waitForEvent")
    ) {
      continue;
    }
    if (fragile.has(origIdx)) remapped.push(i);
    origIdx++;
  }
  return remapped;
}

async function captureViaSession(
  opts: RunRecordOptions,
  config: AppConfig,
  deps: RunRecordDeps,
  log: (m: string) => void,
): Promise<RecorderSessionResult> {
  const cwd = opts.cwd ?? process.cwd();
  const storageStateAbs = opts.storageState
    ? resolve(cwd, opts.storageState)
    : undefined;

  const sessionConfig: AppConfig = {
    ...config,
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
  };

  const session = new RecorderSession({
    startUrl: opts.startUrl,
    adapters: opts.adapters,
    config: sessionConfig,
    storageStateAbs,
    headless: opts.headless ?? false,
  });

  await session.start();

  const skipPrompt =
    opts.autoStop === true ||
    process.env.CI === "true" ||
    process.env.CI === "1";

  if (deps.waitForStop) {
    await deps.waitForStop();
  } else if (!skipPrompt) {
    await defaultWaitForEnter(log);
  }

  return session.stop();
}

export async function runRecord(
  opts: RunRecordOptions,
  config: AppConfig,
  deps: RunRecordDeps = {},
): Promise<RunRecordResult> {
  const cwd = opts.cwd ?? process.cwd();
  const log = deps.log ?? ((m) => console.log(m));
  const error = deps.error ?? ((m) => console.error(m));

  let planRows: PlanRow[] | undefined;
  let planPathForMeta: string | undefined;

  if (opts.planPath) {
    const planAbs = resolve(cwd, opts.planPath);
    if (!existsSync(planAbs)) {
      error(`Plan CSV not found: ${planAbs}`);
      return { exitCode: 1 };
    }
    const csvText = readFileSync(planAbs, "utf8");
    const validated = validatePlanCsv(csvText);
    if (!validated.ok) {
      error("FAIL — plan CSV is invalid; recording not started");
      error(formatPlanValidationErrors(validated.errors));
      return { exitCode: 1 };
    }
    planRows = validated.rows;
    planPathForMeta = opts.planPath;
  }

  const registry = createDefaultRegistry(config);
  try {
    registry.assertKnown(opts.adapters);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    return { exitCode: 1 };
  }

  const outAbs = resolve(cwd, opts.outPath);
  if (existsSync(outAbs) && !opts.overwrite) {
    error(`Output already exists: ${outAbs} (use --overwrite to replace)`);
    return { exitCode: 1 };
  }

  const captured = deps.captureSession
    ? await deps.captureSession()
    : await captureViaSession(opts, config, deps, log);

  for (const warning of captured.warnings) {
    log(`Warning: ${warning}`);
  }

  let coverage: PlanCoverage | undefined;
  let steps = captured.steps;
  let fragileStepIndexes = captured.fragileStepIndexes ?? [];
  let expectEvents;

  if (planRows) {
    coverage = computePlanCoverage(planRows, captured.events);
    expectEvents = buildExpectFromPlan(planRows, coverage, {
      includeUnplanned: opts.includeUnplanned,
    });
    const withWaits = suggestWaitForEventSteps(
      steps,
      coverage,
      captured.actionTimestamps,
    );
    fragileStepIndexes = remapFragileIndexes(
      steps,
      withWaits,
      fragileStepIndexes,
    );
    steps = withWaits;
  } else {
    expectEvents = buildExpectExploratory(captured.events);
  }

  if (steps.length === 0 && !opts.force) {
    log("No steps recorded; draft not written (use --force to write anyway).");
    if (coverage) {
      log(formatPlanCoverageSummary(coverage, captured.fragileCount));
    } else {
      log(`Fragile selectors: ${captured.fragileCount}`);
    }
    return {
      exitCode:
        coverage && coverage.missing.length > 0 && !opts.allowIncomplete
          ? 1
          : 0,
      coverage,
    };
  }

  const journeyBaseUrl = opts.baseUrl ?? config.baseUrl;
  const yaml = writeDraftJourneyYaml(
    {
      name: opts.name,
      ...(journeyBaseUrl !== undefined ? { baseUrl: journeyBaseUrl } : {}),
      ...(opts.storageState !== undefined
        ? { storageState: opts.storageState }
        : {}),
      gotoWaitUntil: "domcontentloaded",
      options: { ordered: true, match: "partial", forbidExtra: false },
      adapters: opts.adapters,
      steps,
      expect: expectEvents,
    },
    {
      planPath: planPathForMeta,
      exploratory: !planRows,
      fragileStepIndexes,
    },
  );

  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, yaml, "utf8");
  log(`Wrote ${outAbs}`);

  if (coverage) {
    log(formatPlanCoverageSummary(coverage, captured.fragileCount));
  } else {
    log(`Fragile selectors: ${captured.fragileCount}`);
  }
  log(`Next: npm run track -- run ${opts.outPath}`);

  const exitCode =
    coverage && coverage.missing.length > 0 && !opts.allowIncomplete ? 1 : 0;

  return { exitCode, outAbs, coverage };
}
