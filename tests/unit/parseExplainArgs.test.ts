import { describe, expect, it } from "vitest";
import { parseExplainArgs } from "../../src/cli/parseExplainArgs.js";

describe("parseExplainArgs", () => {
  it("parses report path", () => {
    expect(parseExplainArgs(["reports/run-1"])).toEqual({
      reportPath: "reports/run-1",
      json: false,
      verbose: false,
    });
  });

  it("parses --json", () => {
    expect(parseExplainArgs(["reports/run-1", "--json"])).toEqual({
      reportPath: "reports/run-1",
      json: true,
      verbose: false,
    });
  });

  it("parses --verbose", () => {
    expect(parseExplainArgs(["reports/run-1", "--verbose"])).toEqual({
      reportPath: "reports/run-1",
      json: false,
      verbose: true,
    });
  });

  it("rejects missing path", () => {
    expect(() => parseExplainArgs([])).toThrow(
      /Usage: akela explain/,
    );
  });

  it("rejects unknown flags", () => {
    expect(() => parseExplainArgs(["r.json", "--foo"])).toThrow(
      /Unknown option/,
    );
  });
});
