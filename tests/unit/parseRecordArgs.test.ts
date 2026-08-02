import { describe, it, expect } from "vitest";
import { parseRecordArgs } from "../../src/cli/parseRecordArgs.js";

describe("parseRecordArgs", () => {
  it("requires startUrl and applies exploratory defaults", () => {
    const opts = parseRecordArgs(["https://example.com/app"]);
    expect(opts).toEqual({
      startUrl: "https://example.com/app",
      planPath: undefined,
      name: "recorded",
      adapters: ["snowplow"],
      outPath: undefined,
      baseUrl: undefined,
      storageState: undefined,
      overwrite: false,
      force: false,
      allowIncomplete: false,
      includeUnplanned: false,
    });
  });

  it("defaults name from plan basename when --plan is set", () => {
    const opts = parseRecordArgs([
      "https://example.com/",
      "--plan",
      "plans/checkout.csv",
    ]);
    expect(opts.planPath).toBe("plans/checkout.csv");
    expect(opts.name).toBe("checkout");
    expect(opts.outPath).toBeUndefined();
  });

  it("parses flag overrides", () => {
    const opts = parseRecordArgs([
      "https://staging.example.com/start",
      "--plan=plans/demo.csv",
      "--name",
      "demo-flow",
      "--adapters",
      "snowplow,segment",
      "--out",
      "journeys/custom.yaml",
      "--base-url",
      "https://staging.example.com",
      "--storage-state",
      ".auth/storage-state.json",
      "--overwrite",
      "--force",
      "--allow-incomplete",
      "--include-unplanned",
    ]);
    expect(opts).toEqual({
      startUrl: "https://staging.example.com/start",
      planPath: "plans/demo.csv",
      name: "demo-flow",
      adapters: ["snowplow", "segment"],
      outPath: "journeys/custom.yaml",
      baseUrl: "https://staging.example.com",
      storageState: ".auth/storage-state.json",
      overwrite: true,
      force: true,
      allowIncomplete: true,
      includeUnplanned: true,
    });
  });

  it("parses -o as out path", () => {
    const opts = parseRecordArgs([
      "https://example.com/",
      "-o",
      "journeys/via-short.yaml",
    ]);
    expect(opts.outPath).toBe("journeys/via-short.yaml");
  });

  it("parses --out=value form", () => {
    const opts = parseRecordArgs([
      "https://example.com/",
      "--out=journeys/eq.yaml",
    ]);
    expect(opts.outPath).toBe("journeys/eq.yaml");
  });

  it("throws when startUrl is missing", () => {
    expect(() => parseRecordArgs([])).toThrow(/Usage/i);
  });

  it("throws on unknown option", () => {
    expect(() =>
      parseRecordArgs(["https://example.com/", "--unknown"]),
    ).toThrow(/Unknown option/);
  });
});
