import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseGenerateArgs } from "../../src/cli/parseGenerateArgs.js";

describe("parseGenerateArgs", () => {
  it("applies defaults from csv path", () => {
    const opts = parseGenerateArgs(["plans/checkout.csv"]);
    expect(opts).toEqual({
      csvPath: "plans/checkout.csv",
      name: "checkout",
      adapters: ["snowplow"],
      outPath: join("journeys", "checkout.yaml"),
      baseUrl: undefined,
      force: false,
    });
  });

  it("parses overrides", () => {
    const opts = parseGenerateArgs([
      "plans/demo.csv",
      "--name",
      "demo-flow",
      "--adapters",
      "snowplow,segment",
      "--out",
      "journeys/custom.yaml",
      "--base-url",
      "https://staging.example.com",
      "--overwrite",
    ]);
    expect(opts).toEqual({
      csvPath: "plans/demo.csv",
      name: "demo-flow",
      adapters: ["snowplow", "segment"],
      outPath: "journeys/custom.yaml",
      baseUrl: "https://staging.example.com",
      force: true,
    });
  });

  it("parses --out=value form", () => {
    const opts = parseGenerateArgs(["plans/demo.csv", "--out=journeys/custom.yaml"]);
    expect(opts.outPath).toBe("journeys/custom.yaml");
  });

  it("throws when csv path is missing", () => {
    expect(() => parseGenerateArgs([])).toThrow(/Usage/i);
  });
});
