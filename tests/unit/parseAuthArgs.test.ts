import { describe, it, expect } from "vitest";
import { parseAuthArgs } from "../../src/cli/parseAuthArgs.js";

describe("parseAuthArgs", () => {
  it("parses journey and vars", () => {
    expect(
      parseAuthArgs([
        "journeys/login.yaml",
        "--var",
        "AUTH_EMAIL=a@b.com",
        "--var=AUTH_PASSWORD=secret",
      ]),
    ).toEqual({
      journeyPath: "journeys/login.yaml",
      vars: { AUTH_EMAIL: "a@b.com", AUTH_PASSWORD: "secret" },
      headless: undefined,
    });
  });

  it("honors --headless", () => {
    expect(parseAuthArgs(["j.yaml", "--headless"]).headless).toBe(true);
  });

  it("honors --headed", () => {
    expect(parseAuthArgs(["j.yaml", "--headed"]).headless).toBe(false);
  });

  it("last flag wins when both --headed and --headless passed", () => {
    expect(
      parseAuthArgs(["j.yaml", "--headed", "--headless"]).headless,
    ).toBe(true);
    expect(
      parseAuthArgs(["j.yaml", "--headless", "--headed"]).headless,
    ).toBe(false);
  });

  it("defaults headless to undefined when no flag passed", () => {
    expect(parseAuthArgs(["j.yaml"]).headless).toBeUndefined();
  });

  it("throws when journey path is missing", () => {
    expect(() => parseAuthArgs([])).toThrow();
  });

  it("throws on unknown option", () => {
    expect(() => parseAuthArgs(["j.yaml", "--bogus"])).toThrow(
      /Unknown option/,
    );
  });
});
