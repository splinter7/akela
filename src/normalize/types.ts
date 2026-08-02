export type NormalizedEvent = {
  platform: string;
  eventName: string;
  timestamp?: string;
  /** Event payload only (platform-specific). */
  properties: Record<string, unknown>;
  /** Flattened search surface: payload + attached contexts. */
  fields: Record<string, unknown>;
  raw: {
    url: string;
    method: string;
    body?: string;
    payload: unknown;
  };
};

export type CapturedRequest = {
  url: string;
  method: string;
  postData?: string | null;
  headers: Record<string, string>;
  timestamp: number;
};

export type ExpectedEvent = {
  eventName: string;
  /** Match against payload-only `actual.properties`. */
  properties?: Record<string, unknown>;
  /** Match against flattened `actual.fields` (payload + contexts). Always deep-subset. */
  fields?: Record<string, unknown>;
};

export type VerifyOptions = {
  ordered?: boolean;
  match?: "partial" | "exact";
  forbidExtra?: boolean;
};

export type GotoWaitUntil = "load" | "domcontentloaded" | "networkidle" | "commit";

export type WaitForSelectorState = "attached" | "detached" | "visible" | "hidden";

/** Optional guard: skip the step (no error) when the selector is not visible. */
export type StepWhen = {
  visible: string;
};

type StepBase = {
  when?: StepWhen;
};

export type Step =
  | (StepBase & { action: "goto"; path: string })
  | (StepBase & {
      action: "click";
      selector: string;
      timeoutMs?: number;
      retries?: number;
    })
  | (StepBase & {
      action: "fill";
      selector: string;
      value: string;
      timeoutMs?: number;
      retries?: number;
    })
  | (StepBase & { action: "wait"; timeoutMs: number })
  | (StepBase & {
      action: "waitForEvent";
      eventName: string;
      timeoutMs?: number;
      properties?: Record<string, unknown>;
      fields?: Record<string, unknown>;
    })
  | (StepBase & {
      action: "waitForSelector";
      selector: string;
      timeoutMs?: number;
      state?: WaitForSelectorState;
    })
  | (StepBase & { action: "waitForURL"; url: string; timeoutMs?: number })
  | (StepBase & { action: "scroll"; selector?: string; timeoutMs?: number })
  | (StepBase & {
      action: "waitForAny";
      /** Wait until any of these selectors is visible (min 2). */
      selectors: string[];
      timeoutMs?: number;
    })
  | (StepBase & {
      /**
       * Wait until React has attached handlers to the element. Server-rendered
       * markup is visible before hydration, so acting on it can trigger native
       * form submits instead of the app's own handlers.
       */
      action: "waitForHydrated";
      selector: string;
      timeoutMs?: number;
    })
  | (StepBase & { action: "saveStorageState"; path: string });

export type StepResult = {
  status: "ran" | "skipped" | "failed";
  reason?: string;
  /** Set when waitForEvent matches; runner advances the event window past this index. */
  matchedEventIndex?: number;
};

export type StepLogEntry = {
  index: number;
  action: string;
  status: "ran" | "skipped" | "failed";
  detail?: string;
  reason?: string;
};

export type ProgressFn = (message: string) => void;

export type Journey = {
  name: string;
  baseUrl?: string;
  options?: VerifyOptions;
  adapters: string[];
  steps: Step[];
  expect: ExpectedEvent[];
  /** Path to Playwright storage state JSON (cookies/localStorage), relative to cwd. */
  storageState?: string;
  /** Playwright goto waitUntil; defaults to domcontentloaded. */
  gotoWaitUntil?: GotoWaitUntil;
};

export type AppConfig = {
  baseUrl?: string;
  headless?: boolean;
  reportDir?: string;
  /** Conventional directory for plan CSVs (scaffold/docs). Default plans. */
  plansDir?: string;
  /** Default directory for generate/record journey output. Default journeys. */
  journeysDir?: string;
  /** Default Playwright storage state when journey omits storageState. */
  storageState?: string;
  /** Default goto waitUntil when journey omits gotoWaitUntil. */
  gotoWaitUntil?: GotoWaitUntil;
  /** Quiet window with no new events before ending late-beacon drain. Default 200. */
  quietMs?: number;
  /** Max time to wait for a quiet window. Default 2000. */
  quietTimeoutMs?: number;
  snowplow?: {
    collectorPatterns?: string[];
  };
  /** Optional recorder preferences (additive; ignored by run/auth). */
  record?: {
    selectorPrefer?: ("data-analytics-id" | "data-testid")[];
  };
};

/** Options passed into step execution from the runner. */
export type StepRuntimeOptions = {
  gotoWaitUntil: GotoWaitUntil;
  onProgress?: ProgressFn;
  /**
   * For waitForEvent: only match events at or after this index.
   * Runner sets this to the capture length at the start of the previous step
   * so beacons fired during the triggering action (goto/click) still count,
   * while older journey events do not.
   */
  eventSinceIndex?: number;
  /** Base directory for resolving saveStorageState paths. Default process.cwd(). */
  cwd?: string;
};
