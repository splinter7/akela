import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatPlanValidationErrors,
  validatePlanCsv,
} from "../../src/plan/validatePlanCsv.js";
import { generatePlanCsvToYaml } from "../../src/plan/generateJourney.js";

describe("validatePlanCsv", () => {
  it("passes the demo plan CSV", () => {
    const csv = readFileSync(resolve("plans/demo.csv"), "utf8");
    const result = validatePlanCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(2);
    }
  });

  it("ignores extra columns and still parses known ones", () => {
    const csv = [
      "Priority,eventName,trigger,path,comment,properties",
      'First,page_view,page_load,/,ignore me,"{""page"":""home""}"',
      "Second,cta_click,click,,,",
    ].join("\n");

    const result = validatePlanCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      eventName: "page_view",
      trigger: "page_load",
      path: "/",
      properties: { page: "home" },
    });
    expect(result.rows[1]).toEqual({
      eventName: "cta_click",
      trigger: "click",
    });
    expect(result.rows[0]).not.toHaveProperty("Priority");
    expect(result.rows[0]).not.toHaveProperty("comment");
  });

  it("collects multiple row errors", () => {
    const csv = [
      "eventName,trigger,path,selector,value,properties",
      "a,hover,,,,",
      "page_view,page_load,,,,",
      "fill_me,fill,,#email,,",
    ].join("\n");

    const result = validatePlanCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors.some((e) => e.row === 2 && e.column === "trigger")).toBe(true);
    expect(result.errors.some((e) => e.row === 3 && e.column === "path")).toBe(true);
    expect(result.errors.some((e) => e.row === 4 && e.column === "value")).toBe(true);
  });

  it("reports missing required headers", () => {
    const csv = ["eventName,path", "a,/"].join("\n");
    const result = validatePlanCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.column === "trigger")).toBe(true);
  });

  it("reports empty CSV", () => {
    const result = validatePlanCsv("   \n  ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toMatch(/empty/i);
  });

  it("reports invalid properties and fields JSON", () => {
    const csv = [
      "eventName,trigger,path,selector,value,properties,fields",
      "x,click,,,,not-json,",
      "y,click,,,,,also-bad",
    ].join("\n");
    const result = validatePlanCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.column === "properties")).toBe(true);
    expect(result.errors.some((e) => e.column === "fields")).toBe(true);
  });

  it("formats errors for CLI display", () => {
    const text = formatPlanValidationErrors([
      { column: "trigger", message: "Plan CSV missing required column: trigger" },
      { row: 2, column: "path", message: "path is required when trigger is page_load" },
    ]);
    expect(text).toContain("[trigger]: Plan CSV missing required column: trigger");
    expect(text).toContain("Row 2 [path]: path is required when trigger is page_load");
  });
});

describe("generatePlanCsvToYaml", () => {
  it("returns yaml when CSV is valid", () => {
    const csv = [
      "eventName,trigger,path",
      "page_view,page_load,/",
    ].join("\n");
    const result = generatePlanCsvToYaml(csv, { name: "demo" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.yaml).toContain("name: demo");
    expect(result.yaml).toContain("page_view");
  });

  it("does not produce yaml when validation fails", () => {
    const csv = [
      "eventName,trigger,path",
      "page_view,page_load,",
    ].join("\n");
    const result = generatePlanCsvToYaml(csv, { name: "bad" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.column === "path")).toBe(true);
    expect(result).not.toHaveProperty("yaml");
  });
});
