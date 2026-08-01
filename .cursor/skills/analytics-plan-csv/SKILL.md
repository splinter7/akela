---
name: analytics-plan-csv
description: >-
  Converts free-form analytics/event tracking plans (docs, spreadsheets, notes)
  into Analytics Tracker canonical plan CSV. Use when a PM or non-technical user
  wants to create or fix a plan.csv, import a tracking plan, map events to
  journeys, or prepare CSV for validate/generate. Output path is flexible —
  write wherever the user asks or under the project's plansDir. Leaves selectors
  blank for developers when UI identifiers are unknown.
---

# Analytics Plan CSV

Help PMs and non-technical users turn a tracking plan into a **canonical plan CSV** that Analytics Tracker can `validate` and `generate` into a journey.

## Non-negotiable rules

1. **Do not block on selectors.** If the author does not know CSS/`data-testid`/element IDs, leave `selector` **empty**. Journey generate fills `#TODO-<event-slug>` for developers later.
2. **Do not invent fake selectors** (`#button`, `.cta`) unless the user explicitly provided them.
3. **Only emit known columns** the runner consumes (extra narrative columns are optional and ignored by validate). Prefer the canonical header row below.
4. After writing a file, remind them to run: `npm run track -- validate <path>` (and `generate` when ready).

## Canonical header (use this)

```csv
eventName,trigger,path,selector,value,properties,fields,notes
```

| Column | Required | PM guidance |
|--------|----------|-------------|
| `eventName` | yes | Exact analytics event name (snake_case as in the tracking plan) |
| `trigger` | yes | How the user causes it: `page_load`, `click`, `fill`, or `scroll` |
| `path` | if `page_load` | URL path like `/checkout` — ask if missing |
| `selector` | no | **Leave empty** unless they know a real selector (optional for `scroll` = page scroll) |
| `value` | if `fill` | Example text to type; ask or use a placeholder like `test@example.com` |
| `properties` | no | JSON object for **event payload** values to assert (page, element, counts) |
| `fields` | no | JSON object for values that may be on the event **or** in context (e.g. `service_id`) |
| `notes` | no | Human trigger description / intent (safe for PMs) |

CSV quoting: double quotes inside JSON must be doubled (`""`).

## Workflow

1. Read the user's plan (paste, CSV, sheet export, or file).
2. List each **distinct event + trigger** as one row (same event name can appear multiple times with different page/element/`fields`).
3. Infer `trigger`:
   - View/open/land on a screen → `page_load` (+ `path` if known; else ask once)
   - Tap/click/press CTA → `click` (selector empty if unknown)
   - Type into a field → `fill` (+ `value`; selector empty if unknown)
   - Scroll a list/page → `scroll` (selector empty = whole page; else scroll that element into view)
4. Split assertions:
   - Screen/UI dims usually on the event (`page`, `element`, counts) → `properties`
   - Entity IDs / shared dims often sent as analytics **context** (`service_id`, `market_id`, lists) → `fields` (also fine in `fields` if unsure; do not invent wire-format schemas)
5. Put prose (when it fires, priority, comments) in `notes` — not as fake columns the tool requires.
6. Write the CSV to the path the user asked for, or under the project's `plansDir` (default `plans/<short-name>.csv`). Do not invent a nested layout unless they request one.
7. Tell them: developers will fill `#TODO-*` selectors later; run `validate` next.

## Trigger mapping cheat sheet

| Plan language | trigger | selector |
|---------------|---------|----------|
| User views / opens / lands on … | `page_load` | empty |
| User clicks / taps … | `click` | empty unless known |
| User enters / types … | `fill` | empty unless known |
| User scrolls a list / page … | `scroll` | empty = page; set if a specific region |
| Hover / other | Skip or ask — not supported yet; note in chat |

## properties vs fields (keep it simple for PMs)

- **`properties`**: “This should be on the event itself” — e.g. `page`, `element`, `active_area_count`
- **`fields`**: “We need this value somewhere on the beacon” — e.g. `service_id` when it might be context
- If the plan mixes both in one blob, prefer: UI dims → `properties`; IDs/entities → `fields`
- Empty `properties`/`fields` is fine — event name alone is enough for a first pass

## Output checklist

- [ ] Header matches canonical columns
- [ ] Every row has `eventName` + valid `trigger`
- [ ] Every `page_load` has `path`
- [ ] Every `fill` has `value`
- [ ] `selector` empty when unknown (no invented IDs)
- [ ] JSON columns are objects with CSV-safe quoting
- [ ] User told that selectors are a **dev follow-up**, not a PM blocker

## Example (selectors deferred)

```csv
eventName,trigger,path,selector,value,properties,fields,notes
sponsored_placement_banner_shown,page_load,/service-details,,,"{""page"":""service_details"",""element"":""add_areas_upsell_banner""}","{""service_id"":179}",Banner visible on placement detail
sponsored_placement_interaction_clicked,click,,,,,"{""page"":""service_details"",""element"":""add_areas""}","{""service_id"":179}",Pro clicks Add areas CTA
```

