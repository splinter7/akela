import type {
  ExpectedEvent,
  NormalizedEvent,
  Step,
} from "../normalize/types.js";
import type { PlanRow } from "../plan/parsePlanCsv.js";
import type { PlanCoverage } from "./planCoverage.js";

const DEFAULT_NOISE_EVENT_NAMES = ["page_ping"];
const DEFAULT_CHURN_KEYS = ["timestamp", "eid", "dtm"];
/** How far before an event a user action may still be considered causal. */
const ACTION_TIMESTAMP_SLACK_MS = 1000;
/**
 * How far after an event a non-scroll action may still be considered causal
 * (async recorder binding slightly after beacon dtm).
 */
const ACTION_TIMESTAMP_POST_SLACK_MS = 100;
/**
 * Extra post-event slack for scroll actions only (debounced recording lands
 * after the beacon). Must stay tighter than typical gaps between unrelated
 * actions in fast headless recordings.
 */
const SCROLL_ACTION_POST_SLACK_MS = 400;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const USER_ACTION_NAMES = new Set(["goto", "click", "fill", "scroll"]);

/** Plan trigger → journey action that typically causes the event. */
const TRIGGER_TO_ACTION: Record<string, Step["action"]> = {
  page_load: "goto",
  click: "click",
  fill: "fill",
  scroll: "scroll",
};

function isUuidLike(value: unknown): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}

function isChurnKey(
  key: string,
  value: unknown,
  churnKeys: Set<string>,
): boolean {
  if (churnKeys.has(key)) return true;
  if (UUID_RE.test(key)) return true;
  if (isUuidLike(value)) return true;
  return false;
}

function stripChurn(
  record: Record<string, unknown>,
  churnKeys: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isChurnKey(key, value, churnKeys)) continue;
    out[key] = value;
  }
  return out;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a !== null && b !== null && typeof a === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function intersectStableProps(
  records: Record<string, unknown>[],
): Record<string, unknown> {
  if (records.length === 0) return {};
  const first = records[0]!;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(first)) {
    if (!records.every((r) => key in r)) continue;
    const value = first[key];
    if (!records.every((r) => valuesEqual(r[key], value))) continue;
    out[key] = value;
  }
  return out;
}

function backfillListedKeys(
  listed: Record<string, unknown> | undefined,
  observed: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (listed === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(listed)) {
    out[key] = Object.prototype.hasOwnProperty.call(observed, key)
      ? observed[key]
      : listed[key];
  }
  return out;
}

function rowToExpect(row: PlanRow): ExpectedEvent {
  return {
    eventName: row.eventName,
    ...(row.properties !== undefined ? { properties: { ...row.properties } } : {}),
    ...(row.fields !== undefined ? { fields: { ...row.fields } } : {}),
  };
}

function matchedExpect(row: PlanRow, actual: NormalizedEvent): ExpectedEvent {
  const properties = backfillListedKeys(row.properties, actual.properties);
  const fields = backfillListedKeys(row.fields, actual.fields);
  return {
    eventName: row.eventName,
    ...(properties !== undefined ? { properties } : {}),
    ...(fields !== undefined ? { fields } : {}),
  };
}

function planRowContentKey(row: PlanRow): string {
  return JSON.stringify({
    eventName: row.eventName,
    properties: row.properties ?? null,
    fields: row.fields ?? null,
  });
}

/**
 * Find a matched capture for `row`, preferring same object reference, then
 * content key (eventName + properties + fields). Each matched entry is
 * consumed at most once via `consumed`.
 */
function findMatchForRow(
  coverage: PlanCoverage,
  row: PlanRow,
  consumed: Set<number>,
): NormalizedEvent | undefined {
  for (let i = 0; i < coverage.matched.length; i++) {
    if (consumed.has(i)) continue;
    const m = coverage.matched[i]!;
    if (m.row === row) {
      consumed.add(i);
      return m.actual;
    }
  }

  const key = planRowContentKey(row);
  for (let i = 0; i < coverage.matched.length; i++) {
    if (consumed.has(i)) continue;
    const m = coverage.matched[i]!;
    if (planRowContentKey(m.row) === key) {
      consumed.add(i);
      return m.actual;
    }
  }

  return undefined;
}

export function buildExpectExploratory(
  captured: NormalizedEvent[],
  options?: { noiseEventNames?: string[]; churnKeys?: string[] },
): ExpectedEvent[] {
  const noise = new Set(options?.noiseEventNames ?? DEFAULT_NOISE_EVENT_NAMES);
  const churnKeys = new Set(options?.churnKeys ?? DEFAULT_CHURN_KEYS);

  const byName = new Map<string, NormalizedEvent[]>();
  for (const evt of captured) {
    if (noise.has(evt.eventName)) continue;
    const list = byName.get(evt.eventName) ?? [];
    list.push(evt);
    byName.set(evt.eventName, list);
  }

  const expects: ExpectedEvent[] = [];
  for (const [eventName, events] of byName) {
    const stableProps = events.map((e) =>
      stripChurn(e.properties, churnKeys),
    );
    const properties = intersectStableProps(stableProps);
    const entry: ExpectedEvent = { eventName };
    if (Object.keys(properties).length > 0) {
      entry.properties = properties;
    }
    expects.push(entry);
  }
  return expects;
}

export function buildExpectFromPlan(
  rows: PlanRow[],
  coverage: PlanCoverage,
  options?: { includeUnplanned?: boolean },
): ExpectedEvent[] {
  const expects: ExpectedEvent[] = [];
  const consumed = new Set<number>();

  for (const row of rows) {
    const actual = findMatchForRow(coverage, row, consumed);
    if (actual) {
      expects.push(matchedExpect(row, actual));
    } else {
      expects.push(rowToExpect(row));
    }
  }

  if (options?.includeUnplanned && coverage.unexpected.length > 0) {
    expects.push(...buildExpectExploratory(coverage.unexpected));
  }

  return expects;
}

function isUserActionStep(step: Step): boolean {
  return USER_ACTION_NAMES.has(step.action);
}

function parseEventTimeMs(timestamp: string | undefined): number | undefined {
  if (timestamp === undefined) return undefined;
  const asNum = Number(timestamp);
  if (!Number.isNaN(asNum) && timestamp.trim() !== "") return asNum;
  const asDate = Date.parse(timestamp);
  if (!Number.isNaN(asDate)) return asDate;
  return undefined;
}

/**
 * Best-effort: insert `waitForEvent` after the user-action step whose
 * `actionTimestamps` entry is the latest within slack of each matched event
 * (so a debounced scroll after a click still wins; also covers async recorder
 * binding timestamps slightly after beacon `dtm`).
 * When event timestamps are present but no user action is within range,
 * that wait is skipped. When event timestamps are missing, fall back to
 * match order ↔ action index.
 */
export function suggestWaitForEventSteps(
  steps: Step[],
  coverage: PlanCoverage,
  actionTimestamps: number[],
): Step[] {
  const userActionIndexes: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (isUserActionStep(steps[i]!)) userActionIndexes.push(i);
  }

  type Insertion = { afterStepIndex: number; eventName: string; order: number };
  const insertions: Insertion[] = [];

  coverage.matched.forEach((match, matchIndex) => {
    const eventMs = parseEventTimeMs(match.actual.timestamp);
    let afterStepIndex: number | undefined;

    if (eventMs !== undefined && userActionIndexes.length > 0) {
      // Prefer the latest in-window action whose type matches the plan
      // trigger (goto for page_load, scroll for scroll, …). Falls back to
      // the latest in-window action, then the latest with ts <= eventMs.
      // Scroll actions get a wider post-event window for debounce lag.
      const preferredAction = TRIGGER_TO_ACTION[match.row.trigger];
      let bestPreferredPos: number | undefined;
      let bestPreferredTs = Number.NEGATIVE_INFINITY;
      let bestInWindowPos: number | undefined;
      let bestInWindowTs = Number.NEGATIVE_INFINITY;
      let bestBeforePos: number | undefined;
      for (let a = 0; a < userActionIndexes.length; a++) {
        const stepIndex = userActionIndexes[a]!;
        const ts = actionTimestamps[stepIndex];
        if (ts === undefined) continue;
        const step = steps[stepIndex]!;
        const postSlack =
          step.action === "scroll"
            ? SCROLL_ACTION_POST_SLACK_MS
            : ACTION_TIMESTAMP_POST_SLACK_MS;
        const inWindow =
          ts >= eventMs - ACTION_TIMESTAMP_SLACK_MS &&
          ts <= eventMs + postSlack;
        if (inWindow && ts >= bestInWindowTs) {
          bestInWindowPos = a;
          bestInWindowTs = ts;
        }
        if (
          inWindow &&
          preferredAction !== undefined &&
          step.action === preferredAction &&
          ts >= bestPreferredTs
        ) {
          bestPreferredPos = a;
          bestPreferredTs = ts;
        }
        if (ts <= eventMs) {
          bestBeforePos = a;
        }
      }
      const chosen =
        bestPreferredPos !== undefined
          ? bestPreferredPos
          : bestInWindowPos !== undefined
            ? bestInWindowPos
            : bestBeforePos;
      if (chosen === undefined) return;
      afterStepIndex = userActionIndexes[chosen]!;
    } else {
      // Fallback: ith match after ith user action (clamp to last).
      const actionPos = Math.min(
        matchIndex,
        Math.max(0, userActionIndexes.length - 1),
      );
      afterStepIndex =
        userActionIndexes[actionPos] ?? Math.max(0, steps.length - 1);
    }

    insertions.push({
      afterStepIndex,
      eventName: match.row.eventName,
      order: matchIndex,
    });
  });

  // Group insertions by afterStepIndex, preserving match order within each group.
  insertions.sort((a, b) =>
    a.afterStepIndex !== b.afterStepIndex
      ? a.afterStepIndex - b.afterStepIndex
      : a.order - b.order,
  );

  const byAfter = new Map<number, Insertion[]>();
  for (const ins of insertions) {
    const list = byAfter.get(ins.afterStepIndex) ?? [];
    list.push(ins);
    byAfter.set(ins.afterStepIndex, list);
  }

  const result: Step[] = [];
  for (let i = 0; i < steps.length; i++) {
    result.push(steps[i]!);
    const waits = byAfter.get(i);
    if (waits) {
      for (const w of waits) {
        result.push({ action: "waitForEvent", eventName: w.eventName });
      }
    }
  }
  return result;
}
