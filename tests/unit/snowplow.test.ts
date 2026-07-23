import { describe, it, expect } from "vitest";
import { SnowplowAdapter } from "../../src/adapters/snowplow/SnowplowAdapter.js";
import type { CapturedRequest } from "../../src/normalize/types.js";

describe("SnowplowAdapter", () => {
  const adapter = new SnowplowAdapter({
    collectorPatterns: ["/i", "/tp2", "/snowplow/"],
  });

  it("matches collector URL patterns", () => {
    expect(
      adapter.matches({
        url: "https://c.example.com/snowplow/i?e=pv",
        method: "GET",
        headers: {},
        timestamp: 1,
      }),
    ).toBe(true);
    expect(
      adapter.matches({
        url: "https://c.example.com/other",
        method: "GET",
        headers: {},
        timestamp: 1,
      }),
    ).toBe(false);
  });

  it("does not treat fonts/images as Snowplow /i collectors", () => {
    expect(
      adapter.matches({
        url: "http://localhost:3000/service-pro/fonts/inter-v13-latin-regular.woff2",
        method: "GET",
        headers: {},
        timestamp: 1,
      }),
    ).toBe(false);
    expect(
      adapter.matches({
        url: "https://cdn.example.com/images/sp/thumbnail.jpg",
        method: "GET",
        headers: {},
        timestamp: 1,
      }),
    ).toBe(false);
    expect(
      adapter.matches({
        url: "https://collector.example.com/i?e=pv",
        method: "GET",
        headers: {},
        timestamp: 1,
      }),
    ).toBe(true);
  });

  it("parses GET page_view beacon", () => {
    const req: CapturedRequest = {
      url: "https://c.example.com/snowplow/i?e=pv&page=home&aid=demo&dtm=1700000000000",
      method: "GET",
      headers: {},
      timestamp: 1,
    };
    const events = adapter.parse(req);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventName).toBe("page_view");
    expect(events[0]!.properties.page).toBe("home");
    expect(events[0]!.fields.page).toBe("home");
    expect(events[0]!.platform).toBe("snowplow");
    expect(events[0]!.raw.url).toContain("/snowplow/i");
  });

  it("parses POST unstructured event with ue_px", () => {
    const ue = {
      schema: "iglu:com.example/cta_click/jsonschema/1-0-0",
      data: { event_name: "cta_click", button_id: "cta" },
    };
    const ue_px = Buffer.from(JSON.stringify(ue)).toString("base64");
    const body = {
      schema: "iglu:com.snowplowanalytics.snowplow/payload_data/jsonschema/1-0-4",
      data: [{ e: "ue", ue_px, aid: "demo" }],
    };
    const req: CapturedRequest = {
      url: "https://c.example.com/snowplow/com.snowplowanalytics.snowplow/tp2",
      method: "POST",
      postData: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      timestamp: 1,
    };
    const events = adapter.parse(req);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventName).toBe("cta_click");
    expect(events[0]!.properties.button_id).toBe("cta");
  });

  it("parses structured events", () => {
    const req: CapturedRequest = {
      url: "https://c.example.com/i?e=se&se_ca=nav&se_ac=click&se_la=logo",
      method: "GET",
      headers: {},
      timestamp: 1,
    };
    const events = adapter.parse(req);
    expect(events[0]!.eventName).toBe("click");
    expect(events[0]!.properties.category).toBe("nav");
    expect(events[0]!.properties.label).toBe("logo");
    expect(events[0]!.fields.category).toBe("nav");
  });

  it("flattens cx contexts into fields; properties stay payload-only", () => {
    const body = {
      schema: "iglu:com.snowplowanalytics.snowplow/payload_data/jsonschema/1-0-4",
      data: [
        {
          e: "ue",
          ue_pr: {
            schema: "iglu:com.snowplowanalytics.snowplow/unstruct_event/jsonschema/1-0-0",
            data: {
              schema: "iglu:com.example/sponsored_placement_banner_shown/jsonschema/3-0-0",
              data: {
                page: "service_details",
                element: "add_areas_upsell_banner",
                active_area_count: 17,
                available_area_count: 2,
              },
            },
          },
          cx: {
            schema: "iglu:com.snowplowanalytics.snowplow/contexts/jsonschema/1-0-1",
            data: [
              {
                schema: "iglu:com.example/selected_service_context/jsonschema/2-0-0",
                data: { service_id: 179 },
              },
              {
                schema: "iglu:com.example/entities_market_groups_context/jsonschema/1-0-0",
                data: {
                  market_list: [
                    { id: "3754", price: 480, currency: "CAD" },
                  ],
                },
              },
            ],
          },
        },
      ],
    };
    const req: CapturedRequest = {
      url: "https://c.example.com/snowplow/com.snowplowanalytics.snowplow/tp2",
      method: "POST",
      postData: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      timestamp: 1,
    };
    const events = adapter.parse(req);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventName).toBe("sponsored_placement_banner_shown");
    expect(events[0]!.properties).toMatchObject({
      page: "service_details",
      element: "add_areas_upsell_banner",
      active_area_count: 17,
      available_area_count: 2,
    });
    expect(events[0]!.properties.service_id).toBeUndefined();
    expect(events[0]!.fields.service_id).toBe(179);
    expect(events[0]!.fields["selected_service_context.service_id"]).toBe(179);
    expect(events[0]!.fields.market_list).toEqual([
      { id: "3754", price: 480, currency: "CAD" },
    ]);
    expect(events[0]!.fields.page).toBe("service_details");
  });

  it("payload wins over context on flat key collision", () => {
    const body = {
      schema: "iglu:com.snowplowanalytics.snowplow/payload_data/jsonschema/1-0-4",
      data: [
        {
          e: "ue",
          ue_pr: {
            schema: "iglu:com.snowplowanalytics.snowplow/unstruct_event/jsonschema/1-0-0",
            data: {
              schema: "iglu:com.example/evt/jsonschema/1-0-0",
              data: { service_id: 1 },
            },
          },
          cx: {
            schema: "iglu:com.snowplowanalytics.snowplow/contexts/jsonschema/1-0-1",
            data: [
              {
                schema: "iglu:com.example/selected_service_context/jsonschema/1-0-0",
                data: { service_id: 99 },
              },
            ],
          },
        },
      ],
    };
    const req: CapturedRequest = {
      url: "https://c.example.com/snowplow/tp2",
      method: "POST",
      postData: JSON.stringify(body),
      headers: {},
      timestamp: 1,
    };
    const events = adapter.parse(req);
    expect(events[0]!.properties.service_id).toBe(1);
    expect(events[0]!.fields.service_id).toBe(1);
    expect(events[0]!.fields["selected_service_context.service_id"]).toBe(99);
  });

  it("expands POST batch with multiple events in data[]", () => {
    const ueA = {
      schema: "iglu:com.example/event_a/jsonschema/1-0-0",
      data: { event_name: "event_a", n: 1 },
    };
    const ueB = {
      schema: "iglu:com.example/event_b/jsonschema/1-0-0",
      data: { event_name: "event_b", n: 2 },
    };
    const body = {
      schema: "iglu:com.snowplowanalytics.snowplow/payload_data/jsonschema/1-0-4",
      data: [
        { e: "ue", ue_px: Buffer.from(JSON.stringify(ueA)).toString("base64"), aid: "demo" },
        { e: "ue", ue_px: Buffer.from(JSON.stringify(ueB)).toString("base64"), aid: "demo" },
      ],
    };
    const req: CapturedRequest = {
      url: "https://c.example.com/snowplow/tp2",
      method: "POST",
      postData: JSON.stringify(body),
      headers: {},
      timestamp: 1,
    };
    const events = adapter.parse(req);
    expect(events).toHaveLength(2);
    expect(events[0]!.eventName).toBe("event_a");
    expect(events[1]!.eventName).toBe("event_b");
    expect(events[0]!.properties.n).toBe(1);
    expect(events[1]!.properties.n).toBe(2);
  });
});
