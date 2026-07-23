import type { CapturedRequest, NormalizedEvent } from "../normalize/types.js";

export interface AnalyticsAdapter {
  name: string;
  matches(request: CapturedRequest): boolean;
  parse(request: CapturedRequest): NormalizedEvent[];
}
