import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync } from "node:fs";
import type {
  AppConfig,
  NormalizedEvent,
  Step,
} from "../normalize/types.js";
import { NetworkCapture } from "../capture/NetworkCapture.js";
import { createDefaultRegistry } from "../runner/JourneyRunner.js";
import { waitForQuietEvents } from "../runner/waitForQuietEvents.js";
import {
  resolveSelector,
  type SelectorPrefer,
} from "./selectorPolicy.js";

export type RecordedAction = {
  step: Step;
  at: number;
  fragile: boolean;
};

export type RecorderSessionResult = {
  steps: Step[];
  fragileCount: number;
  /** Indexes into `steps` that used a fragile selector. */
  fragileStepIndexes: number[];
  actionTimestamps: number[];
  events: NormalizedEvent[];
  warnings: string[];
};

type ElementSnapshot = {
  tagName: string;
  id?: string;
  attributes: Record<string, string>;
  role?: string;
  accessibleName?: string;
};

type RecordedPayload =
  | { type: "click"; el: ElementSnapshot }
  | { type: "fill"; el: ElementSnapshot; value: string };

const PASSWORD_HINT = /password|passwd|secret/i;

const BINDING_NAME = "__analyticsTrackerRecord";

function isPasswordLike(el: ElementSnapshot): boolean {
  const type = el.attributes["type"] ?? "";
  if (type.toLowerCase() === "password") return true;
  const name = el.attributes["name"] ?? "";
  const id = el.id ?? "";
  return PASSWORD_HINT.test(name) || PASSWORD_HINT.test(id);
}

function pathRelativeToBase(startUrl: string, baseUrl?: string): string {
  if (!baseUrl) {
    try {
      return new URL(startUrl).pathname || "/";
    } catch {
      return startUrl;
    }
  }
  try {
    const start = new URL(startUrl);
    const base = new URL(baseUrl);
    if (start.origin === base.origin) {
      return `${start.pathname}${start.search}` || "/";
    }
  } catch {
    // fall through
  }
  return startUrl;
}

export class RecorderSession {
  private startUrl: string;
  private adapters: string[];
  private config: AppConfig;
  private storageStateAbs?: string;
  private headless: boolean;

  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private capture?: NetworkCapture;
  private actions: RecordedAction[] = [];
  private warnings: string[] = [];
  private started = false;
  private stopped = false;

  constructor(opts: {
    startUrl: string;
    adapters: string[];
    config: AppConfig;
    storageStateAbs?: string;
    headless?: boolean;
  }) {
    this.startUrl = opts.startUrl;
    this.adapters = opts.adapters;
    this.config = opts.config;
    this.storageStateAbs = opts.storageStateAbs;
    this.headless = opts.headless ?? false;
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error("RecorderSession already started");
    }
    this.started = true;

    const registry = createDefaultRegistry(this.config);
    registry.assertKnown(this.adapters);
    this.capture = new NetworkCapture(registry, this.adapters);

    this.browser = await chromium.launch({ headless: this.headless });

    let storageState: string | undefined;
    if (this.storageStateAbs) {
      if (!existsSync(this.storageStateAbs)) {
        throw new Error(`storageState file not found: ${this.storageStateAbs}`);
      }
      storageState = this.storageStateAbs;
    }

    this.context = await this.browser.newContext(
      storageState !== undefined ? { storageState } : {},
    );

    await this.context.exposeBinding(
      BINDING_NAME,
      (_source, payload: RecordedPayload) => {
        this.handleRecordedPayload(payload);
      },
    );

    await this.context.addInitScript(
      ({ bindingName }) => {
        const w = window as unknown as Record<string, unknown>;
        if (w.__analyticsTrackerRecorderInstalled) return;
        w.__analyticsTrackerRecorderInstalled = true;

        type Snap = {
          tagName: string;
          id?: string;
          attributes: Record<string, string>;
        };

        function snapshot(el: Element): Snap {
          const attributes: Record<string, string> = {};
          for (const attr of Array.from(el.attributes)) {
            attributes[attr.name] = attr.value;
          }
          return {
            tagName: el.tagName,
            id: el.id || undefined,
            attributes,
          };
        }

        function findTarget(el: Element): Element {
          return (
            el.closest(
              "[data-analytics-id], [data-testid], button, a, input, textarea, select, [role='button']",
            ) ?? el
          );
        }

        const binding = w[bindingName] as (
          payload: RecordedPayload,
        ) => Promise<void>;

        document.addEventListener(
          "click",
          (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            void binding({ type: "click", el: snapshot(findTarget(target)) });
          },
          true,
        );

        document.addEventListener(
          "change",
          (event) => {
            const target = event.target;
            if (
              !(
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                target instanceof HTMLSelectElement
              )
            ) {
              return;
            }
            void binding({
              type: "fill",
              el: snapshot(findTarget(target)),
              value: target.value,
            });
          },
          true,
        );
      },
      { bindingName: BINDING_NAME },
    );

    this.page = await this.context.newPage();
    await this.capture.attach(this.page);

    const gotoWaitUntil =
      this.config.gotoWaitUntil ?? "domcontentloaded";
    await this.page.goto(this.startUrl, { waitUntil: gotoWaitUntil });

    const path = pathRelativeToBase(this.startUrl, this.config.baseUrl);
    this.pushAction({ action: "goto", path }, false);
  }

  getPage(): Page {
    if (!this.page) {
      throw new Error("RecorderSession not started");
    }
    return this.page;
  }

  async stop(): Promise<RecorderSessionResult> {
    if (!this.started || this.stopped) {
      throw new Error("RecorderSession is not running");
    }
    this.stopped = true;

    const capture = this.capture;
    if (capture) {
      await waitForQuietEvents(capture, {
        quietMs: this.config.quietMs ?? 200,
        timeoutMs: this.config.quietTimeoutMs ?? 2000,
      });
    }

    const events = capture?.getEvents() ?? [];
    const captureWarnings = capture?.getWarnings() ?? [];
    const warnings = [...this.warnings, ...captureWarnings];
    const steps = this.actions.map((a) => a.step);
    const actionTimestamps = this.actions.map((a) => a.at);
    const fragileStepIndexes = this.actions
      .map((a, i) => (a.fragile ? i : -1))
      .filter((i) => i >= 0);
    const fragileCount = fragileStepIndexes.length;

    try {
      await this.context?.close();
    } catch {
      // ignore
    }
    try {
      await this.browser?.close();
    } catch {
      // ignore
    }
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;

    return {
      steps,
      fragileCount,
      fragileStepIndexes,
      actionTimestamps,
      events,
      warnings,
    };
  }

  private handleRecordedPayload(payload: RecordedPayload): void {
    const prefer = this.config.record?.selectorPrefer as
      | SelectorPrefer[]
      | undefined;
    const resolved = resolveSelector(payload.el, prefer);

    if (payload.type === "click") {
      this.pushAction(
        { action: "click", selector: resolved.selector },
        resolved.fragile,
      );
      return;
    }

    if (isPasswordLike(payload.el)) {
      this.warnings.push(
        "Recorded a password-like fill; prefer auth + storageState / --var and do not commit secrets.",
      );
    }

    this.pushAction(
      {
        action: "fill",
        selector: resolved.selector,
        value: payload.value,
      },
      resolved.fragile,
    );
  }

  private pushAction(step: Step, fragile: boolean): void {
    this.actions.push({
      step,
      at: Date.now(),
      fragile,
    });
  }
}
