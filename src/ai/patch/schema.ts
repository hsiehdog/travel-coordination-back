import { z } from "zod";

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Hm = z.string().regex(/^\d{2}:\d{2}$/);

const PatchDateTimeFieldSchema = z
  .object({
    localDate: Ymd.optional(),
    localTime: Hm.optional(),
    timezone: z.string().min(1).optional(),
    iso: z.string().min(1).max(40).optional(),
  })
  .strict();

const TargetHintsSchema = z
  .object({
    kind: z
      .enum([
        "FLIGHT",
        "LODGING",
        "MEETING",
        "MEAL",
        "TRANSPORT",
        "ACTIVITY",
        "NOTE",
        "OTHER",
      ])
      .optional(),
    localDate: Ymd.optional(),
    localTime: Hm.optional(),
    titleKeywords: z.array(z.string().min(1).max(40)).max(6).optional(),
    locationKeywords: z.array(z.string().min(1).max(40)).max(6).optional(),
  })
  .strict();

const ItemUpdateSchema = z
  .object({
    title: z.string().min(1).max(140).optional(),
    locationText: z.string().max(300).optional(),
    start: PatchDateTimeFieldSchema.optional(),
    end: PatchDateTimeFieldSchema.optional(),
    kind: z
      .enum([
        "FLIGHT",
        "LODGING",
        "MEETING",
        "MEAL",
        "TRANSPORT",
        "ACTIVITY",
        "NOTE",
        "OTHER",
      ])
      .optional(),
  })
  .strict();

const CreateItemSchema = z
  .object({
    kind: z.enum([
      "FLIGHT",
      "LODGING",
      "MEETING",
      "MEAL",
      "TRANSPORT",
      "ACTIVITY",
      "NOTE",
      "OTHER",
    ]),
    title: z.string().min(1).max(140),
    start: PatchDateTimeFieldSchema.optional(),
    end: PatchDateTimeFieldSchema.optional(),
    locationText: z.string().max(300).optional(),
  })
  .strict();

export const PatchOpSchema = z
  .object({
    opType: z.enum([
      "CREATE_ITEM",
      "UPDATE_ITEM",
      "CANCEL_ITEM",
      "DISMISS_ITEM",
      "REPLACE_ITEM",
      "NEED_CLARIFICATION",
    ]),
    targetHints: TargetHintsSchema.optional(),
    updates: ItemUpdateSchema.optional(),
    replacement: CreateItemSchema.optional(),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(200),
  })
  .strict();

export const PatchIntentSchema = z
  .object({
    ops: z.array(PatchOpSchema).min(1).max(6),
  })
  .strict();

export type PatchIntent = z.infer<typeof PatchIntentSchema>;
export type PatchOp = z.infer<typeof PatchOpSchema>;
export type PatchTargetHints = z.infer<typeof TargetHintsSchema>;
export type PatchItemUpdate = z.infer<typeof ItemUpdateSchema>;
export type PatchCreateItem = z.infer<typeof CreateItemSchema>;
