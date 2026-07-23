import type { CapturedRequest, NormalizedEvent } from "../../normalize/types.js";
import type { AnalyticsAdapter } from "../types.js";

export type SnowplowAdapterOptions = {
  collectorPatterns?: string[];
};

export type SnowplowContextEntity = {
  schema: string;
  data: Record<string, unknown>;
};

const DEFAULT_PATTERNS = [
  "/i",
  "/com.snowplowanalytics.snowplow/tp2",
  "/snowplow/",
];

/**
 * Match collector path patterns without false positives.
 * Plain "/i" must be a path segment (…/i), not a substring of /images or /inter-….
 */
export function pathnameMatchesCollector(pathname: string, pattern: string): boolean {
  if (pattern === "/i" || pattern === "i") {
    return pathname === "/i" || pathname.endsWith("/i");
  }
  return pathname.includes(pattern);
}

function decodeBase64Json(value: string): unknown {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return value;
  }
}

function parseJsonMaybe(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/** Iglu schema entity/event name: path segment before `/jsonschema/VERSION`. */
export function entityNameFromSchema(schema: string): string {
  const parts = schema.split("/");
  // iglu:vendor/name/jsonschema/1-0-0 → name at index 1
  if (parts.length >= 2) return parts[1]!;
  return schema;
}

function schemaEventName(schema: string): string | undefined {
  const name = entityNameFromSchema(schema);
  if (!name || name === schema) return undefined;
  // Skip the unstruct_event / contexts wrapper schemas
  if (name === "unstruct_event" || name === "contexts" || name === "payload_data") {
    return undefined;
  }
  return name;
}

function eventNameFromParams(params: Record<string, string>, payload: unknown): string {
  if (params.e === "pv") return "page_view";
  if (params.e === "pp") return "page_ping";
  if (params.e === "se") {
    return params.se_ac || params.se_ca || "structured_event";
  }
  if (params.e === "ue" || params.e === "ue_px") {
    if (payload && typeof payload === "object") {
      const root = payload as Record<string, unknown>;
      const nested = root.data;
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const nestedObj = nested as Record<string, unknown>;
        if (typeof nestedObj.event_name === "string") return nestedObj.event_name;
        if (typeof nestedObj.schema === "string") {
          const fromNested = schemaEventName(nestedObj.schema);
          if (fromNested) return fromNested;
        }
      }
      if (typeof root.event_name === "string") return root.event_name;
      if (typeof root.schema === "string") {
        const fromRoot = schemaEventName(root.schema);
        if (fromRoot) return fromRoot;
      }
    }
    return "unstructured_event";
  }
  if (params.e) return params.e;
  if (payload && typeof payload === "object") {
    const batch = payload as { schema?: string; data?: unknown[] };
    if (Array.isArray(batch.data) && batch.data.length > 0) {
      return "batch";
    }
  }
  return "unknown";
}

function propertiesFromParams(params: Record<string, string>, decodedUe: unknown): Record<string, unknown> {
  const props: Record<string, unknown> = {};

  const map: Record<string, string> = {
    page: "page",
    url: "url",
    aid: "app_id",
    uid: "user_id",
    se_ca: "category",
    se_ac: "action",
    se_la: "label",
    se_pr: "property",
    se_va: "value",
  };

  for (const [key, dest] of Object.entries(map)) {
    if (params[key] !== undefined) props[dest] = params[key];
  }

  if (params.e) props.event_type = params.e;

  if (decodedUe && typeof decodedUe === "object") {
    const data = (decodedUe as { data?: { data?: Record<string, unknown> } | Record<string, unknown> }).data;
    const inner = data && typeof data === "object" && "data" in data
      ? (data as { data: Record<string, unknown> }).data
      : (data as Record<string, unknown> | undefined);
    if (inner && typeof inner === "object") {
      Object.assign(props, inner);
    }
  }

  return props;
}

/**
 * Flatten payload properties + Snowplow contexts into a searchable fields bag.
 * Payload wins on flat key collision; schema-qualified keys are always added.
 */
export function buildFields(
  properties: Record<string, unknown>,
  contexts: SnowplowContextEntity[],
): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...properties };

  for (const ctx of contexts) {
    const entityName = entityNameFromSchema(ctx.schema);
    for (const [key, value] of Object.entries(ctx.data)) {
      if (!(key in fields)) {
        fields[key] = value;
      }
      fields[`${entityName}.${key}`] = value;
    }
  }

  return fields;
}

export function parseContexts(raw: unknown): SnowplowContextEntity[] {
  if (raw === undefined || raw === null) return [];

  let decoded: unknown = raw;
  if (typeof raw === "string") {
    // Prefer base64 (cx_px); fall back to JSON string (cx)
    const asB64 = decodeBase64Json(raw);
    decoded = typeof asB64 === "string" ? parseJsonMaybe(raw) : asB64;
  }

  if (!decoded || typeof decoded !== "object") return [];

  const envelope = decoded as { data?: unknown };
  const list = Array.isArray(envelope.data) ? envelope.data : Array.isArray(decoded) ? decoded : [];

  const contexts: SnowplowContextEntity[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as { schema?: unknown; data?: unknown };
    if (typeof obj.schema !== "string") continue;
    if (!obj.data || typeof obj.data !== "object" || Array.isArray(obj.data)) continue;
    contexts.push({
      schema: obj.schema,
      data: obj.data as Record<string, unknown>,
    });
  }
  return contexts;
}

function decodeUe(item: Record<string, unknown>, params: Record<string, string>): unknown {
  if (typeof item.ue_px === "string") return decodeBase64Json(item.ue_px);
  if (item.ue_pr !== undefined) return parseJsonMaybe(item.ue_pr);
  if (params.ue_px) return decodeBase64Json(params.ue_px);
  if (params.ue_pr) return parseJsonMaybe(params.ue_pr);
  return undefined;
}

function contextsFromItem(item: Record<string, unknown>, params: Record<string, string>): SnowplowContextEntity[] {
  if (item.cx !== undefined) return parseContexts(item.cx);
  if (typeof item.cx_px === "string") return parseContexts(item.cx_px);
  if (params.cx) return parseContexts(params.cx);
  if (params.cx_px) return parseContexts(params.cx_px);
  return [];
}

function parseQueryString(url: string): Record<string, string> {
  try {
    const u = new URL(url);
    const params: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      params[k] = v;
    });
    return params;
  } catch {
    const qIndex = url.indexOf("?");
    if (qIndex === -1) return {};
    const params: Record<string, string> = {};
    const search = new URLSearchParams(url.slice(qIndex + 1));
    search.forEach((v, k) => {
      params[k] = v;
    });
    return params;
  }
}

type ExpandedItem = {
  params: Record<string, string>;
  payload: unknown;
  contexts: SnowplowContextEntity[];
};

function expandPostBody(postData: string | null | undefined): ExpandedItem[] {
  if (!postData) return [];

  try {
    const json = JSON.parse(postData) as {
      schema?: string;
      data?: Array<Record<string, unknown>>;
    };

    if (Array.isArray(json.data)) {
      return json.data.map((item) => {
        const params: Record<string, string> = {};
        for (const [k, v] of Object.entries(item)) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            params[k] = String(v);
          }
        }
        const decodedUe = decodeUe(item, params);
        return {
          params,
          payload: decodedUe ?? item,
          contexts: contextsFromItem(item, params),
        };
      });
    }

    return [{ params: {}, payload: json, contexts: [] }];
  } catch {
    // form-encoded body
    const params: Record<string, string> = {};
    const search = new URLSearchParams(postData);
    search.forEach((v, k) => {
      params[k] = v;
    });
    let decodedUe: unknown;
    if (params.ue_px) decodedUe = decodeBase64Json(params.ue_px);
    else if (params.ue_pr) decodedUe = parseJsonMaybe(params.ue_pr);
    return [
      {
        params,
        payload: decodedUe ?? params,
        contexts: contextsFromItem({}, params),
      },
    ];
  }
}

export class SnowplowAdapter implements AnalyticsAdapter {
  readonly name = "snowplow";
  private patterns: string[];

  constructor(options: SnowplowAdapterOptions = {}) {
    this.patterns = options.collectorPatterns?.length
      ? options.collectorPatterns
      : DEFAULT_PATTERNS;
  }

  matches(request: CapturedRequest): boolean {
    try {
      const pathname = new URL(request.url).pathname;
      return this.patterns.some((p) => pathnameMatchesCollector(pathname, p));
    } catch {
      return this.patterns.some((p) => request.url.includes(p));
    }
  }

  parse(request: CapturedRequest): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];

    if (request.method.toUpperCase() === "GET") {
      const params = parseQueryString(request.url);
      let decodedUe: unknown;
      if (params.ue_px) decodedUe = decodeBase64Json(params.ue_px);
      else if (params.ue_pr) decodedUe = parseJsonMaybe(params.ue_pr);
      const contexts = contextsFromItem({}, params);
      const properties = propertiesFromParams(params, decodedUe);
      const eventName = eventNameFromParams(params, decodedUe);
      events.push({
        platform: "snowplow",
        eventName,
        timestamp: params.dtm ? new Date(Number(params.dtm)).toISOString() : undefined,
        properties,
        fields: buildFields(properties, contexts),
        raw: {
          url: request.url,
          method: request.method,
          body: request.postData ?? undefined,
          payload: { params, ue: decodedUe, contexts },
        },
      });
      return events;
    }

    // POST
    const items = expandPostBody(request.postData);
    for (const item of items) {
      const properties = propertiesFromParams(item.params, item.payload);
      const eventName = eventNameFromParams(item.params, item.payload);
      events.push({
        platform: "snowplow",
        eventName,
        timestamp: item.params.dtm
          ? new Date(Number(item.params.dtm)).toISOString()
          : undefined,
        properties,
        fields: buildFields(properties, item.contexts),
        raw: {
          url: request.url,
          method: request.method,
          body: request.postData ?? undefined,
          payload: item.payload,
        },
      });
    }

    return events;
  }
}
