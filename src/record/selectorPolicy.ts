export type ResolvedSelector = {
  selector: string;
  fragile: boolean;
  source: "data-analytics-id" | "data-testid" | "id" | "css";
};

export type SelectorPrefer = "data-analytics-id" | "data-testid";

const DEFAULT_PREFER: SelectorPrefer[] = [
  "data-analytics-id",
  "data-testid",
];

type ElementSnapshot = {
  tagName: string;
  id?: string;
  attributes: Record<string, string>;
  role?: string;
  accessibleName?: string;
};

export function isDynamicLookingId(id: string): boolean {
  if (/^[a-f0-9-]{8,}$/i.test(id)) {
    return true;
  }
  if (/ember/i.test(id) || /react/i.test(id)) {
    return true;
  }
  if (/\d{5,}$/.test(id)) {
    return true;
  }
  return false;
}

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildShortCssPath(el: ElementSnapshot): string {
  const tag = el.tagName.toLowerCase();
  const type = el.attributes["type"];
  if (tag === "input" && type) {
    return `input[type="${escapeAttrValue(type)}"]`;
  }

  const classAttr = el.attributes["class"];
  if (classAttr) {
    const firstClass = classAttr.trim().split(/\s+/).find(Boolean);
    if (firstClass) {
      return `${tag}.${firstClass}`;
    }
  }

  return tag;
}

export function resolveSelector(
  el: ElementSnapshot,
  prefer: SelectorPrefer[] = DEFAULT_PREFER,
): ResolvedSelector {
  const attributeOrder =
    prefer.length > 0 ? prefer : DEFAULT_PREFER;

  for (const attr of attributeOrder) {
    const value = el.attributes[attr];
    if (value) {
      return {
        selector: `[${attr}="${escapeAttrValue(value)}"]`,
        fragile: false,
        source: attr,
      };
    }
  }

  if (el.id && !isDynamicLookingId(el.id)) {
    return {
      selector: `#${el.id}`,
      fragile: false,
      source: "id",
    };
  }

  return {
    selector: buildShortCssPath(el),
    fragile: true,
    source: "css",
  };
}
