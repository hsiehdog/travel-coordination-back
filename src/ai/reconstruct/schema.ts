import { z } from "zod";

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Hm = z.string().regex(/^\d{2}:\d{2}$/);

export const DateTimeFieldSchema = z.object({
  localDate: Ymd.nullable(),
  localTime: Hm.nullable(),
  timezone: z.string().min(1).nullable(),
  iso: z.string().min(1).max(40).nullable(),
});

export const ItineraryItemSchema = z.object({
  id: z.string().min(5).max(40),
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
  start: DateTimeFieldSchema,
  end: DateTimeFieldSchema,
  locationText: z.string().max(300).nullable(),
  isInferred: z.boolean(),
  confidence: z.number().min(0).max(1),
  sourceSnippet: z.string().max(180).nullable(),
  flight: z
    .object({
      airlineName: z.string().max(80).nullable(),
      airlineCode: z.string().max(10).nullable(),
      flightNumber: z.string().max(12).nullable(),
      origin: z.string().max(12).nullable(),
      destination: z.string().max(12).nullable(),
      pnr: z.string().max(20).nullable(),
    })
    .nullable()
    .optional(),
  lodging: z
    .object({
      name: z.string().max(120).nullable(),
      address: z.string().max(180).nullable(),
      checkIn: DateTimeFieldSchema.nullable(),
      checkOut: DateTimeFieldSchema.nullable(),
      confirmationNumber: z.string().max(40).nullable(),
    })
    .nullable()
    .optional(),
  meeting: z
    .object({
      organizer: z.string().max(120).nullable(),
      attendees: z.array(z.string().max(120)).max(20).nullable(),
      videoLink: z.string().max(260).nullable(),
      locationName: z.string().max(140).nullable(),
    })
    .nullable()
    .optional(),
  meal: z
    .object({
      venue: z.string().max(140).nullable(),
      mealType: z
        .enum(["BREAKFAST", "LUNCH", "DINNER", "DRINKS", "OTHER"])
        .nullable(),
      reservationName: z.string().max(120).nullable(),
      confirmationNumber: z.string().max(40).nullable(),
    })
    .nullable()
    .optional(),
});

export const TripDaySchema = z.object({
  dayIndex: z.number().int().min(1).max(30),
  label: z.string().min(1).max(40),
  localDate: Ymd.nullable(),
  items: z.array(ItineraryItemSchema),
});

export const RiskFlagSchema = z.object({
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  title: z.string().min(1).max(80),
  message: z.string().min(1).max(260),
  itemIds: z.array(z.string()),
});

export const AssumptionSchema = z.object({
  message: z.string().min(1).max(500),
  relatedItemIds: z.array(z.string()),
});

export const MissingInfoSchema = z.object({
  prompt: z.string().min(1).max(300),
  relatedItemIds: z.array(z.string()),
});

export const TripReconstructionSchema = z.object({
  tripTitle: z.string().min(1).max(80),
  executiveSummary: z.string().min(1).max(300),
  destinationSummary: z.string().min(1).max(120),
  dateRange: z.object({
    startLocalDate: Ymd.nullable(),
    endLocalDate: Ymd.nullable(),
    timezone: z.string().min(1),
  }),
  days: z.array(TripDaySchema).min(1),
  risks: z.array(RiskFlagSchema),
  assumptions: z.array(AssumptionSchema),
  missingInfo: z.array(MissingInfoSchema),
  sourceStats: z.object({
    inputCharCount: z.number().int().min(0),
    recognizedItemCount: z.number().int().min(0),
    inferredItemCount: z.number().int().min(0),
  }),
});

export type TripReconstruction = z.infer<typeof TripReconstructionSchema>;
