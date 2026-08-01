import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdInit } from "../../src/cli/cmdInit.js";

describe("cmdInit", () => {
  it("creates default plans and journeys dirs and seeds config keys", () => {
    const cwd = mkdtempSync(join(tmpdir(), "akela-init-"));
    cmdInit(cwd);
    expect(existsSync(join(cwd, "plans"))).toBe(true);
    expect(existsSync(join(cwd, "journeys"))).toBe(true);
    expect(existsSync(join(cwd, "journeys", "example.yaml"))).toBe(true);
    const cfg = readFileSync(join(cwd, "akela.config.yaml"), "utf8");
    expect(cfg).toMatch(/plansDir:\s*plans/);
    expect(cfg).toMatch(/journeysDir:\s*journeys/);
  });

  it("uses custom dirs from existing config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "akela-init-"));
    writeFileSync(
      join(cwd, "akela.config.yaml"),
      ["plansDir: tracking/plans", "journeysDir: tracking/journeys", "headless: true"].join(
        "\n",
      ),
      "utf8",
    );
    cmdInit(cwd);
    expect(existsSync(join(cwd, "tracking", "plans"))).toBe(true);
    expect(existsSync(join(cwd, "tracking", "journeys", "example.yaml"))).toBe(
      true,
    );
  });

  it("creates dirs at absolute plansDir and journeysDir paths", () => {
    const cwd = mkdtempSync(join(tmpdir(), "akela-init-"));
    const absPlansDir = mkdtempSync(join(tmpdir(), "akela-abs-plans-"));
    const absJourneysDir = mkdtempSync(join(tmpdir(), "akela-abs-journeys-"));
    writeFileSync(
      join(cwd, "akela.config.yaml"),
      [
        `plansDir: ${JSON.stringify(absPlansDir)}`,
        `journeysDir: ${JSON.stringify(absJourneysDir)}`,
        "headless: true",
      ].join("\n"),
      "utf8",
    );
    cmdInit(cwd);
    expect(existsSync(absPlansDir)).toBe(true);
    expect(existsSync(join(absJourneysDir, "example.yaml"))).toBe(true);
    expect(existsSync(join(cwd, "plans"))).toBe(false);
    expect(existsSync(join(cwd, "journeys", "example.yaml"))).toBe(false);
    const mangledPlansDir = join(cwd, absPlansDir);
    const mangledJourneysDir = join(cwd, absJourneysDir);
    if (mangledPlansDir !== absPlansDir) {
      expect(existsSync(mangledPlansDir)).toBe(false);
    }
    if (mangledJourneysDir !== absJourneysDir) {
      expect(existsSync(mangledJourneysDir)).toBe(false);
    }
  });
});
