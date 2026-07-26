import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadJourney } from "../../src/journey/loadJourney.js";
import type { Journey } from "../../src/normalize/types.js";
import { writeDraftJourneyYaml } from "../../src/record/writeDraftJourney.js";

function sampleJourney(overrides: Partial<Journey> = {}): Journey {
  return {
    name: "recorded-flow",
    baseUrl: "https://example.com",
    gotoWaitUntil: "domcontentloaded",
    options: {
      ordered: true,
      match: "partial",
      forbidExtra: false,
    },
    adapters: ["snowplow"],
    steps: [
      { action: "goto", path: "/" },
      { action: "click", selector: "div > span:nth-child(2)" },
      { action: "waitForEvent", eventName: "cta_click" },
    ],
    expect: [{ eventName: "cta_click", properties: { label: "Buy" } }],
    ...overrides,
  };
}

describe("writeDraftJourneyYaml", () => {
  it("emits plan-seeded DRAFT header with plan path", () => {
    const yaml = writeDraftJourneyYaml(sampleJourney(), {
      planPath: "plans/feature.csv",
      exploratory: false,
      fragileStepIndexes: [],
    });

    expect(yaml.startsWith("# DRAFT — review selectors; expect seeded from plan plans/feature.csv\n")).toBe(
      true,
    );
  });

  it("emits exploratory DRAFT header when exploratory", () => {
    const yaml = writeDraftJourneyYaml(sampleJourney(), {
      exploratory: true,
      fragileStepIndexes: [],
    });

    expect(yaml.startsWith("# DRAFT — exploratory (no --plan)\n")).toBe(true);
  });

  it("emits # FRAGILE-SELECTOR immediately before fragile steps", () => {
    const yaml = writeDraftJourneyYaml(sampleJourney(), {
      planPath: "plans/feature.csv",
      exploratory: false,
      fragileStepIndexes: [1],
    });

    expect(yaml).toContain(
      [
        "steps:",
        "  - action: goto",
        "    path: /",
        "  # FRAGILE-SELECTOR",
        "  - action: click",
        "    selector: div > span:nth-child(2)",
      ].join("\n"),
    );
  });

  it("round-trips through temp file + loadJourney", () => {
    const journey = sampleJourney({
      storageState: ".auth/storage-state.json",
    });
    const yaml = writeDraftJourneyYaml(journey, {
      planPath: "plans/feature.csv",
      exploratory: false,
      fragileStepIndexes: [1],
    });

    const dir = mkdtempSync(join(tmpdir(), "draft-journey-"));
    const filePath = join(dir, "draft.yaml");
    writeFileSync(filePath, yaml, "utf8");

    const loaded = loadJourney(filePath);
    expect(loaded).toEqual(journey);
  });
});
