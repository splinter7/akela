import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../config/loadConfig.js";

export function cmdInit(cwd: string): void {
  const config = loadConfig(cwd);
  const plansDirRel = config.plansDir ?? "plans";
  const journeysDirRel = config.journeysDir ?? "journeys";
  const plansDir = resolve(cwd, plansDirRel);
  const journeysDir = resolve(cwd, journeysDirRel);
  mkdirSync(plansDir, { recursive: true });
  mkdirSync(journeysDir, { recursive: true });

  const configPath = join(cwd, "akela.config.yaml");
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      `# Default config for Akela
baseUrl: http://127.0.0.1:4173
headless: true
reportDir: reports
plansDir: plans
journeysDir: journeys
snowplow:
  collectorPatterns:
    - "/i"
    - "/com.snowplowanalytics.snowplow/tp2"
    - "/snowplow/"
`,
      "utf8",
    );
    console.log(`Created ${configPath}`);
  } else {
    console.log(`Config already exists: ${configPath}`);
  }

  const examplePath = join(journeysDir, "example.yaml");
  if (!existsSync(examplePath)) {
    writeFileSync(
      examplePath,
      `name: example
baseUrl: http://127.0.0.1:4173
options:
  ordered: false
  match: partial
  forbidExtra: false
adapters:
  - snowplow
steps:
  - action: goto
    path: /
  - action: click
    selector: "#track-page-view"
  - action: waitForEvent
    eventName: page_view
    timeoutMs: 5000
expect:
  - eventName: page_view
    properties:
      page: home
`,
      "utf8",
    );
    console.log(`Created ${examplePath}`);
  } else {
    console.log(`Example journey already exists: ${examplePath}`);
  }

  const loginExamplePath = join(journeysDir, "login.example.yaml");
  if (!existsSync(loginExamplePath)) {
    writeFileSync(
      loginExamplePath,
      `# Example auth journey — copy and fill real selectors for your site.
# Usage:
#   npm run track -- auth ${journeysDirRel}/login.example.yaml \\
#     --var AUTH_EMAIL=you@example.com \\
#     --var AUTH_PASSWORD=secret
# Then point tracking journeys at the written storageState path.

name: login-example
baseUrl: https://staging.example.com
adapters:
  - snowplow
expect: []
steps:
  - action: goto
    path: /login
  - action: fill
    selector: "#TODO-email"
    value: "\${AUTH_EMAIL}"
  - action: fill
    selector: "#TODO-password"
    value: "\${AUTH_PASSWORD}"
  - action: click
    selector: "#TODO-login-submit"
  - action: waitForSelector
    selector: "#TODO-logged-in-marker"
  - action: saveStorageState
    path: .auth/storage-state.json
`,
      "utf8",
    );
    console.log(`Created ${loginExamplePath}`);
  } else {
    console.log(`Login example already exists: ${loginExamplePath}`);
  }

  console.log("\nNext: npm run demo  (in another terminal)");
  console.log(`Then:  npm run track -- run ${journeysDirRel}/example.yaml`);
}
