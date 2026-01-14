import { prisma } from "../lib/prisma";
import { ApiError } from "../middleware/errorHandler";

type CreateTripInput = {
  userId: string;
  title: string;
};

type RenameTripInput = {
  userId: string;
  tripId: string;
  title: string;
};

const MAX_RAW_TEXT_CHARS = 80_000;

type RawTextTruncation = {
  wasTruncated: boolean;
  originalChars: number;
  keptChars: number;
  omittedChars: number;
};

type TripSummary = {
  id: string;
  title: string;
  status: string;
  updatedAt: Date;
  latestRunAt: Date | null;
  latestRunStatus: string | null;
};

function applyRawTextCap(rawText: string): {
  cappedText: string;
  truncation: RawTextTruncation | null;
} {
  if (rawText.length <= MAX_RAW_TEXT_CHARS) {
    return { cappedText: rawText, truncation: null };
  }

  const omittedChars = rawText.length - MAX_RAW_TEXT_CHARS;
  const notice = `[TRUNCATED ${omittedChars} chars]\n\n`;
  const keepChars = Math.max(0, MAX_RAW_TEXT_CHARS - notice.length);
  const tail = rawText.slice(rawText.length - keepChars);
  const cappedText = notice + tail;

  return {
    cappedText,
    truncation: {
      wasTruncated: true,
      originalChars: rawText.length,
      keptChars: cappedText.length,
      omittedChars,
    },
  };
}

export const tripService = {
  async createTrip(input: CreateTripInput) {
    return prisma.trip.create({
      data: {
        userId: input.userId,
        title: input.title,
      },
    });
  },

  async listTrips(userId: string): Promise<TripSummary[]> {
    const trips = await prisma.trip.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        runs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true, status: true },
        },
      },
    });

    return trips.map((trip) => {
      const latestRun = trip.runs[0] ?? null;
      return {
        id: trip.id,
        title: trip.title,
        status: trip.status,
        updatedAt: trip.updatedAt,
        latestRunAt: latestRun?.createdAt ?? null,
        latestRunStatus: latestRun?.status ?? null,
      };
    });
  },

  async getTripOrThrow(userId: string, tripId: string) {
    const trip = await prisma.trip.findFirst({
      where: { id: tripId, userId },
    });
    if (!trip) throw new ApiError("Trip not found", 404);
    return trip;
  },

  async appendTripSource(userId: string, tripId: string, rawText: string) {
    const trip = await tripService.getTripOrThrow(userId, tripId);
    const trimmed = rawText.trim();

    const latestSuccess = await prisma.reconstructRun.findFirst({
      where: { tripId, userId, status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      select: { rawText: true },
    });

    const latestAny = latestSuccess
      ? null
      : await prisma.reconstructRun.findFirst({
          where: { tripId, userId },
          orderBy: { createdAt: "desc" },
          select: { rawText: true },
        });

    const previousRawText =
      latestSuccess?.rawText ?? latestAny?.rawText ?? "";

    const combinedRawText = trimmed
      ? previousRawText
        ? `${previousRawText}\n\n--- NEW INFO ---\n\n${trimmed}`
        : trimmed
      : previousRawText;

    const { cappedText, truncation } = applyRawTextCap(combinedRawText);

    return { trip, combinedRawText: cappedText, truncation };
  },

  async getTripDetail(userId: string, tripId: string) {
    const trip = await tripService.getTripOrThrow(userId, tripId);

    let latestRun = await prisma.reconstructRun.findFirst({
      where: { tripId, status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        createdAt: true,
        outputJson: true,
      },
    });

    const output = latestRun?.outputJson as { type?: string } | null;
    if (output?.type === "PATCH") {
      latestRun = await prisma.reconstructRun.findFirst({
        where: {
          tripId,
          status: "SUCCESS",
          NOT: {
            outputJson: {
              path: ["type"],
              equals: "PATCH",
            },
          },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          createdAt: true,
          outputJson: true,
        },
      });
    }

    const runs = await prisma.reconstructRun.findMany({
      where: { tripId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        createdAt: true,
        errorCode: true,
        errorMessage: true,
      },
    });

    const tripItems = await prisma.tripItem.findMany({
      where: { tripId },
      orderBy: [{ startIso: "asc" }, { startLocalDate: "asc" }],
      select: {
        id: true,
        kind: true,
        title: true,
        startIso: true,
        endIso: true,
        timezone: true,
        startTimezone: true,
        endTimezone: true,
        startLocalDate: true,
        startLocalTime: true,
        endLocalDate: true,
        endLocalTime: true,
        locationText: true,
        isInferred: true,
        confidence: true,
        sourceSnippet: true,
        state: true,
        source: true,
        fingerprint: true,
        metadata: true,
        updatedAt: true,
      },
    });

    return { trip, latestRun, runs, tripItems };
  },

  async getTripItems(userId: string, tripId: string) {
    await tripService.getTripOrThrow(userId, tripId);
    return prisma.tripItem.findMany({
      where: { tripId },
      orderBy: [{ startIso: "asc" }, { startLocalDate: "asc" }],
      select: {
        id: true,
        kind: true,
        title: true,
        startIso: true,
        endIso: true,
        timezone: true,
        startTimezone: true,
        endTimezone: true,
        startLocalDate: true,
        startLocalTime: true,
        endLocalDate: true,
        endLocalTime: true,
        locationText: true,
        isInferred: true,
        confidence: true,
        sourceSnippet: true,
        state: true,
        source: true,
        fingerprint: true,
        metadata: true,
        updatedAt: true,
      },
    });
  },

  async renameTrip(input: RenameTripInput) {
    await tripService.getTripOrThrow(input.userId, input.tripId);

    return prisma.trip.update({
      where: { id: input.tripId },
      data: { title: input.title },
    });
  },
};
