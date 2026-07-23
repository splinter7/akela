export type PlanTrigger = "page_load" | "click" | "fill" | "scroll";

export type PlanRow = {
  eventName: string;
  trigger: PlanTrigger;
  path?: string;
  selector?: string;
  value?: string;
  properties?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  notes?: string;
};

export type PlanValidationError = {
  /** 1-based CSV row; omit for file/header issues */
  row?: number;
  column?: string;
  message: string;
};

export type PlanValidationResult =
  | { ok: true; rows: PlanRow[] }
  | { ok: false; errors: PlanValidationError[] };

const REQUIRED_HEADERS = ["eventName", "trigger"] as const;
const KNOWN_HEADERS = [
  "eventName",
  "trigger",
  "path",
  "selector",
  "value",
  "properties",
  "fields",
  "notes",
] as const;

const KNOWN_HEADER_SET = new Set<string>(KNOWN_HEADERS);
const TRIGGERS = new Set<PlanTrigger>(["page_load", "click", "fill", "scroll"]);

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parseJsonObject(
  raw: string,
  column: "properties" | "fields",
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, message: `${column} must be a JSON object` };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `invalid ${column} JSON (${msg})` };
  }
}

/** Format structured validation errors for CLI output. */
export function formatPlanValidationErrors(errors: PlanValidationError[]): string {
  return errors
    .map((e) => {
      const parts: string[] = [];
      if (e.row !== undefined) parts.push(`Row ${e.row}`);
      if (e.column) parts.push(`[${e.column}]`);
      const prefix = parts.length ? `${parts.join(" ")}: ` : "";
      return `${prefix}${e.message}`;
    })
    .join("\n");
}

/**
 * Validate a canonical plan CSV. Extra/unknown headers are ignored.
 * Collects all errors (does not fail on first).
 */
export function validatePlanCsv(csvText: string): PlanValidationResult {
  const errors: PlanValidationError[] = [];
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { ok: false, errors: [{ message: "Plan CSV is empty" }] };
  }

  const headers = parseCsvLine(lines[0]!).map((h) => h.trim());
  const headerIndex = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]!;
    if (KNOWN_HEADER_SET.has(h) && !headerIndex.has(h)) {
      headerIndex.set(h, i);
    }
  }

  for (const required of REQUIRED_HEADERS) {
    if (!headerIndex.has(required)) {
      errors.push({
        column: required,
        message: `Plan CSV missing required column: ${required}`,
      });
    }
  }

  const rows: PlanRow[] = [];

  for (let lineIdx = 1; lineIdx < lines.length; lineIdx++) {
    const rowNumber = lineIdx + 1;
    const cells = parseCsvLine(lines[lineIdx]!);
    const get = (name: (typeof KNOWN_HEADERS)[number]): string | undefined => {
      const idx = headerIndex.get(name);
      if (idx === undefined) return undefined;
      return cells[idx];
    };

    const rowErrorsStart = errors.length;
    const eventName = emptyToUndefined(get("eventName"));
    let trigger: PlanTrigger | undefined;

    if (headerIndex.has("eventName") && !eventName) {
      errors.push({
        row: rowNumber,
        column: "eventName",
        message: "eventName is required",
      });
    }

    const triggerRaw = emptyToUndefined(get("trigger"));
    if (headerIndex.has("trigger")) {
      if (!triggerRaw || !TRIGGERS.has(triggerRaw as PlanTrigger)) {
        errors.push({
          row: rowNumber,
          column: "trigger",
          message: `trigger must be one of page_load, click, fill, scroll (got ${triggerRaw ?? "empty"})`,
        });
      } else {
        trigger = triggerRaw as PlanTrigger;
      }
    }

    const path = emptyToUndefined(get("path"));
    const selector = emptyToUndefined(get("selector"));
    const value = emptyToUndefined(get("value"));
    const notes = emptyToUndefined(get("notes"));
    const propertiesRaw = emptyToUndefined(get("properties"));
    const fieldsRaw = emptyToUndefined(get("fields"));

    if (trigger === "page_load" && !path) {
      errors.push({
        row: rowNumber,
        column: "path",
        message: "path is required when trigger is page_load",
      });
    }
    if (trigger === "fill" && !value) {
      errors.push({
        row: rowNumber,
        column: "value",
        message: "value is required when trigger is fill",
      });
    }

    let properties: Record<string, unknown> | undefined;
    if (propertiesRaw !== undefined) {
      const parsed = parseJsonObject(propertiesRaw, "properties");
      if (!parsed.ok) {
        errors.push({ row: rowNumber, column: "properties", message: parsed.message });
      } else {
        properties = parsed.value;
      }
    }

    let fields: Record<string, unknown> | undefined;
    if (fieldsRaw !== undefined) {
      const parsed = parseJsonObject(fieldsRaw, "fields");
      if (!parsed.ok) {
        errors.push({ row: rowNumber, column: "fields", message: parsed.message });
      } else {
        fields = parsed.value;
      }
    }

    if (errors.length === rowErrorsStart && eventName && trigger) {
      rows.push({
        eventName,
        trigger,
        ...(path !== undefined ? { path } : {}),
        ...(selector !== undefined ? { selector } : {}),
        ...(value !== undefined ? { value } : {}),
        ...(properties !== undefined ? { properties } : {}),
        ...(fields !== undefined ? { fields } : {}),
        ...(notes !== undefined ? { notes } : {}),
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (rows.length === 0) {
    return {
      ok: false,
      errors: [{ message: "Plan CSV has no data rows" }],
    };
  }

  return { ok: true, rows };
}
