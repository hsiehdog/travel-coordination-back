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

type TripSummary = {
  id: string;
  title: string;
  status: string;
  updatedAt: Date;
  latestRunAt: Date | null;
  latestRunStatus: string | null;
};

export const tripService = {
  async createTrip(input: CreateTripInput) {
    return prisma.trip.create({
      data: {
        userId: input.userId,
        title: input.title,
        sourceText: "",
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
    if (!trimmed) return trip;

    const combined = trip.sourceText
      ? `${trip.sourceText}\n\n---\n\n${trimmed}`
      : trimmed;

    return prisma.trip.update({
      where: { id: tripId },
      data: { sourceText: combined },
    });
  },

  async getTripDetail(userId: string, tripId: string) {
    const trip = await tripService.getTripOrThrow(userId, tripId);

    const latestRun = await prisma.reconstructRun.findFirst({
      where: { tripId, status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        createdAt: true,
        outputJson: true,
      },
    });

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

    return { trip, latestRun, runs };
  },

  async renameTrip(input: RenameTripInput) {
    await tripService.getTripOrThrow(input.userId, input.tripId);

    return prisma.trip.update({
      where: { id: input.tripId },
      data: { title: input.title },
    });
  },
};
