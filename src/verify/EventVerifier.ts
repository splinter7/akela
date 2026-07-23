import type { CapturedRequest, ExpectedEvent, NormalizedEvent, VerifyOptions } from "../normalize/types.js";

export type MatchedPair = {
  expected: ExpectedEvent;
  actual: NormalizedEvent;
};

export type NearMiss = {
  actual: NormalizedEvent;
  diff: string;
};

export type MissingMatch = {
  expected: ExpectedEvent;
  nearMiss?: NearMiss;
};

export type VerificationResult = {
  pass: boolean;
  matched: MatchedPair[];
  missing: MissingMatch[];
  unexpected: NormalizedEvent[];
  options: Required<VerifyOptions>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Number N and string S match iff Number(S) === N and String(N) === S. */
function softPrimitiveEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "string") {
    return Number.isFinite(a) && Number(b) === a && String(a) === b;
  }
  if (typeof a === "string" && typeof b === "number") {
    return Number.isFinite(b) && Number(a) === b && String(b) === a;
  }
  return false;
}

/** Returns true if `expected` is a deep subset of `actual`. */
export function isDeepSubset(expected: unknown, actual: unknown): boolean {
  if (softPrimitiveEqual(expected, actual)) return true;
  if (typeof expected !== typeof actual) return false;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) return false;
    return expected.every((item, i) => isDeepSubset(item, actual[i]));
  }
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return false;
    return Object.entries(expected).every(([key, value]) => isDeepSubset(value, actual[key]));
  }
  return false;
}

function propertiesMatch(
  expected: Record<string, unknown> | undefined,
  actual: Record<string, unknown>,
  mode: "partial" | "exact",
): boolean {
  const exp = expected ?? {};
  if (mode === "exact") {
    const expKeys = Object.keys(exp).sort();
    const actKeys = Object.keys(actual).sort();
    if (expKeys.length !== actKeys.length) return false;
    if (expKeys.some((k, i) => k !== actKeys[i])) return false;
    return expKeys.every((k) => isDeepSubset(exp[k], actual[k]) && isDeepSubset(actual[k], exp[k]));
  }
  return isDeepSubset(exp, actual);
}

function eventMatches(expected: ExpectedEvent, actual: NormalizedEvent, mode: "partial" | "exact"): boolean {
  if (expected.eventName !== actual.eventName) return false;
  if (!propertiesMatch(expected.properties, actual.properties, mode)) return false;
  // fields always use deep-subset (semantic / location-agnostic)
  if (expected.fields !== undefined) {
    if (!isDeepSubset(expected.fields, actual.fields)) return false;
  }
  return true;
}

/** Top-level property/field diffs for near-miss / report rendering. */
export function buildDiffLines(expected: ExpectedEvent, actual: NormalizedEvent): string {
  const lines: string[] = [];
  const expProps = expected.properties ?? {};
  for (const [key, value] of Object.entries(expProps)) {
    const act = actual.properties[key];
    if (!isDeepSubset(value, act)) {
      lines.push(
        `  properties.${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(act)}`,
      );
    }
  }
  const expFields = expected.fields ?? {};
  for (const [key, value] of Object.entries(expFields)) {
    const act = actual.fields[key];
    if (!isDeepSubset(value, act)) {
      lines.push(
        `  fields.${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(act)}`,
      );
    }
  }
  return lines.join("\n") || "  (eventName / properties / fields matched)";
}

function nearMissScore(expected: ExpectedEvent, actual: NormalizedEvent): number {
  let diffs = 0;
  const expProps = expected.properties ?? {};
  for (const [key, value] of Object.entries(expProps)) {
    if (!isDeepSubset(value, actual.properties[key])) diffs += 1;
  }
  const expFields = expected.fields ?? {};
  for (const [key, value] of Object.entries(expFields)) {
    if (!isDeepSubset(value, actual.fields[key])) diffs += 1;
  }
  return diffs;
}

export function findNearMiss(
  expected: ExpectedEvent,
  captured: NormalizedEvent[],
  used: Set<number>,
): NearMiss | undefined {
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < captured.length; i++) {
    if (used.has(i)) continue;
    const actual = captured[i]!;
    if (actual.eventName !== expected.eventName) continue;
    const score = nearMissScore(expected, actual);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  if (bestIndex === -1) return undefined;
  const actual = captured[bestIndex]!;
  return { actual, diff: buildDiffLines(expected, actual) };
}

export function verifyEvents(
  captured: NormalizedEvent[],
  expected: ExpectedEvent[],
  options: VerifyOptions = {},
): VerificationResult {
  const resolved: Required<VerifyOptions> = {
    ordered: options.ordered ?? false,
    match: options.match ?? "partial",
    forbidExtra: options.forbidExtra ?? false,
  };

  const matched: MatchedPair[] = [];
  const missing: MissingMatch[] = [];
  const used = new Set<number>();

  let searchFrom = 0;

  for (const exp of expected) {
    let foundIndex = -1;
    const start = resolved.ordered ? searchFrom : 0;
    for (let i = start; i < captured.length; i++) {
      if (used.has(i)) continue;
      if (eventMatches(exp, captured[i]!, resolved.match)) {
        foundIndex = i;
        break;
      }
    }
    if (foundIndex === -1) {
      missing.push({
        expected: exp,
        nearMiss: findNearMiss(exp, captured, used),
      });
    } else {
      used.add(foundIndex);
      matched.push({ expected: exp, actual: captured[foundIndex]! });
      if (resolved.ordered) {
        searchFrom = foundIndex + 1;
      }
    }
  }

  const unexpected = resolved.forbidExtra
    ? captured.filter((_, i) => !used.has(i))
    : [];

  // Vacuous success: no expectations means nothing was verified.
  const pass =
    expected.length > 0 && missing.length === 0 && unexpected.length === 0;

  return { pass, matched, missing, unexpected, options: resolved };
}

/** Helper for waitForEvent: match an event at or after fromIndex. */
export function findMatchingEvent(
  captured: NormalizedEvent[],
  expected: ExpectedEvent,
  match: "partial" | "exact" = "partial",
  fromIndex = 0,
): { event: NormalizedEvent; index: number } | undefined {
  const start = Math.max(0, fromIndex);
  for (let i = start; i < captured.length; i++) {
    if (eventMatches(expected, captured[i]!, match)) {
      return { event: captured[i]!, index: i };
    }
  }
  return undefined;
}

export type { CapturedRequest };
