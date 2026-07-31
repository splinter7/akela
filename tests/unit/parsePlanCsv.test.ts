import { describe, it, expect } from "vitest";
import { parsePlanCsv } from "../../src/plan/parsePlanCsv.js";

describe("parsePlanCsv", () => {
  it("parses a valid hybrid plan", () => {
    const csv = [
      "eventName,trigger,path,selector,value,properties,notes",
      'page_view,page_load,/,,,"{""page"":""home""}",Home page load',
      'cta_click,click,,#cta,,"{""button_id"":""cta""}",Click primary CTA',
      "email_filled,fill,,#email,user@example.com,{},Fill email field",
    ].join("\n");

    const rows = parsePlanCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      eventName: "page_view",
      trigger: "page_load",
      path: "/",
      properties: { page: "home" },
      notes: "Home page load",
    });
    expect(rows[1]).toMatchObject({
      eventName: "cta_click",
      trigger: "click",
      selector: "#cta",
      properties: { button_id: "cta" },
    });
    expect(rows[2]).toMatchObject({
      eventName: "email_filled",
      trigger: "fill",
      selector: "#email",
      value: "user@example.com",
      properties: {},
    });
  });

  it("allows empty optional columns and missing selector", () => {
    const csv = [
      "eventName,trigger,path,selector,value,properties,notes",
      "cta_click,click,,,,,",
    ].join("\n");

    const rows = parsePlanCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventName: "cta_click",
      trigger: "click",
    });
    expect(rows[0].selector).toBeUndefined();
    expect(rows[0].properties).toBeUndefined();
  });

  it("rejects unknown trigger with row number", () => {
    const csv = [
      "eventName,trigger,path,selector,value,properties,notes",
      "x,hover,,,,,",
    ].join("\n");

    expect(() => parsePlanCsv(csv)).toThrow(/row 2/i);
    expect(() => parsePlanCsv(csv)).toThrow(/trigger/i);
  });

  it("requires path for page_load", () => {
    const csv = [
      "eventName,trigger,path,selector,value,properties,notes",
      "page_view,page_load,,,,,",
    ].join("\n");

    expect(() => parsePlanCsv(csv)).toThrow(/row 2/i);
    expect(() => parsePlanCsv(csv)).toThrow(/path/i);
  });

  it("requires value for fill", () => {
    const csv = [
      "eventName,trigger,path,selector,value,properties,notes",
      "email_filled,fill,,#email,,,",
    ].join("\n");

    expect(() => parsePlanCsv(csv)).toThrow(/row 2/i);
    expect(() => parsePlanCsv(csv)).toThrow(/value/i);
  });

  it("rejects invalid properties JSON with row number", () => {
    const csv = [
      "eventName,trigger,path,selector,value,properties,notes",
      'x,click,,,,not-json,',
    ].join("\n");

    expect(() => parsePlanCsv(csv)).toThrow(/row 2/i);
    expect(() => parsePlanCsv(csv)).toThrow(/properties/i);
  });

  it("parses optional fields JSON column", () => {
    const csv = [
      "eventName,trigger,path,selector,value,properties,fields,notes",
      'banner_shown,page_load,/details,,,"{""page"":""product_page""}","{""product_id"":179}",Banner',
    ].join("\n");

    const rows = parsePlanCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventName: "banner_shown",
      trigger: "page_load",
      path: "/details",
      properties: { page: "product_page" },
      fields: { product_id: 179 },
      notes: "Banner",
    });
  });

  it("rejects invalid fields JSON with row number", () => {
    const csv = [
      "eventName,trigger,path,selector,value,properties,fields,notes",
      "x,click,,,,,not-json,",
    ].join("\n");

    expect(() => parsePlanCsv(csv)).toThrow(/row 2/i);
    expect(() => parsePlanCsv(csv)).toThrow(/fields/i);
  });

  it("requires eventName", () => {
    const csv = [
      "eventName,trigger,path,selector,value,properties,notes",
      ",click,,,,,",
    ].join("\n");

    expect(() => parsePlanCsv(csv)).toThrow(/row 2/i);
    expect(() => parsePlanCsv(csv)).toThrow(/eventName/i);
  });

  it("rejects missing required header columns", () => {
    const csv = ["eventName,path", "a,/"].join("\n");
    expect(() => parsePlanCsv(csv)).toThrow(/trigger/i);
  });
});
