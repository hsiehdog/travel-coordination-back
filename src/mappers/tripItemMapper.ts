import { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import type { TripReconstruction } from "../ai/reconstruct/schema";

type BuildTripItemDraftsArgs = {
  tripId: string;
  reconstruction: TripReconstruction;
  runId?: string | null;
};

export type TripItemDraft = {
  tripId: string;
  fingerprint: string;
  kind: Prisma.TripItemCreateInput["kind"];
  title: string;
  startIso: string | null;
  endIso: string | null;
  timezone: string | null;
  startTimezone: string | null;
  endTimezone: string | null;
  startLocalDate: string | null;
  startLocalTime: string | null;
  endLocalDate: string | null;
  endLocalTime: string | null;
  locationText: string | null;
  isInferred: boolean;
  confidence: number;
  sourceSnippet: string | null;
  metadata: Prisma.InputJsonValue | null;
  aiDetails: Record<string, unknown> | null;
};

function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function parseDateParts(value: string | null): [number, number, number] | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function parseTimeParts(value: string | null): [number, number] | null {
  if (!value) return null;
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function getTimeZoneOffsetMinutes(timeZone: string, date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const values: Record<string, number> = {};
  parts.forEach((part) => {
    if (part.type === "literal") return;
    values[part.type] = Number(part.value);
  });

  const year = values.year;
  const month = values.month;
  const day = values.day;
  const hour = values.hour;
  const minute = values.minute;
  const second = values.second;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return 0;
  }

  const asUtc = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second
  );
  return (asUtc - date.getTime()) / 60000;
}

function toIsoFromLocal(args: {
  localDate: string | null;
  localTime: string | null;
  timezone: string | null;
}): string | null {
  const dateParts = parseDateParts(args.localDate);
  const timeParts = parseTimeParts(args.localTime);
  if (!dateParts || !timeParts || !args.timezone) return null;

  const [year, month, day] = dateParts;
  const [hour, minute] = timeParts;
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(args.timezone, utcDate);
  const adjusted = new Date(utcDate.getTime() - offsetMinutes * 60000);
  return adjusted.toISOString();
}

function buildItemFingerprint(input: {
  kind: string;
  title: string;
  startIso: string | null;
  startLocalDate: string | null;
  startLocalTime: string | null;
  locationText: string | null;
}): string {
  const raw = [
    input.kind,
    normalizeText(input.title),
    input.startIso ?? "",
    input.startLocalDate ?? "",
    input.startLocalTime ?? "",
    normalizeText(input.locationText),
  ].join("|");

  return createHash("sha256").update(raw).digest("hex");
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildAiDetails(
  item: TripReconstruction["days"][number]["items"][number]
) {
  if (item.kind === "FLIGHT" && item.flight) {
    const flight = {
      airlineName: normalizeOptional(item.flight.airlineName),
      airlineCode: normalizeOptional(item.flight.airlineCode),
      flightNumber: normalizeOptional(item.flight.flightNumber),
      origin: normalizeOptional(item.flight.origin),
      destination: normalizeOptional(item.flight.destination),
      pnr: normalizeOptional(item.flight.pnr),
    };
    const hasAny = Object.values(flight).some(Boolean);
    return hasAny ? { flight } : null;
  }

  if (item.kind === "LODGING" && item.lodging) {
    const lodging = {
      name: normalizeOptional(item.lodging.name),
      address: normalizeOptional(item.lodging.address),
      checkIn: item.lodging.checkIn ?? null,
      checkOut: item.lodging.checkOut ?? null,
      confirmationNumber: normalizeOptional(item.lodging.confirmationNumber),
    };
    const hasAny = Object.values(lodging).some(Boolean);
    return hasAny ? { lodging } : null;
  }

  if (item.kind === "MEETING" && item.meeting) {
    const meeting = {
      organizer: normalizeOptional(item.meeting.organizer),
      attendees: item.meeting.attendees ?? null,
      videoLink: normalizeOptional(item.meeting.videoLink),
      locationName: normalizeOptional(item.meeting.locationName),
    };
    const hasAny = Object.values(meeting).some(Boolean);
    return hasAny ? { meeting } : null;
  }

  if (item.kind === "MEAL" && item.meal) {
    const meal = {
      venue: normalizeOptional(item.meal.venue),
      mealType: item.meal.mealType ?? null,
      reservationName: normalizeOptional(item.meal.reservationName),
      confirmationNumber: normalizeOptional(item.meal.confirmationNumber),
    };
    const hasAny = Object.values(meal).some(Boolean);
    return hasAny ? { meal } : null;
  }

  return null;
}

export function buildTripItemDrafts(
  args: BuildTripItemDraftsArgs
): TripItemDraft[] {
  const { tripId, reconstruction, runId } = args;
  const items: TripItemDraft[] = [];

  reconstruction.days.forEach((day) => {
    day.items.forEach((item) => {
      const startLocalDate = item.start.localDate ?? null;
      const startLocalTime = item.start.localTime ?? null;
      const endLocalDate = item.end.localDate ?? null;
      const endLocalTime = item.end.localTime ?? null;
      const locationText = item.locationText ?? null;
      const startTimezone = item.start.timezone ?? null;
      const endTimezone = item.end.timezone ?? null;
      const timezone = startTimezone ?? endTimezone ?? null;
      const startIso = toIsoFromLocal({
        localDate: startLocalDate,
        localTime: startLocalTime,
        timezone: startTimezone ?? timezone,
      });
      const endIso = toIsoFromLocal({
        localDate: endLocalDate,
        localTime: endLocalTime,
        timezone: endTimezone ?? timezone,
      });
      const fingerprint = buildItemFingerprint({
        kind: item.kind,
        title: item.title,
        startIso,
        startLocalDate,
        startLocalTime,
        locationText,
      });
      const aiDetails = buildAiDetails(item);

      items.push({
        tripId,
        fingerprint,
        kind: item.kind,
        title: item.title,
        startIso,
        endIso,
        timezone,
        startTimezone,
        endTimezone,
        startLocalDate,
        startLocalTime,
        endLocalDate,
        endLocalTime,
        locationText,
        isInferred: item.isInferred,
        confidence: item.confidence,
        sourceSnippet: item.sourceSnippet ?? null,
        metadata: runId
          ? {
              sourceRunId: runId,
              lastUpdatedByRunId: runId,
              ...(aiDetails ? { ai: aiDetails } : {}),
            }
          : aiDetails
          ? { ai: aiDetails }
          : null,
        aiDetails,
      });
    });
  });

  return items;
}
