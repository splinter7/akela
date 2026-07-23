export type { PlanRow, PlanTrigger } from "./validatePlanCsv.js";

import {
  formatPlanValidationErrors,
  validatePlanCsv,
  type PlanRow,
} from "./validatePlanCsv.js";

/**
 * Parse a canonical plan CSV, throwing if invalid.
 * Prefer {@link validatePlanCsv} when you need structured errors.
 */
export function parsePlanCsv(csvText: string): PlanRow[] {
  const result = validatePlanCsv(csvText);
  if (!result.ok) {
    throw new Error(formatPlanValidationErrors(result.errors));
  }
  return result.rows;
}
