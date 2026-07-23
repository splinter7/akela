import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { parsePlanCsv } from "../../src/plan/parsePlanCsv.js";
import { generateJourneyYaml } from "../../src/plan/generateJourney.js";
import type { Journey } from "../../src/normalize/types.js";

describe("plans/demo.csv", () => {
  it("generates a loadable journey matching the demo flow", () => {
    const csv = readFileSync(resolve("plans/demo.csv"), "utf8");
    const rows = parsePlanCsv(csv);
    const yamlText = generateJourneyYaml(rows, { name: "demo" });
    const journey = parseYaml(yamlText) as Journey;

    expect(journey.name).toBe("demo");
    expect(journey.steps.some((s) => s.action === "goto" && s.path === "/")).toBe(true);
    expect(journey.steps.some((s) => s.action === "click" && s.selector === "#cta")).toBe(true);
    expect(journey.expect.map((e) => e.eventName)).toEqual(["page_view", "cta_click"]);
    expect(yamlText).toContain("# Home page load");
  });
});
