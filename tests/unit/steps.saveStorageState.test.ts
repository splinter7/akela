import { describe, it, expect, vi, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { executeStep } from "../../src/runner/steps.js";
import type { NetworkCapture } from "../../src/capture/NetworkCapture.js";

const tempDirs: string[] = [];

describe("saveStorageState step", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes storage state relative to cwd", async () => {
    const cwd = join(tmpdir(), `at-save-${Date.now()}`);
    tempDirs.push(cwd);
    mkdirSync(cwd, { recursive: true });
    const outRel = ".auth/state.json";
    const outAbs = join(cwd, outRel);

    const storageState = vi.fn(async ({ path }: { path: string }) => {
      writeFileSync(path, JSON.stringify({ cookies: [], origins: [] }), "utf8");
    });

    const page = {
      context: () => ({ storageState }),
    } as unknown as import("playwright").Page;

    const capture = { getEvents: () => [] } as unknown as NetworkCapture;

    const result = await executeStep(
      page,
      { action: "saveStorageState", path: outRel },
      "http://example.com",
      capture,
      "partial",
      { gotoWaitUntil: "domcontentloaded", cwd },
    );

    expect(result.status).toBe("ran");
    expect(storageState).toHaveBeenCalledWith({ path: outAbs });
    expect(existsSync(outAbs)).toBe(true);
    expect(JSON.parse(readFileSync(outAbs, "utf8"))).toEqual({
      cookies: [],
      origins: [],
    });
  });
});
