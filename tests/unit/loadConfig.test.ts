import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/config/loadConfig.js";

function writeConfig(cwd: string, yaml: string): void {
  writeFileSync(join(cwd, "akela.config.yaml"), yaml, "utf8");
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

  it("accepts valid record.selectorPrefer", () => {
    const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
    writeConfig(
      cwd,
      [
        "record:",
        "  selectorPrefer:",
        "    - data-analytics-id",
        "    - data-testid",
      ].join("\n"),
    );
    const cfg = loadConfig(cwd);
    expect(cfg.record?.selectorPrefer).toEqual([
      "data-analytics-id",
      "data-testid",
    ]);
  });

  it("rejects invalid record.selectorPrefer names", () => {
    const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
    writeConfig(
      cwd,
      ["record:", "  selectorPrefer:", "    - data-cy"].join("\n"),
    );
    expect(() => loadConfig(cwd)).toThrow(/selectorPrefer|Invalid|enum/i);
  });

  it("loads identically when record is omitted", () => {
    const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
    writeConfig(cwd, "headless: false\n");
    const cfg = loadConfig(cwd);
    expect(cfg.record).toBeUndefined();
    expect(cfg.headless).toBe(false);
    expect(cfg.quietMs).toBe(200);
  });

  it("ignores legacy analytics-tracker.config.yaml", () => {
    const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
    writeFileSync(
      join(cwd, "analytics-tracker.config.yaml"),
      "headless: false\n",
      "utf8",
    );
    const cfg = loadConfig(cwd);
    expect(cfg.headless).toBe(true);
  });

  it("defaults plansDir and journeysDir when config file is missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
    const cfg = loadConfig(cwd);
    expect(cfg.plansDir).toBe("plans");
    expect(cfg.journeysDir).toBe("journeys");
  });

  it("accepts plansDir and journeysDir overrides", () => {
    const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
    writeConfig(
      cwd,
      ["plansDir: tracking/plans", "journeysDir: tracking/journeys"].join("\n"),
    );
    const cfg = loadConfig(cwd);
    expect(cfg.plansDir).toBe("tracking/plans");
    expect(cfg.journeysDir).toBe("tracking/journeys");
  });

  it("rejects empty plansDir", () => {
    const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
    writeConfig(cwd, 'plansDir: ""\n');
    expect(() => loadConfig(cwd)).toThrow(/plansDir/);
  });

  it("rejects empty journeysDir", () => {
    const cwd = mkdtempSync(join(tmpdir(), "analytics-cfg-"));
    writeConfig(cwd, 'journeysDir: ""\n');
    expect(() => loadConfig(cwd)).toThrow(/journeysDir/);
  });
});
