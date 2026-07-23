import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadJourney } from "../../src/journey/loadJourney.js";

describe("loadJourney schema", () => {
  const dir = join(tmpdir(), `at-journey-${Date.now()}`);

  function writeJourney(name: string, contents: string): string {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, contents, "utf8");
    return path;
  }

  it("accepts valid journey with new steps and auth fields", () => {
    const path = writeJourney(
      "ok.yaml",
      `name: ok
storageState: .auth/state.json
gotoWaitUntil: networkidle
adapters:
  - snowplow
steps:
  - action: goto
    path: /
  - action: waitForSelector
    selector: "#main"
  - action: waitForURL
    url: "**/home**"
  - action: scroll
    selector: "#list"
  - action: scroll
expect:
  - eventName: page_view
`,
    );
    const journey = loadJourney(path);
    expect(journey.name).toBe("ok");
    expect(journey.storageState).toBe(".auth/state.json");
    expect(journey.gotoWaitUntil).toBe("networkidle");
    expect(journey.steps).toHaveLength(5);
  });

  it("rejects click without selector", () => {
    const path = writeJourney(
      "bad.yaml",
      `name: bad
adapters:
  - snowplow
steps:
  - action: click
expect:
  - eventName: page_view
`,
    );
    expect(() => loadJourney(path)).toThrow(/selector/i);
  });

  it("rejects unknown step action", () => {
    const path = writeJourney(
      "unknown.yaml",
      `name: bad
adapters:
  - snowplow
steps:
  - action: hover
    selector: "#x"
expect:
  - eventName: page_view
`,
    );
    expect(() => loadJourney(path)).toThrow(/Invalid journey/i);
  });

  it("rejects empty adapters", () => {
    const path = writeJourney(
      "no-adapters.yaml",
      `name: bad
adapters: []
steps:
  - action: goto
    path: /
expect:
  - eventName: page_view
`,
    );
    expect(() => loadJourney(path)).toThrow(/adapters/i);
  });

  it("rejects empty expect (prevents vacuous PASS)", () => {
    const path = writeJourney(
      "no-expect.yaml",
      `name: bad
adapters:
  - snowplow
steps:
  - action: goto
    path: /
expect: []
`,
    );
    expect(() => loadJourney(path)).toThrow(/expect/i);
  });

  it("accepts waitForAny and when.visible branching", () => {
    const path = writeJourney(
      "branch.yaml",
      `name: branch
adapters:
  - snowplow
steps:
  - action: waitForAny
    selectors:
      - "#a"
      - "#b"
    timeoutMs: 10000
  - action: click
    selector: "#a-btn"
    when:
      visible: "#a"
expect:
  - eventName: page_view
`,
    );
    const journey = loadJourney(path);
    expect(journey.steps).toHaveLength(2);
    expect(journey.steps[0]).toMatchObject({
      action: "waitForAny",
      selectors: ["#a", "#b"],
      timeoutMs: 10000,
    });
    expect(journey.steps[1]).toMatchObject({
      action: "click",
      selector: "#a-btn",
      when: { visible: "#a" },
    });
  });

  it("rejects waitForAny with fewer than 2 selectors", () => {
    const path = writeJourney(
      "wait-any-one.yaml",
      `name: bad
adapters:
  - snowplow
steps:
  - action: waitForAny
    selectors:
      - "#only"
expect:
  - eventName: page_view
`,
    );
    expect(() => loadJourney(path)).toThrow(/Invalid journey/i);
  });

  it("substitutes vars before parse; unquoted values become numbers", () => {
    const path = writeJourney(
      "templated.yaml",
      `name: templated
adapters:
  - snowplow
steps:
  - action: goto
    path: /items/\${service_id}/details
expect:
  - eventName: page_view
    fields:
      service_id: \${service_id}
`,
    );
    const journey = loadJourney(path, dir, { service_id: "450" });
    expect(journey.steps[0]).toMatchObject({
      action: "goto",
      path: "/items/450/details",
    });
    expect(journey.expect[0]!.fields).toEqual({ service_id: 450 });
  });

  it("fails when a placeholder is missing a --var", () => {
    const path = writeJourney(
      "missing-var.yaml",
      `name: missing
adapters:
  - snowplow
steps:
  - action: goto
    path: /\${id}
expect:
  - eventName: page_view
`,
    );
    expect(() => loadJourney(path, dir, {})).toThrow(
      /Unresolved journey variables: id/,
    );
  });

  it("run mode rejects empty expect", () => {
    const path = writeJourney(
      "empty-expect.yaml",
      `name: bad
adapters:
  - snowplow
steps:
  - action: goto
    path: /
expect: []
`,
    );
    expect(() => loadJourney(path)).toThrow(/expect/i);
  });

  it("auth mode accepts empty expect with saveStorageState", () => {
    const path = writeJourney(
      "auth-ok.yaml",
      `name: login
adapters:
  - snowplow
expect: []
steps:
  - action: goto
    path: /login
  - action: saveStorageState
    path: .auth/storage-state.json
`,
    );
    const journey = loadJourney(path, dir, {}, { mode: "auth" });
    expect(journey.expect).toEqual([]);
    expect(journey.steps.some((s) => s.action === "saveStorageState")).toBe(true);
  });

  it("auth mode rejects journey without saveStorageState", () => {
    const path = writeJourney(
      "auth-no-save.yaml",
      `name: login
adapters:
  - snowplow
expect: []
steps:
  - action: goto
    path: /login
`,
    );
    expect(() => loadJourney(path, dir, {}, { mode: "auth" })).toThrow(
      /saveStorageState/i,
    );
  });
});
