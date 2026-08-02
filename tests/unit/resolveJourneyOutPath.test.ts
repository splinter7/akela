import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveJourneyOutPath } from "../../src/cli/resolveJourneyOutPath.js";

describe("resolveJourneyOutPath", () => {
  it("uses explicit --out when provided", () => {
    expect(
      resolveJourneyOutPath("custom/out.yaml", "checkout", "tracking/journeys"),
    ).toBe("custom/out.yaml");
  });

  it("defaults to journeysDir/name.yaml when out omitted", () => {
    expect(resolveJourneyOutPath(undefined, "checkout", "tracking/journeys")).toBe(
      join("tracking/journeys", "checkout.yaml"),
    );
  });

  it("uses default journeysDir value from caller", () => {
    expect(resolveJourneyOutPath(undefined, "demo", "journeys")).toBe(
      join("journeys", "demo.yaml"),
    );
  });
});
