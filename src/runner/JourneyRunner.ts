import { chromium, type Browser, type Page } from "playwright";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type {
  AppConfig,
  Journey,
  NormalizedEvent,
  ProgressFn,
  StepLogEntry,
} from "../normalize/types.js";
import { AdapterRegistry } from "../adapters/registry.js";
import { SnowplowAdapter } from "../adapters/snowplow/SnowplowAdapter.js";
import { NetworkCapture } from "../capture/NetworkCapture.js";
import { verifyEvents, type VerificationResult } from "../verify/EventVerifier.js";
import { executeStep, stepDetail } from "./steps.js";
import { waitForQuietEvents } from "./waitForQuietEvents.js";

export type RunResult = {
  journeyName: string;
  baseUrl: string;
  durationMs: number;
  events: NormalizedEvent[];
  verification: VerificationResult;
  error?: string;
  pass: boolean;
  captureWarnings: string[];
  stepLog: StepLogEntry[];
  artifacts?: {
    screenshot?: Buffer;
  };
};

export type RunJourneyOptions = {
  onProgress?: ProgressFn;
};

export type AuthRunResult = {
  journeyName: string;
  baseUrl: string;
  durationMs: number;
  pass: boolean;
  error?: string;
  storageStatePaths: string[];
  stepLog: StepLogEntry[];
  /** Written only on failure, so a headless auth run leaves visual evidence. */
  screenshotPath?: string;
};

export type AuthJourneyOptions = {
  onProgress?: ProgressFn;
  /** Override headless; auth CLI defaults this to false (headed). */
  headless?: boolean;
};

export function createDefaultRegistry(config: AppConfig): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(
    new SnowplowAdapter({
      collectorPatterns: config.snowplow?.collectorPatterns,
    }),
  );
  return registry;
}

export async function runJourneyWithConfig(
  journey: Journey,
  config: AppConfig,
  registry?: AdapterRegistry,
  cwd = process.cwd(),
  options: RunJourneyOptions = {},
): Promise<RunResult> {
  const started = Date.now();
  const baseUrl = journey.baseUrl ?? config.baseUrl ?? "http://127.0.0.1:4173";
  const reg = registry ?? createDefaultRegistry(config);
  const matchMode = journey.options?.match ?? "partial";
  const gotoWaitUntil =
    journey.gotoWaitUntil ?? config.gotoWaitUntil ?? "domcontentloaded";
  const storageStateRel = journey.storageState ?? config.storageState;
  const onProgress = options.onProgress ?? (() => {});
  const quietMs = config.quietMs ?? 200;
  const quietTimeoutMs = config.quietTimeoutMs ?? 2000;

  let browser: Browser | undefined;
  let page: Page | undefined;
  let error: string | undefined;
  let events: NormalizedEvent[] = [];
  let capture: NetworkCapture | undefined;
  let screenshot: Buffer | undefined;
  let verification: VerificationResult = {
    pass: true,
    matched: [],
    missing: [],
    unexpected: [],
    options: { ordered: false, match: "partial", forbidExtra: false },
  };
  const stepLog: StepLogEntry[] = [];

  try {
    reg.assertKnown(journey.adapters);
    capture = new NetworkCapture(reg, journey.adapters, { onProgress });

    browser = await chromium.launch({ headless: config.headless ?? true });

    let storageState: string | undefined;
    if (storageStateRel) {
      const storageAbs = resolve(cwd, storageStateRel);
      if (!existsSync(storageAbs)) {
        throw new Error(`storageState file not found: ${storageAbs}`);
      }
      storageState = storageAbs;
    }

    const context = await browser.newContext(
      storageState !== undefined ? { storageState } : {},
    );
    page = await context.newPage();
    await capture.attach(page);

    const total = journey.steps.length;
    // windowStart: waitForEvent only matches at/after this index.
    // After waitForEvent: advance past the matched event (consume-on-match).
    // After other steps: mark start of that step so click→wait still sees
    // beacons fired during the triggering action.
    let windowStart = 0;
    for (let i = 0; i < journey.steps.length; i++) {
      const step = journey.steps[i]!;
      const detail = stepDetail(step);
      const eventCountAtStepStart = capture.getEvents().length;
      onProgress(`[${i + 1}/${total}] ${step.action} ${detail}`);
      try {
        const result = await executeStep(page, step, baseUrl, capture, matchMode, {
          gotoWaitUntil,
          onProgress,
          eventSinceIndex: windowStart,
          cwd,
        });
        stepLog.push({
          index: i,
          action: step.action,
          status: result.status,
          detail,
          ...(result.reason !== undefined ? { reason: result.reason } : {}),
        });
        if (result.matchedEventIndex !== undefined) {
          windowStart = result.matchedEventIndex + 1;
        } else {
          windowStart = eventCountAtStepStart;
        }
      } catch (stepErr) {
        const reason =
          stepErr instanceof Error ? stepErr.message : String(stepErr);
        stepLog.push({
          index: i,
          action: step.action,
          status: "failed",
          detail,
          reason,
        });
        throw stepErr;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    onProgress(`error: ${error}`);
    if (page) {
      try {
        screenshot = await page.screenshot({ fullPage: true });
        onProgress("captured failure screenshot");
      } catch {
        // Screenshot is best-effort.
      }
    }
  } finally {
    if (capture) {
      onProgress(
        `quiet drain (quietMs=${quietMs}, timeoutMs=${quietTimeoutMs})…`,
      );
      const before = capture.getEvents().length;
      await waitForQuietEvents(capture, {
        quietMs,
        timeoutMs: quietTimeoutMs,
      });
      events = capture.getEvents();
      onProgress(
        `quiet drain done (events: ${before} → ${events.length})`,
      );
    }

    // Verify while the browser is still open so expect-only FAIL can screenshot.
    onProgress("verifying events…");
    verification = verifyEvents(events, journey.expect, journey.options);
    const pass = !error && verification.pass;
    onProgress(
      `verify ${pass ? "PASS" : "FAIL"} (matched=${verification.matched.length}, missing=${verification.missing.length}, unexpected=${verification.unexpected.length})`,
    );

    if (!pass && screenshot === undefined && page) {
      try {
        screenshot = await page.screenshot({ fullPage: true });
        onProgress("captured failure screenshot");
      } catch {
        // Screenshot is best-effort.
      }
    }

    await browser?.close();
  }

  const pass = !error && verification.pass;
  return {
    journeyName: journey.name,
    baseUrl,
    durationMs: Date.now() - started,
    events,
    verification,
    error,
    pass,
    captureWarnings: capture?.getWarnings() ?? [],
    stepLog,
    ...(screenshot !== undefined ? { artifacts: { screenshot } } : {}),
  };
}

/**
 * Runs a login/auth journey headed by default, with no network capture and
 * no event verification. Succeeds when at least one saveStorageState step ran.
 */
export async function runAuthJourneyWithConfig(
  journey: Journey,
  config: AppConfig,
  cwd = process.cwd(),
  options: AuthJourneyOptions = {},
): Promise<AuthRunResult> {
  const started = Date.now();
  const baseUrl = journey.baseUrl ?? config.baseUrl ?? "http://127.0.0.1:4173";
  const matchMode = journey.options?.match ?? "partial";
  const gotoWaitUntil =
    journey.gotoWaitUntil ?? config.gotoWaitUntil ?? "domcontentloaded";
  const onProgress = options.onProgress ?? (() => {});

  let browser: Browser | undefined;
  let page: Page | undefined;
  let error: string | undefined;
  let screenshotPath: string | undefined;
  const storageStatePaths: string[] = [];
  const stepLog: StepLogEntry[] = [];

  try {
    browser = await chromium.launch({ headless: options.headless ?? false });

    const context = await browser.newContext({});
    page = await context.newPage();

    const total = journey.steps.length;
    for (let i = 0; i < journey.steps.length; i++) {
      const step = journey.steps[i]!;
      const detail = stepDetail(step);
      onProgress(`[${i + 1}/${total}] ${step.action} ${detail}`);
      try {
        const result = await executeStep(
          page,
          step,
          baseUrl,
          undefined,
          matchMode,
          { gotoWaitUntil, onProgress, cwd },
        );
        stepLog.push({
          index: i,
          action: step.action,
          status: result.status,
          detail,
          ...(result.reason !== undefined ? { reason: result.reason } : {}),
        });
        if (step.action === "saveStorageState" && result.status === "ran") {
          storageStatePaths.push(resolve(cwd, step.path));
        }
      } catch (stepErr) {
        const reason =
          stepErr instanceof Error ? stepErr.message : String(stepErr);
        stepLog.push({
          index: i,
          action: step.action,
          status: "failed",
          detail,
          reason,
        });
        throw stepErr;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    onProgress(`error: ${error}`);
    if (page) {
      try {
        const abs = resolve(cwd, config.reportDir ?? "reports", "auth-failure.png");
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, await page.screenshot({ fullPage: true }));
        screenshotPath = abs;
        onProgress(`captured failure screenshot: ${abs}`);
      } catch {
        // Screenshot is best-effort.
      }
    }
  } finally {
    await browser?.close();
  }

  const pass = !error && storageStatePaths.length > 0;
  return {
    journeyName: journey.name,
    baseUrl,
    durationMs: Date.now() - started,
    pass,
    error,
    storageStatePaths,
    stepLog,
    ...(screenshotPath !== undefined ? { screenshotPath } : {}),
  };
}
