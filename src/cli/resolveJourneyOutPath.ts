import { join } from "node:path";

/** Prefer explicit --out; otherwise {journeysDir}/{name}.yaml. */
export function resolveJourneyOutPath(
  outPath: string | undefined,
  name: string,
  journeysDir: string,
): string {
  return outPath ?? join(journeysDir, `${name}.yaml`);
}
