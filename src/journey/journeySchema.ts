import { z } from "zod";

const jsonObject = z.record(z.string(), z.unknown());

const expectedEventSchema = z.object({
  eventName: z.string().min(1),
  properties: jsonObject.optional(),
  fields: jsonObject.optional(),
});

const verifyOptionsSchema = z
  .object({
    ordered: z.boolean().optional(),
    match: z.enum(["partial", "exact"]).optional(),
    forbidExtra: z.boolean().optional(),
  })
  .optional();

const gotoWaitUntilSchema = z.enum(["load", "domcontentloaded", "networkidle", "commit"]);

const whenSchema = z
  .object({
    visible: z.string().min(1),
  })
  .optional();

const stepSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("goto"),
    path: z.string().min(1),
    when: whenSchema,
  }),
  z.object({
    action: z.literal("click"),
    selector: z.string().min(1),
    timeoutMs: z.number().nonnegative().optional(),
    retries: z.number().int().nonnegative().optional(),
    when: whenSchema,
  }),
  z.object({
    action: z.literal("fill"),
    selector: z.string().min(1),
    value: z.string(),
    timeoutMs: z.number().nonnegative().optional(),
    retries: z.number().int().nonnegative().optional(),
    when: whenSchema,
  }),
  z.object({
    action: z.literal("wait"),
    timeoutMs: z.number().nonnegative(),
    when: whenSchema,
  }),
  z.object({
    action: z.literal("waitForEvent"),
    eventName: z.string().min(1),
    timeoutMs: z.number().nonnegative().optional(),
    properties: jsonObject.optional(),
    fields: jsonObject.optional(),
    when: whenSchema,
  }),
  z.object({
    action: z.literal("waitForSelector"),
    selector: z.string().min(1),
    timeoutMs: z.number().nonnegative().optional(),
    state: z.enum(["attached", "detached", "visible", "hidden"]).optional(),
    when: whenSchema,
  }),
  z.object({
    action: z.literal("waitForURL"),
    url: z.string().min(1),
    timeoutMs: z.number().nonnegative().optional(),
    when: whenSchema,
  }),
  z.object({
    action: z.literal("scroll"),
    selector: z.string().min(1).optional(),
    timeoutMs: z.number().nonnegative().optional(),
    when: whenSchema,
  }),
  z.object({
    action: z.literal("waitForAny"),
    selectors: z.array(z.string().min(1)).min(2),
    timeoutMs: z.number().nonnegative().optional(),
    when: whenSchema,
  }),
  z.object({
    action: z.literal("waitForHydrated"),
    selector: z.string().min(1),
    timeoutMs: z.number().nonnegative().optional(),
    when: whenSchema,
  }),
  z.object({
    action: z.literal("saveStorageState"),
    path: z.string().min(1),
    when: whenSchema,
  }),
]);

export const journeySchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().min(1).optional(),
  options: verifyOptionsSchema,
  adapters: z.array(z.string().min(1)).min(1),
  steps: z.array(stepSchema).min(1),
  // Empty expect always "passes" verification — require at least one assertion.
  expect: z.array(expectedEventSchema).min(1),
  storageState: z.string().min(1).optional(),
  gotoWaitUntil: gotoWaitUntilSchema.optional(),
});

export const authJourneySchema = journeySchema
  .omit({ expect: true })
  .extend({
    expect: z.array(expectedEventSchema).default([]),
  })
  .superRefine((journey, ctx) => {
    const hasSave = journey.steps.some((s) => s.action === "saveStorageState");
    if (!hasSave) {
      ctx.addIssue({
        code: "custom",
        message: "auth journey requires at least one saveStorageState step",
        path: ["steps"],
      });
    }
  });

export type JourneySchema = z.infer<typeof journeySchema>;

export function formatZodJourneyErrors(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("\n");
}
