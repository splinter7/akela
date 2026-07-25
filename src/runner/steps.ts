import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Locator, Page } from "playwright";
import type {
  ProgressFn,
  Step,
  StepResult,
  StepRuntimeOptions,
} from "../normalize/types.js";
import type { NetworkCapture } from "../capture/NetworkCapture.js";
import { findMatchingEvent } from "../verify/EventVerifier.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Brief wait so fork UI can settle after waitForAny before skipping a branch. */
const WHEN_VISIBLE_TIMEOUT_MS = 500;

async function shouldSkipStep(page: Page, step: Step): Promise<boolean> {
  if (!step.when?.visible) return false;
  try {
    await page.locator(step.when.visible).waitFor({
      state: "visible",
      timeout: WHEN_VISIBLE_TIMEOUT_MS,
    });
    return false;
  } catch {
    return true;
  }
}

function locatorForAny(page: Page, selectors: string[]): Locator {
  return selectors.map((s) => page.locator(s)).reduce((a, b) => a.or(b));
}

function stepDetail(step: Step): string {
  switch (step.action) {
    case "goto":
      return step.path;
    case "click":
    case "fill":
    case "waitForSelector":
      return step.selector;
    case "waitForEvent":
      return step.eventName;
    case "waitForURL":
      return step.url;
    case "waitForAny":
      return step.selectors.join(" | ");
    case "scroll":
      return step.selector ?? "(page)";
    case "wait":
      return `${step.timeoutMs}ms`;
    case "saveStorageState":
      return step.path;
    default: {
      const _exhaustive: never = step;
      return JSON.stringify(_exhaustive);
    }
  }
}

async function withRetries(
  attempts: number,
  run: () => Promise<void>,
  onRetry: ProgressFn | undefined,
  label: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= attempts; attempt++) {
    try {
      await run();
      return;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        onRetry?.(
          `  retry ${attempt + 1}/${attempts} after failure: ${label}`,
        );
      }
    }
  }
  throw lastError;
}

export async function executeStep(
  page: Page,
  step: Step,
  baseUrl: string,
  capture: NetworkCapture | undefined,
  matchMode: "partial" | "exact" = "partial",
  runtime: StepRuntimeOptions = { gotoWaitUntil: "domcontentloaded" },
): Promise<StepResult> {
  if (await shouldSkipStep(page, step)) {
    const reason = `when.visible not found: ${step.when!.visible}`;
    runtime.onProgress?.(`  skipped (${reason})`);
    return { status: "skipped", reason };
  }

  switch (step.action) {
    case "goto": {
      const url = step.path.startsWith("http")
        ? step.path
        : new URL(step.path, baseUrl).toString();
      await page.goto(url, { waitUntil: runtime.gotoWaitUntil });
      return { status: "ran", reason: undefined };
    }
    case "click": {
      const retries = step.retries ?? 0;
      await withRetries(
        retries,
        () =>
          page.click(step.selector, {
            ...(step.timeoutMs !== undefined ? { timeout: step.timeoutMs } : {}),
          }),
        runtime.onProgress,
        `click ${step.selector}`,
      );
      return { status: "ran" };
    }
    case "fill": {
      const retries = step.retries ?? 0;
      await withRetries(
        retries,
        () =>
          page.fill(step.selector, step.value, {
            ...(step.timeoutMs !== undefined ? { timeout: step.timeoutMs } : {}),
          }),
        runtime.onProgress,
        `fill ${step.selector}`,
      );
      return { status: "ran" };
    }
    case "wait": {
      await sleep(step.timeoutMs);
      return { status: "ran" };
    }
    case "waitForEvent": {
      if (!capture) {
        throw new Error("waitForEvent requires network capture");
      }
      const timeout = step.timeoutMs ?? 5000;
      // Prefer runner-provided mark (start of previous step). Fallback: now.
      const sinceIndex = runtime.eventSinceIndex ?? capture.getEvents().length;
      const expected = {
        eventName: step.eventName,
        ...(step.properties !== undefined ? { properties: step.properties } : {}),
        ...(step.fields !== undefined ? { fields: step.fields } : {}),
      };
      runtime.onProgress?.(
        `  waiting for event "${step.eventName}" (since #${sinceIndex})…`,
      );
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const found = findMatchingEvent(
          capture.getEvents(),
          expected,
          matchMode,
          sinceIndex,
        );
        if (found) {
          runtime.onProgress?.(`  found event "${step.eventName}"`);
          return { status: "ran", matchedEventIndex: found.index };
        }
        await sleep(100);
      }
      throw new Error(
        `waitForEvent timed out after ${timeout}ms waiting for "${step.eventName}"`,
      );
    }
    case "waitForSelector": {
      await page.waitForSelector(step.selector, {
        timeout: step.timeoutMs ?? 5000,
        state: step.state ?? "visible",
      });
      return { status: "ran" };
    }
    case "waitForAny": {
      const timeout = step.timeoutMs ?? 5000;
      const loc = locatorForAny(page, step.selectors);
      await loc.first().waitFor({ state: "visible", timeout });
      return { status: "ran" };
    }
    case "waitForURL": {
      await page.waitForURL(step.url, {
        timeout: step.timeoutMs ?? 5000,
      });
      return { status: "ran" };
    }
    case "scroll": {
      const timeout = step.timeoutMs ?? 5000;
      if (step.selector) {
        const locator = page.locator(step.selector);
        await locator.waitFor({ state: "attached", timeout });
        // Prefer scrolling inside overflow containers (recorded scroll targets);
        // otherwise bring the element into the viewport.
        const scrolledInside = await locator.evaluate((el) => {
          const style = window.getComputedStyle(el);
          const canY =
            (style.overflowY === "auto" ||
              style.overflowY === "scroll" ||
              style.overflowY === "overlay") &&
            el.scrollHeight > el.clientHeight + 1;
          const canX =
            (style.overflowX === "auto" ||
              style.overflowX === "scroll" ||
              style.overflowX === "overlay") &&
            el.scrollWidth > el.clientWidth + 1;
          if (!canY && !canX) return false;
          if (canY) el.scrollTop = el.scrollHeight;
          if (canX) el.scrollLeft = el.scrollWidth;
          return true;
        });
        if (!scrolledInside) {
          await locator.scrollIntoViewIfNeeded({ timeout });
        }
      } else {
        await page.evaluate(() => {
          window.scrollBy(0, document.body.scrollHeight);
        });
      }
      return { status: "ran" };
    }
    case "saveStorageState": {
      const cwd = runtime.cwd ?? process.cwd();
      const abs = resolve(cwd, step.path);
      mkdirSync(dirname(abs), { recursive: true });
      await page.context().storageState({ path: abs });
      runtime.onProgress?.(`  wrote storageState: ${abs}`);
      return { status: "ran" };
    }
    default: {
      const _exhaustive: never = step;
      throw new Error(`Unknown step action: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export { stepDetail };
