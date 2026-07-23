import type { Page, Request } from "playwright";
import type { CapturedRequest, NormalizedEvent, ProgressFn } from "../normalize/types.js";
import type { AdapterRegistry } from "../adapters/registry.js";

/**
 * Captures analytics network calls during a journey.
 *
 * Uses `page.route` (not `page.on("request")`) so `sendBeacon` / ping bodies
 * are available via `request.postData()`. Playwright's request event often
 * omits post data for resourceType "ping".
 */
export class NetworkCapture {
  private events: NormalizedEvent[] = [];
  private warnings: string[] = [];
  private adapterNames: string[];
  private registry: AdapterRegistry;
  private attached = false;
  private onProgress?: ProgressFn;

  constructor(
    registry: AdapterRegistry,
    adapterNames: string[],
    options?: { onProgress?: ProgressFn },
  ) {
    this.registry = registry;
    this.adapterNames = adapterNames;
    this.onProgress = options?.onProgress;
  }

  async attach(page: Page): Promise<void> {
    if (this.attached) return;
    this.attached = true;

    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        this.captureRequest(request);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.warnings.push(`[NetworkCapture] failed to capture request: ${message}`);
        this.onProgress?.(`  capture warning: ${message}`);
      } finally {
        await route.continue().catch(() => {
          // Request may already be aborted/fulfilled; ignore.
        });
      }
    });
  }

  private captureRequest(request: Request): void {
    const captured: CapturedRequest = {
      url: request.url(),
      method: request.method(),
      postData: request.postData() ?? undefined,
      headers: request.headers(),
      timestamp: Date.now(),
    };
    const { events, warnings } = this.registry.parseRequest(captured, this.adapterNames);
    for (const w of warnings) {
      this.warnings.push(w);
      this.onProgress?.(`  capture warning: ${w}`);
    }
    if (events.length > 0) {
      this.events.push(...events);
      for (const event of events) {
        this.onProgress?.(`  captured event: ${event.eventName}`);
      }
    }
  }

  getEvents(): NormalizedEvent[] {
    return [...this.events];
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }

  clear(): void {
    this.events = [];
    this.warnings = [];
  }
}
