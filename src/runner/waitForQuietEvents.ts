export type EventCountSource = {
  getEvents: () => readonly unknown[];
};

export type WaitForQuietEventsOptions = {
  /** Require this many ms with no new events before returning. Default 200. */
  quietMs?: number;
  /** Max time to wait for a quiet window. Default 2000. */
  timeoutMs?: number;
  /** Poll interval. Default 50. */
  pollMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until captured event count is unchanged for `quietMs`, or until `timeoutMs`.
 * Used after journey steps to pick up late analytics beacons without a fixed sleep.
 */
export async function waitForQuietEvents(
  source: EventCountSource,
  options: WaitForQuietEventsOptions = {},
): Promise<void> {
  const quietMs = options.quietMs ?? 200;
  const timeoutMs = options.timeoutMs ?? 2000;
  const pollMs = options.pollMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  let lastCount = source.getEvents().length;
  let lastChangeAt = Date.now();

  while (Date.now() < deadline) {
    await sleep(pollMs);
    const count = source.getEvents().length;
    if (count !== lastCount) {
      lastCount = count;
      lastChangeAt = Date.now();
      continue;
    }
    if (Date.now() - lastChangeAt >= quietMs) {
      return;
    }
  }
}
