import { describe, it, expect } from "vitest";
import { parseRunArgs } from "../../src/cli/parseRunArgs.js";

describe("parseRunArgs", () => {
  it("parses journey path with no vars", () => {
    expect(parseRunArgs(["journeys/demo.yaml"])).toEqual({
      journeyPath: "journeys/demo.yaml",
      vars: {},
    });
  });

  it("parses multiple --var flags", () => {
    expect(
      parseRunArgs([
        "journeys/x.yaml",
        "--var",
        "service_id=450",
        "--var=currency=USD",
      ]),
    ).toEqual({
      journeyPath: "journeys/x.yaml",
      vars: { service_id: "450", currency: "USD" },
    });
  });

  it("later --var wins for the same name", () => {
    expect(
      parseRunArgs([
        "j.yaml",
        "--var",
        "id=1",
        "--var",
        "id=2",
      ]),
    ).toEqual({
      journeyPath: "j.yaml",
      vars: { id: "2" },
    });
  });

  it("requires journey path", () => {
    expect(() => parseRunArgs([])).toThrow(/Usage: analytics-tracker run/);
    expect(() => parseRunArgs(["--var", "a=1"])).toThrow(
      /Usage: analytics-tracker run/,
    );
  });

  it("rejects invalid --var form", () => {
    expect(() => parseRunArgs(["j.yaml", "--var", "noequals"])).toThrow(
      /name=value/,
    );
  });

  it("rejects unknown options", () => {
    expect(() => parseRunArgs(["j.yaml", "--foo"])).toThrow(/Unknown option/);
  });
});
