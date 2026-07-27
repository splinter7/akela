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
  | { type: "fill"; el: ElementSnapshot; value: string }
  | { type: "scroll"; el?: ElementSnapshot; startedAt?: number };

const PASSWORD_HINT = /password|passwd|secret/i;

const BINDING_NAME = "__akelaRecord";

/** Collapse scroll bursts into one recorded step (ms). */
const SCROLL_DEBOUNCE_MS = 300;

/**
 * Init script must be a plain string. Passing a TS/tsx function to
 * `addInitScript` embeds bundler helpers like `__name(...)` into the page,
 * which throw and abort before click/change listeners are registered.
 */
function recorderInitScriptSource(bindingName: string): string {
  return `(() => {
  const bindingName = ${JSON.stringify(bindingName)};
  const scrollDebounceMs = ${SCROLL_DEBOUNCE_MS};
  const w = window;
  if (w.__akelaRecorderInstalled) return;

  function snapshot(el) {
    const attributes = {};
    for (const attr of Array.from(el.attributes)) {
      attributes[attr.name] = attr.value;
    }
    return {
      tagName: el.tagName,
      id: el.id || undefined,
      attributes,
    };
  }

  function findTarget(el) {
    return (
      el.closest(
        "[data-analytics-id], [data-testid], button, a, input, textarea, select, [role='button']",
      ) || el
    );
  }

  function callBinding(payload) {
    const binding = w[bindingName];
    if (typeof binding !== "function") return;
    void binding(payload);
  }

  function isPageScrollTarget(target) {
    return (
      target === document ||
      target === document.documentElement ||
      target === document.body
    );
  }

  const elementScrollTimers = new WeakMap();
  const elementScrollStartedAt = new WeakMap();
  const pendingElementScrolls = new Set();
  let pageScrollTimer = null;
  let pageScrollPending = false;
  let pageScrollStartedAt = 0;

  function schedulePageScroll() {
    if (!pageScrollPending) pageScrollStartedAt = Date.now();
    pageScrollPending = true;
    if (pageScrollTimer !== null) clearTimeout(pageScrollTimer);
    pageScrollTimer = setTimeout(() => {
      pageScrollTimer = null;
      pageScrollPending = false;
      callBinding({ type: "scroll", startedAt: pageScrollStartedAt });
    }, scrollDebounceMs);
  }

  function scheduleElementScroll(el) {
    if (!pendingElementScrolls.has(el)) {
      elementScrollStartedAt.set(el, Date.now());
    }
    pendingElementScrolls.add(el);
    const existing = elementScrollTimers.get(el);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      elementScrollTimers.delete(el);
      pendingElementScrolls.delete(el);
      const startedAt = elementScrollStartedAt.get(el);
      elementScrollStartedAt.delete(el);
      callBinding({ type: "scroll", el: snapshot(el), startedAt });
    }, scrollDebounceMs);
    elementScrollTimers.set(el, timer);
  }

  function flushPendingScrolls() {
    if (pageScrollTimer !== null) {
      clearTimeout(pageScrollTimer);
      pageScrollTimer = null;
    }
    if (pageScrollPending) {
      pageScrollPending = false;
      callBinding({ type: "scroll", startedAt: pageScrollStartedAt });
    }
    for (const el of Array.from(pendingElementScrolls)) {
      const timer = elementScrollTimers.get(el);
      if (timer !== undefined) clearTimeout(timer);
      elementScrollTimers.delete(el);
      pendingElementScrolls.delete(el);
      const startedAt = elementScrollStartedAt.get(el);
      elementScrollStartedAt.delete(el);
      callBinding({ type: "scroll", el: snapshot(el), startedAt });
    }
  }

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      callBinding({ type: "click", el: snapshot(findTarget(target)) });
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
      callBinding({
        type: "fill",
        el: snapshot(findTarget(target)),
        value: target.value,
      });
    },
    true,
  );

  document.addEventListener(
    "scroll",
    (event) => {
      const target = event.target;
      if (isPageScrollTarget(target)) return;
      if (!(target instanceof Element)) return;
      scheduleElementScroll(target);
    },
    true,
  );

  // Capture on document sees element scrolls. Do NOT use capture on window —
  // capture would also see descendant region scrolls and record spurious page scrolls.
  window.addEventListener("scroll", (event) => {
    const target = event.target;
    if (target !== window && !isPageScrollTarget(target)) return;
    schedulePageScroll();
  });

  w.__akelaRecorderFlushScroll = flushPendingScrolls;
  w.__akelaRecorderInstalled = true;
})();`;
}

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

    await this.context.addInitScript({
      content: recorderInitScriptSource(BINDING_NAME),
    });

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

    // Flush debounced scroll steps before tearing down the page.
    try {
      await this.page?.evaluate(() => {
        const flush = (window as unknown as {
          __akelaRecorderFlushScroll?: () => void;
        }).__akelaRecorderFlushScroll;
        flush?.();
      });
      // Bindings are async; give them a tick to land before we read actions.
      await new Promise((r) => setTimeout(r, 50));
    } catch {
      // page may already be closed
    }

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

    if (payload.type === "scroll") {
      const at =
        typeof payload.startedAt === "number" ? payload.startedAt : undefined;
      if (!payload.el) {
        this.pushAction({ action: "scroll" }, false, at);
        return;
      }
      const resolved = resolveSelector(payload.el, prefer);
      this.pushAction(
        { action: "scroll", selector: resolved.selector },
        resolved.fragile,
        at,
      );
      return;
    }

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

  private pushAction(step: Step, fragile: boolean, at?: number): void {
    this.actions.push({
      step,
      at: at ?? Date.now(),
      fragile,
    });
  }
}
