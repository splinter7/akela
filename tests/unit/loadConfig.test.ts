import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/config/loadConfig.js";

function writeConfig(cwd: string, yaml: string): void {
  writeFileSync(join(cwd, "analytics-tracker.config.yaml"), yaml, "utf8");
}

describe("loadConfig", () => {
  it("returns defaults when config file is missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
    const cfg = loadConfig(cwd);
    expect(cfg.quietMs).toBe(200);
    expect(cfg.quietTimeoutMs).toBe(2000);
    expect(cfg.headless).toBe(true);
  });

  it("rejects negative quietMs", () => {
    const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
    writeConfig(cwd, "quietMs: -1\n");
    expect(() => loadConfig(cwd)).toThrow(/quietMs/);
  });

  it("rejects invalid gotoWaitUntil", () => {
    const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
    writeConfig(cwd, "gotoWaitUntil: not-a-real-value\n");
    expect(() => loadConfig(cwd)).toThrow(/gotoWaitUntil/);
  });

  it("rejects quietTimeoutMs < quietMs", () => {
    const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
    writeConfig(cwd, "quietMs: 500\nquietTimeoutMs: 100\n");
    expect(() => loadConfig(cwd)).toThrow(/quietTimeoutMs must be >= quietMs/);
  });

  it("accepts valid overrides", () => {
    const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
    writeConfig(
      cwd,
      [
        "quietMs: 50",
        "quietTimeoutMs: 100",
        "gotoWaitUntil: load",
        "headless: false",
      ].join("\n"),
    );
    const cfg = loadConfig(cwd);
    expect(cfg.quietMs).toBe(50);
    expect(cfg.quietTimeoutMs).toBe(100);
    expect(cfg.gotoWaitUntil).toBe("load");
    expect(cfg.headless).toBe(false);
  });
});
