import type { CapturedRequest, NormalizedEvent } from "../normalize/types.js";
import type { AnalyticsAdapter } from "./types.js";

export type ParseRequestResult = {
  events: NormalizedEvent[];
  warnings: string[];
};

export class AdapterRegistry {
  private adapters = new Map<string, AnalyticsAdapter>();

  register(adapter: AnalyticsAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  get(name: string): AnalyticsAdapter | undefined {
    return this.adapters.get(name);
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }

  /**
   * Fail fast if any journey adapter name is not registered.
   * Call before launching the browser so misconfig never hits the route handler.
   */
  assertKnown(adapterNames: string[]): void {
    for (const name of adapterNames) {
      if (!this.adapters.has(name)) {
        throw new Error(
          `Unknown adapter: ${name}. Registered: ${this.list().join(", ") || "(none)"}`,
        );
      }
    }
  }

  /**
   * Parse a request using adapters selected for the journey.
   * Uses the first matching adapter among the selected names.
   */
  parseRequest(request: CapturedRequest, adapterNames: string[]): ParseRequestResult {
    for (const name of adapterNames) {
      const adapter = this.adapters.get(name);
      if (!adapter) {
        throw new Error(`Unknown adapter: ${name}. Registered: ${this.list().join(", ") || "(none)"}`);
      }
      if (adapter.matches(request)) {
        try {
          const events = adapter.parse(request);
          const warnings: string[] = [];
          if (events.length === 0 && (request.postData == null || request.postData === "")) {
            warnings.push(
              `[adapter:${name}] matched ${request.method} ${request.url} but parse returned no events (empty/missing postData)`,
            );
          }
          return { events, warnings };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            events: [],
            warnings: [
              `[adapter:${name}] failed to parse ${request.method} ${request.url}: ${message}`,
            ],
          };
        }
      }
    }
    return { events: [], warnings: [] };
  }
}
