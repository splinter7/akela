import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitForQuietEvents } from "../../src/runner/waitForQuietEvents.js";

describe("waitForQuietEvents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns after quietMs with no new events", async () => {
    const events: unknown[] = [{}, {}];
    const source = { getEvents: () => events };

    const done = waitForQuietEvents(source, {
      quietMs: 200,
      timeoutMs: 2000,
      pollMs: 50,
    });

    await vi.advanceTimersByTimeAsync(200);
    await done;
  });

  it("resets quiet window when events arrive", async () => {
    const events: unknown[] = [];
    const source = { getEvents: () => events };

    const done = waitForQuietEvents(source, {
      quietMs: 200,
      timeoutMs: 2000,
      pollMs: 50,
    });

    await vi.advanceTimersByTimeAsync(150);
    events.push({});
    await vi.advanceTimersByTimeAsync(150);
    // Still within quiet window after the late event
    let settled = false;
    void done.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    await done;
    expect(settled).toBe(true);
  });

  it("stops at timeoutMs even if events keep arriving", async () => {
    const events: unknown[] = [];
    const source = { getEvents: () => events };

    const done = waitForQuietEvents(source, {
      quietMs: 500,
      timeoutMs: 300,
      pollMs: 50,
    });

    const interval = setInterval(() => {
      events.push({});
    }, 40);

    await vi.advanceTimersByTimeAsync(350);
    await done;
    clearInterval(interval);
  });
});
