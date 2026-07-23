import { describe, it, expect } from "vitest";
import { substituteVars } from "../../src/journey/substituteVars.js";

describe("substituteVars", () => {
  it("replaces a single placeholder", () => {
    expect(substituteVars("path: /x/${id}/y", { id: "42" })).toBe(
      "path: /x/42/y",
    );
  });

  it("replaces multiple distinct vars and repeated uses", () => {
    const text = "goto ${path}\ncurrency: ${currency}\nagain: ${path}";
    expect(
      substituteVars(text, { path: "/checkout", currency: "USD" }),
    ).toBe("goto /checkout\ncurrency: USD\nagain: /checkout");
  });

  it("leaves text without placeholders unchanged", () => {
    expect(substituteVars("name: demo\npath: /", {})).toBe("name: demo\npath: /");
  });

  it("allows unused vars", () => {
    expect(substituteVars("a: ${x}", { x: "1", y: "2" })).toBe("a: 1");
  });

  it("throws listing missing vars", () => {
    expect(() =>
      substituteVars("a: ${foo}\nb: ${bar}\nc: ${foo}", { foo: "1" }),
    ).toThrow(/Unresolved journey variables: bar/);
  });

  it("throws on empty placeholder", () => {
    expect(() => substituteVars("a: ${}", {})).toThrow(
      /Unresolved journey variables: \(empty\)/,
    );
  });
});
