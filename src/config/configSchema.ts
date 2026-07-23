import { z } from "zod";

const gotoWaitUntilSchema = z.enum([
  "load",
  "domcontentloaded",
  "networkidle",
  "commit",
]);

export const appConfigSchema = z
  .object({
    baseUrl: z.string().min(1).optional(),
    headless: z.boolean().optional(),
    reportDir: z.string().min(1).optional(),
    storageState: z.string().min(1).optional(),
    gotoWaitUntil: gotoWaitUntilSchema.optional(),
    quietMs: z.number().nonnegative().optional(),
    quietTimeoutMs: z.number().nonnegative().optional(),
    snowplow: z
      .object({
        collectorPatterns: z.array(z.string().min(1)).optional(),
      })
      .optional(),
  })
  .superRefine((cfg, ctx) => {
    if (
      cfg.quietMs !== undefined &&
      cfg.quietTimeoutMs !== undefined &&
      cfg.quietTimeoutMs < cfg.quietMs
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["quietTimeoutMs"],
        message: "quietTimeoutMs must be >= quietMs",
      });
    }
  });

export type AppConfigSchema = z.infer<typeof appConfigSchema>;

export function formatZodConfigErrors(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("\n");
}
