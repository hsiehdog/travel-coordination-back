import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createHash } from "crypto";
import { z } from "zod";
import env from "../config/env";
import prisma from "../lib/prisma";
import { Prisma, TripItemKind, TripItemState } from "@prisma/client";
import { ApiError } from "../middleware/errorHandler";
import { buildPatchSystemPrompt, buildPatchUserPrompt } from "../ai/patch/prompts";
import {
  buildDiagnosticsSystemPrompt,
  buildDiagnosticsUserPrompt,
  DiagnosticsRefreshSchema,
  type DiagnosticsRefresh,
} from "../ai/patch/diagnostics";
import {
  PatchIntentSchema,
  PatchOpSchema,
  type PatchIntent,
  type PatchOp,
  type PatchTargetHints,
  type PatchItemUpdate,
  type PatchCreateItem,
} from "../ai/patch/schema";
import { tripService } from "./tripService";
import { reconstructService } from "./reconstructService";
import { logger } from "../utils/logger";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

const LARGE_DUMP_CHARS = 2000;
const DESTRUCTIVE_CONFIDENCE_THRESHOLD = 0.85;
const UPDATE_CONFIDENCE_THRESHOLD = 0.65;
const AMBIGUOUS_SCORE_GAP = 0.1;
const CANDIDATE_MIN_SCORE = 0.5;

const explicitDestructivePatterns = [
  /\bcancel(?:led|ed)?\b/i,
  /\bmoved to\b/i,
  /\bchanged to\b/i,
  /\bnew reservation\b/i,
  /\breplaced by\b/i,
  /\binstead\b/i,
  /\brescheduled\b/i,
];

type ClientContext = {
  timezone: string;
  nowIso?: string;
};

type IngestMode = "patch" | "rebuild" | undefined;

type IngestArgs = {
  userId: string;
  tripId: string;
  rawUpdateText: string;
  client: ClientContext;
  mode?: IngestMode;
};

type PendingActionCandidate = {
  itemId: string;
  kind: string;
  title: string;
  localDate: string | null;
  localTime: string | null;
  locationText: string | null;
  state: string;
  reason: string;
};

type IngestResponse =
  | {
      status: "APPLIED";
      mode: "patch" | "rebuild";
      tripItems: any[];
      changedItemIds: string[];
    }
  | {
      status: "NEEDS_CLARIFICATION";
      pendingActionId: string;
      intentType: "UPDATE" | "CANCEL" | "REPLACE" | "UNKNOWN";
      candidates: PendingActionCandidate[];
    };

type TripItemSnapshot = {
  id: string;
  kind: TripItemKind;
  title: string;
  startLocalDate: string | null;
  startLocalTime: string | null;
  endLocalDate: string | null;
  endLocalTime: string | null;
  timezone: string | null;
  startTimezone: string | null;
  endTimezone: string | null;
  locationText: string | null;
  isInferred: boolean;
  confidence: number;
  state: TripItemState;
};

type TripItemUpdateFlags = {
  isInferred?: boolean;
  confidence?: number;
};

function safeExtractJson(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return trimmed;
}

function parseJsonOrThrow(text: string): any {
  const jsonStr = safeExtractJson(text);
  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new ApiError("Patch model did not return valid JSON.", 502);
  }
}

function buildTripItemsSnapshot(items: TripItemSnapshot[]): string {
  const snapshot = items.map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    start: {
      localDate: item.startLocalDate,
      localTime: item.startLocalTime,
      timezone: item.startTimezone ?? item.timezone,
    },
    end: {
      localDate: item.endLocalDate,
      localTime: item.endLocalTime,
      timezone: item.endTimezone ?? item.timezone,
    },
    locationText: item.locationText,
    state: item.state,
  }));
  return JSON.stringify(snapshot, null, 2);
}

function hasExplicitDestructiveLanguage(text: string): boolean {
  return explicitDestructivePatterns.some((pattern) => pattern.test(text));
}

function hasRelativeDateLanguage(text: string): boolean {
  return /\b(today|tomorrow|yesterday|tonight|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(
    text
  );
}

function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().toLowerCase();
}

function buildKeywordSet(values?: string[]): Set<string> {
  const set = new Set<string>();
  (values ?? []).forEach((value) => {
    const cleaned = value.trim().toLowerCase();
    if (cleaned) set.add(cleaned);
  });
  return set;
}

function scoreCandidate(
  item: TripItemSnapshot,
  hints: PatchTargetHints
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (hints.kind && item.kind === hints.kind) {
    score += 0.3;
    reasons.push("Matches kind");
  }

  if (hints.localDate && item.startLocalDate === hints.localDate) {
    score += 0.25;
    reasons.push("Matches date");
  }

  if (hints.localTime && item.startLocalTime === hints.localTime) {
    score += 0.15;
    reasons.push("Matches time");
  }

  const titleKeywords = buildKeywordSet(hints.titleKeywords);
  if (titleKeywords.size) {
    const title = normalizeText(item.title);
    let hits = 0;
    titleKeywords.forEach((kw) => {
      if (title.includes(kw)) hits += 1;
    });
    if (hits) {
      score += Math.min(0.2, hits * 0.1);
      reasons.push("Title matches keywords");
    }
  }

  const locationKeywords = buildKeywordSet(hints.locationKeywords);
  if (locationKeywords.size && item.locationText) {
    const location = normalizeText(item.locationText);
    let hits = 0;
    locationKeywords.forEach((kw) => {
      if (location.includes(kw)) hits += 1;
    });
    if (hits) {
      score += Math.min(0.2, hits * 0.1);
      reasons.push("Location matches keywords");
    }
  }

  return { score, reasons };
}

function shouldAllowKindFallback(
  hints: PatchTargetHints,
  item: TripItemSnapshot,
  hasStrongTextMatch: boolean,
  dateMatches: boolean
) {
  if (!hints.kind) return true;
  if (item.kind === hints.kind) return true;
  const mealActivity =
    (hints.kind === "MEAL" && item.kind === "ACTIVITY") ||
    (hints.kind === "ACTIVITY" && item.kind === "MEAL");
  return mealActivity && hasStrongTextMatch && dateMatches;
}

function filterCandidates(
  items: TripItemSnapshot[],
  hints: PatchTargetHints,
  rawUpdateText: string
): TripItemSnapshot[] {
  let candidates = items;
  const allowDateFuzz = hasRelativeDateLanguage(rawUpdateText);

  const hintedDate = hints.localDate;
  if (hintedDate) {
    candidates = candidates.filter((item) => {
      if (!item.startLocalDate) return false;
      if (item.startLocalDate === hintedDate) return true;
      if (!allowDateFuzz) return false;
      const base = new Date(hintedDate);
      const itemDate = new Date(item.startLocalDate);
      const diffDays = Math.round(
        (itemDate.getTime() - base.getTime()) / (1000 * 60 * 60 * 24)
      );
      return Math.abs(diffDays) === 1;
    });
  }

  if (hints.kind) {
    candidates = candidates.filter((item) => {
      const dateMatches = !hintedDate || item.startLocalDate === hintedDate;
      const titleKeywords = Array.from(buildKeywordSet(hints.titleKeywords));
      const locationKeywords = Array.from(buildKeywordSet(hints.locationKeywords));
      const titleMatch =
        titleKeywords[0] && normalizeText(item.title).includes(titleKeywords[0]);
      const locationMatch =
        locationKeywords[0] &&
        normalizeText(item.locationText).includes(locationKeywords[0]);
      const strongTextMatch = Boolean(titleMatch || locationMatch);
      return shouldAllowKindFallback(hints, item, strongTextMatch, dateMatches);
    });
  }

  return candidates;
}

function resolveCandidates(
  items: TripItemSnapshot[],
  hints: PatchTargetHints | undefined,
  rawUpdateText: string
) {
  if (!hints) return { candidates: [] as PendingActionCandidate[], topId: undefined };
  const filtered = filterCandidates(items, hints, rawUpdateText);
  if (!filtered.length) return { candidates: [] as PendingActionCandidate[], topId: undefined };

  const scored = filtered
    .map((item) => {
      const { score, reasons } = scoreCandidate(item, hints);
      return { item, score, reasons };
    })
    .filter((entry) => entry.score >= CANDIDATE_MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { candidates: [] as PendingActionCandidate[], topId: undefined };

  const top = scored[0];
  if (!top) return { candidates: [] as PendingActionCandidate[], topId: undefined };
  const second = scored[1];
  const ambiguous = Boolean(second && top.score - second.score <= AMBIGUOUS_SCORE_GAP);

  const candidates = scored.slice(0, 5).map((entry) => ({
    itemId: entry.item.id,
    kind: entry.item.kind,
    title: entry.item.title,
    localDate: entry.item.startLocalDate,
    localTime: entry.item.startLocalTime,
    locationText: entry.item.locationText,
    state: entry.item.state,
    reason: entry.reasons.join(", ") || "Matches update hints",
  }));

  return { candidates, topId: ambiguous ? undefined : top.item.id };
}

function toIntentType(opType: PatchOp["opType"]) {
  if (opType === "UPDATE_ITEM") return "UPDATE";
  if (opType === "CANCEL_ITEM" || opType === "DISMISS_ITEM") return "CANCEL";
  if (opType === "REPLACE_ITEM") return "REPLACE";
  return "UNKNOWN";
}

function ensurePatchAllowed(
  op: PatchOp,
  rawUpdateText: string,
  targetState?: string
): boolean {
  const explicit = hasExplicitDestructiveLanguage(rawUpdateText);
  const isDestructive =
    op.opType === "CANCEL_ITEM" ||
    op.opType === "DISMISS_ITEM" ||
    op.opType === "REPLACE_ITEM";

  if (isDestructive && targetState === "CONFIRMED" && !explicit) {
    return false;
  }

  if (isDestructive && !explicit && op.confidence < DESTRUCTIVE_CONFIDENCE_THRESHOLD) {
    return false;
  }

  if (op.opType === "UPDATE_ITEM" && op.confidence < UPDATE_CONFIDENCE_THRESHOLD && !explicit) {
    return false;
  }

  return true;
}

function parseDateParts(value: string | null | undefined): [number, number, number] | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function parseTimeParts(value: string | null | undefined): [number, number] | null {
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
  localDate: string | null | undefined;
  localTime: string | null | undefined;
  timezone: string | null | undefined;
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

function mergeMetadata(
  existing: unknown,
  patchRunId: string,
  previous?: Record<string, unknown>
) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  if (previous && Object.keys(previous).length) {
    base.previous = {
      ...(base.previous ?? {}),
      ...previous,
    };
  }
  base.lastUpdatedByRunId = patchRunId;
  return base;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function buildPatchAuditPayload(args: {
  rawUpdateText: string;
  ops: PatchOp[];
  appliedAt: string;
  resolution: { opType: string; targetId?: string }[];
}) {
  const hash = createHash("sha256").update(args.rawUpdateText).digest("hex");
  return {
    type: "PATCH",
    rawUpdateTextLength: args.rawUpdateText.length,
    rawUpdateTextHash: hash,
    appliedAt: args.appliedAt,
    ops: args.ops.map((op) => ({
      opType: op.opType,
      confidence: op.confidence,
      reason: op.reason,
    })),
    resolution: args.resolution,
  };
}

function buildDiagnosticsItemsSnapshot(items: TripItemSnapshot[]): string {
  const snapshot = items.map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    startLocalDate: item.startLocalDate,
    startLocalTime: item.startLocalTime,
    endLocalDate: item.endLocalDate,
    endLocalTime: item.endLocalTime,
    locationText: item.locationText,
    isInferred: item.isInferred,
    confidence: item.confidence,
    state: item.state,
  }));
  return JSON.stringify(snapshot, null, 2);
}

function buildPreviousDiagnosticsSnapshot(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

async function refreshDiagnostics(args: {
  tripId: string;
  userId: string;
  rawUpdateText: string;
  items: TripItemSnapshot[];
}): Promise<{ base: Record<string, unknown>; diagnostics: DiagnosticsRefresh } | null> {
  const latest = await prisma.reconstructRun.findFirst({
    where: {
      tripId: args.tripId,
      status: "SUCCESS",
      NOT: {
        outputJson: {
          path: ["type"],
          equals: "PATCH",
        },
      },
    },
    orderBy: { createdAt: "desc" },
    select: { outputJson: true },
  });
  if (!latest?.outputJson) return null;

  const system = buildDiagnosticsSystemPrompt();
  const userPrompt = buildDiagnosticsUserPrompt({
    rawUpdateText: args.rawUpdateText,
    itemsSnapshot: buildDiagnosticsItemsSnapshot(args.items),
    previousDiagnostics: buildPreviousDiagnosticsSnapshot(latest.outputJson),
  });

  const model = env.AI_MODEL;
  logger.info("LLM diagnostics refresh start", {
    model,
    updateChars: args.rawUpdateText.length,
  });
  const startMs = Date.now();
  const { text } = await generateText({
    model: openai(model),
    system,
    prompt: userPrompt,
  });
  logger.info("LLM diagnostics refresh end", {
    model,
    durationMs: Date.now() - startMs,
    outputChars: text.length,
  });

  const parsed = parseJsonOrThrow(text);
  const validated = DiagnosticsRefreshSchema.safeParse(parsed);
  if (!validated.success) {
    logger.warn("Diagnostics refresh validation failed", {
      issues: z.treeifyError(validated.error),
    });
    return null;
  }
  return { base: latest.outputJson as Record<string, unknown>, diagnostics: validated.data };
}

function mergeDiagnosticsIntoReconstruction(args: {
  base: Record<string, unknown>;
  diagnostics: DiagnosticsRefresh;
  items: TripItemSnapshot[];
}) {
  const inferredCount = args.items.filter(
    (item) => item.state !== "DISMISSED" && item.isInferred
  ).length;
  const recognizedItemCount = args.items.filter(
    (item) => item.state !== "DISMISSED"
  ).length;

  return {
    ...args.base,
    executiveSummary: args.diagnostics.executiveSummary,
    destinationSummary: args.diagnostics.destinationSummary,
    risks: args.diagnostics.risks,
    assumptions: args.diagnostics.assumptions,
    missingInfo: args.diagnostics.missingInfo,
    sourceStats: {
      ...(typeof args.base.sourceStats === "object" ? (args.base.sourceStats as Record<string, unknown>) : {}),
      recognizedItemCount,
      inferredItemCount: inferredCount,
    },
  };
}

async function runPatchModel(args: {
  client: ClientContext;
  rawUpdateText: string;
  tripItemsSnapshot: string;
}): Promise<PatchIntent> {
  const system = buildPatchSystemPrompt();
  const userPrompt = buildPatchUserPrompt({
    clientTimezone: args.client.timezone,
    nowIso: args.client.nowIso,
    rawUpdateText: args.rawUpdateText,
    tripItemsSnapshot: args.tripItemsSnapshot,
  });

  const model = env.AI_MODEL;
  logger.info("LLM patch call start", {
    model,
    updateChars: args.rawUpdateText.length,
    snapshotChars: args.tripItemsSnapshot.length,
  });
  const startMs = Date.now();
  const { text } = await generateText({
    model: openai(model),
    system,
    prompt: userPrompt,
  });
  logger.info("LLM patch call end", {
    model,
    durationMs: Date.now() - startMs,
    outputChars: text.length,
  });

  const parsed = parseJsonOrThrow(text);
  const validated = PatchIntentSchema.safeParse(parsed);
  if (!validated.success) {
    throw new ApiError("Patch output did not match schema.", 502, {
      issues: z.treeifyError(validated.error),
    });
  }
  return validated.data;
}

function buildUpdateFields(item: TripItemSnapshot, updates: PatchItemUpdate) {
  const nextStartLocalDate = updates.start?.localDate ?? item.startLocalDate;
  const nextStartLocalTime = updates.start?.localTime ?? item.startLocalTime;
  const nextStartTimezone =
    updates.start?.timezone ?? item.startTimezone ?? item.timezone;
  const nextEndLocalDate = updates.end?.localDate ?? item.endLocalDate;
  const nextEndLocalTime = updates.end?.localTime ?? item.endLocalTime;
  const nextEndTimezone = updates.end?.timezone ?? item.endTimezone ?? item.timezone;
  const nextTimezone = nextStartTimezone ?? nextEndTimezone ?? item.timezone;

  const startIso = toIsoFromLocal({
    localDate: nextStartLocalDate,
    localTime: nextStartLocalTime,
    timezone: nextStartTimezone,
  });
  const endIso = toIsoFromLocal({
    localDate: nextEndLocalDate,
    localTime: nextEndLocalTime,
    timezone: nextEndTimezone,
  });
  const nextTitle = updates.title ?? item.title;
  const nextLocation = updates.locationText ?? item.locationText;
  const fingerprint = buildItemFingerprint({
    kind: updates.kind ?? item.kind,
    title: nextTitle,
    startIso,
    startLocalDate: nextStartLocalDate ?? null,
    startLocalTime: nextStartLocalTime ?? null,
    locationText: nextLocation ?? null,
  });

  const updateFlags: TripItemUpdateFlags = {};
  const wasMissingDateOrTime = !item.startLocalDate || !item.startLocalTime;
  const nowHasDateAndTime = Boolean(nextStartLocalDate && nextStartLocalTime);
  if (wasMissingDateOrTime && nowHasDateAndTime) {
    updateFlags.isInferred = false;
    updateFlags.confidence = Math.max(0.9, item.confidence ?? 0);
  }

  return {
    title: nextTitle,
    kind: updates.kind ?? item.kind,
    locationText: nextLocation,
    startLocalDate: nextStartLocalDate,
    startLocalTime: nextStartLocalTime,
    endLocalDate: nextEndLocalDate,
    endLocalTime: nextEndLocalTime,
    startTimezone: nextStartTimezone ?? null,
    endTimezone: nextEndTimezone ?? null,
    timezone: nextTimezone ?? null,
    startIso,
    endIso,
    fingerprint,
    ...updateFlags,
  };
}

function buildCreateFields(create: PatchCreateItem) {
  const startTimezone = create.start?.timezone ?? null;
  const endTimezone = create.end?.timezone ?? null;
  const timezone = startTimezone ?? endTimezone ?? null;
  const startLocalDate = create.start?.localDate ?? null;
  const startLocalTime = create.start?.localTime ?? null;
  const endLocalDate = create.end?.localDate ?? null;
  const endLocalTime = create.end?.localTime ?? null;
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
    kind: create.kind,
    title: create.title,
    startIso,
    startLocalDate,
    startLocalTime,
    locationText: create.locationText ?? null,
  });

  return {
    kind: create.kind,
    title: create.title,
    startIso,
    endIso,
    timezone,
    startTimezone,
    endTimezone,
    startLocalDate,
    startLocalTime,
    endLocalDate,
    endLocalTime,
    locationText: create.locationText ?? null,
    fingerprint,
    isInferred: false,
    confidence: 0.95,
  };
}

function assertCreateData(value: PatchCreateItem | PatchItemUpdate): asserts value is PatchCreateItem {
  if (!("kind" in value) || !value.kind || !("title" in value) || !value.title) {
    throw new ApiError("Create operation requires kind and title.", 400);
  }
}

type ResolvedPatchOp = {
  op: PatchOp;
  targetId?: string;
  candidates?: PendingActionCandidate[];
};

async function applyPatchOps(args: {
  tripId: string;
  userId: string;
  rawUpdateText: string;
  client: ClientContext;
  items: TripItemSnapshot[];
  intent: PatchIntent;
}): Promise<IngestResponse> {
  const changedItemIds: string[] = [];
  const resolutions: { opType: string; targetId?: string }[] = [];

  for (const op of args.intent.ops) {
    if (op.opType === "NEED_CLARIFICATION") {
      const { candidates } = resolveCandidates(
        args.items,
        op.targetHints,
        args.rawUpdateText
      );
      const pending = await prisma.pendingAction.create({
        data: {
          tripId: args.tripId,
          rawUpdateText: args.rawUpdateText,
          intentType: toIntentType(op.opType),
          candidates,
          payload: op,
        },
      });
      throw new PendingActionError(pending.id, toIntentType(op.opType), candidates);
    }
  }

  const resolvedOps: ResolvedPatchOp[] = [];
  for (const op of args.intent.ops) {
    if (op.opType === "CREATE_ITEM") {
      resolvedOps.push({ op });
      continue;
    }

    const { candidates, topId } = resolveCandidates(
      args.items,
      op.targetHints,
      args.rawUpdateText
    );

    if (!topId) {
      const pending = await prisma.pendingAction.create({
        data: {
          tripId: args.tripId,
          rawUpdateText: args.rawUpdateText,
          intentType: toIntentType(op.opType),
          candidates,
          payload: op,
        },
      });
      throw new PendingActionError(pending.id, toIntentType(op.opType), candidates);
    }

    const target = args.items.find((item) => item.id === topId);
    if (!target) {
      throw new ApiError("Target item not found for patch.", 404);
    }

    const allowed = ensurePatchAllowed(op, args.rawUpdateText, target.state);
    if (!allowed) {
      const pending = await prisma.pendingAction.create({
        data: {
          tripId: args.tripId,
          rawUpdateText: args.rawUpdateText,
          intentType: toIntentType(op.opType),
          candidates,
          payload: op,
        },
      });
      throw new PendingActionError(pending.id, toIntentType(op.opType), candidates);
    }

    resolvedOps.push({ op, targetId: topId, candidates });
  }

  await prisma.$transaction(async (tx) => {
    const patchRun = await tx.reconstructRun.create({
      data: {
        userId: args.userId,
        tripId: args.tripId,
        status: "SUCCESS",
        timezone: args.client.timezone,
        nowIso: args.client.nowIso ?? null,
        rawText: args.rawUpdateText,
        outputJson: {
          type: "PATCH",
          rawUpdateTextLength: args.rawUpdateText.length,
        },
      },
    });

    for (const resolved of resolvedOps) {
      const op = resolved.op;

      if (op.opType === "CREATE_ITEM") {
        const createData = op.replacement ?? (op.updates as PatchCreateItem);
        if (!createData) throw new ApiError("Create operation missing data.", 400);
        assertCreateData(createData);
        const fields = buildCreateFields(createData);
        const existing = await tx.tripItem.findUnique({
          where: {
            tripId_fingerprint: { tripId: args.tripId, fingerprint: fields.fingerprint },
          },
          select: { id: true, metadata: true },
        });
        if (existing) {
          await tx.tripItem.update({
            where: { id: existing.id },
            data: {
              ...fields,
              state: "PROPOSED",
              source: "USER",
              sourceSnippet: args.rawUpdateText.slice(0, 180),
              metadata: asJson(mergeMetadata(existing.metadata, patchRun.id)),
            },
          });
          changedItemIds.push(existing.id);
        } else {
          const created = await tx.tripItem.create({
            data: {
              trip: { connect: { id: args.tripId } },
              ...fields,
              state: "PROPOSED",
              source: "USER",
              sourceSnippet: args.rawUpdateText.slice(0, 180),
              metadata: asJson({ lastUpdatedByRunId: patchRun.id }),
            },
          });
          changedItemIds.push(created.id);
        }
        resolutions.push({ opType: op.opType });
        continue;
      }

      if (!resolved.targetId) {
        throw new ApiError("Resolved patch missing target.", 400);
      }

      const target = await tx.tripItem.findUnique({
        where: { id: resolved.targetId },
        select: {
          id: true,
          title: true,
          kind: true,
          startLocalDate: true,
          startLocalTime: true,
          endLocalDate: true,
          endLocalTime: true,
          timezone: true,
          startTimezone: true,
          endTimezone: true,
          locationText: true,
          state: true,
          isInferred: true,
          confidence: true,
          metadata: true,
        },
      });
      if (!target) throw new ApiError("Target item not found.", 404);

      if (op.opType === "UPDATE_ITEM") {
        if (!op.updates) throw new ApiError("Update operation missing data.", 400);
        const nextFields = buildUpdateFields(target, op.updates);
        const previous: Record<string, unknown> = {};
        if (target.state === "CONFIRMED") {
          if (op.updates.title) previous.title = target.title;
          if (op.updates.locationText) previous.locationText = target.locationText;
          if (op.updates.start) {
            previous.startLocalDate = target.startLocalDate;
            previous.startLocalTime = target.startLocalTime;
            previous.startTimezone = target.startTimezone ?? target.timezone;
          }
          if (op.updates.end) {
            previous.endLocalDate = target.endLocalDate;
            previous.endLocalTime = target.endLocalTime;
            previous.endTimezone = target.endTimezone ?? target.timezone;
          }
        }
        await tx.tripItem.update({
          where: { id: target.id },
          data: {
            ...nextFields,
            metadata: asJson(mergeMetadata(target.metadata, patchRun.id, previous)),
          },
        });
        changedItemIds.push(target.id);
        resolutions.push({ opType: op.opType, targetId: target.id });
        continue;
      }

      if (op.opType === "CANCEL_ITEM") {
        await tx.tripItem.update({
          where: { id: target.id },
          data: {
            state: "CANCELLED",
            metadata: asJson(mergeMetadata(target.metadata, patchRun.id)),
          },
        });
        changedItemIds.push(target.id);
        resolutions.push({ opType: op.opType, targetId: target.id });
        continue;
      }

      if (op.opType === "DISMISS_ITEM") {
        await tx.tripItem.update({
          where: { id: target.id },
          data: {
            state: "DISMISSED",
            metadata: asJson(mergeMetadata(target.metadata, patchRun.id)),
          },
        });
        changedItemIds.push(target.id);
        resolutions.push({ opType: op.opType, targetId: target.id });
        continue;
      }

      if (op.opType === "REPLACE_ITEM") {
        if (!op.replacement) throw new ApiError("Replace operation missing data.", 400);
        assertCreateData(op.replacement);
        await tx.tripItem.update({
          where: { id: target.id },
          data: {
            state: "CANCELLED",
            metadata: asJson(mergeMetadata(target.metadata, patchRun.id)),
          },
        });
        const fields = buildCreateFields(op.replacement);
        const created = await tx.tripItem.create({
          data: {
            trip: { connect: { id: args.tripId } },
            ...fields,
            state: "PROPOSED",
            source: "USER",
            sourceSnippet: args.rawUpdateText.slice(0, 180),
            metadata: asJson({ lastUpdatedByRunId: patchRun.id }),
          },
        });
        changedItemIds.push(target.id, created.id);
        resolutions.push({ opType: op.opType, targetId: target.id });
        continue;
      }
    }

    const auditPayload = buildPatchAuditPayload({
      rawUpdateText: args.rawUpdateText,
      ops: args.intent.ops,
      appliedAt: new Date().toISOString(),
      resolution: resolutions,
    });
    await tx.reconstructRun.update({
      where: { id: patchRun.id },
      data: { outputJson: auditPayload },
    });
  });

  const tripItems = await tripService.getTripItems(args.userId, args.tripId);

  const diagnosticsItems = await prisma.tripItem.findMany({
    where: { tripId: args.tripId, state: { not: "DISMISSED" } },
    select: {
      id: true,
      kind: true,
      title: true,
      startLocalDate: true,
      startLocalTime: true,
      endLocalDate: true,
      endLocalTime: true,
      timezone: true,
      startTimezone: true,
      endTimezone: true,
      locationText: true,
      isInferred: true,
      confidence: true,
      state: true,
    },
  });

  const diagnostics = await refreshDiagnostics({
    tripId: args.tripId,
    userId: args.userId,
    rawUpdateText: args.rawUpdateText,
    items: diagnosticsItems,
  });
  if (diagnostics) {
    const merged = mergeDiagnosticsIntoReconstruction({
      base: diagnostics.base,
      diagnostics: diagnostics.diagnostics,
      items: diagnosticsItems,
    });
    await prisma.reconstructRun.create({
      data: {
        userId: args.userId,
        tripId: args.tripId,
        status: "SUCCESS",
        timezone: args.client.timezone,
        nowIso: args.client.nowIso ?? null,
        rawText: args.rawUpdateText,
        outputJson: asJson(merged),
      },
    });
  }

  return { status: "APPLIED", mode: "patch", tripItems, changedItemIds };
}

export class PendingActionError extends Error {
  pendingActionId: string;
  intentType: "UPDATE" | "CANCEL" | "REPLACE" | "UNKNOWN";
  candidates: PendingActionCandidate[];

  constructor(
    pendingActionId: string,
    intentType: "UPDATE" | "CANCEL" | "REPLACE" | "UNKNOWN",
    candidates: PendingActionCandidate[]
  ) {
    super("Clarification required.");
    this.pendingActionId = pendingActionId;
    this.intentType = intentType;
    this.candidates = candidates;
  }
}

export async function ingestTripUpdate(args: IngestArgs): Promise<IngestResponse> {
  const trip = await tripService.getTripOrThrow(args.userId, args.tripId);
  const trimmed = args.rawUpdateText.trim();
  if (!trimmed) throw new ApiError("Update text is required.", 400);

  const itemCount = await prisma.tripItem.count({ where: { tripId: args.tripId } });
  const shouldRebuild =
    args.mode === "rebuild" ||
    itemCount === 0 ||
    (trimmed.length >= LARGE_DUMP_CHARS && args.mode !== "patch");

  if (shouldRebuild) {
    const { combinedRawText, truncation } = await tripService.appendTripSource(
      args.userId,
      args.tripId,
      trimmed
    );

    const reconstruction = await reconstructService({
      userId: args.userId,
      rawText: combinedRawText,
      client: args.client,
      tripId: args.tripId,
      inputMeta: truncation
        ? {
            rawTextTruncated: true,
            rawTextOriginalChars: truncation.originalChars,
            rawTextKeptChars: truncation.keptChars,
            rawTextOmittedChars: truncation.omittedChars,
          }
        : undefined,
    });

    if (trip.title.trim() === "Untitled Trip") {
      await tripService.renameTrip({
        userId: args.userId,
        tripId: args.tripId,
        title: reconstruction.tripTitle,
      });
    }

    const tripItems = await tripService.getTripItems(args.userId, args.tripId);
    return { status: "APPLIED", mode: "rebuild", tripItems, changedItemIds: [] };
  }

  const items = await prisma.tripItem.findMany({
    where: { tripId: args.tripId, state: { not: "DISMISSED" } },
    select: {
      id: true,
      kind: true,
      title: true,
      startLocalDate: true,
      startLocalTime: true,
      endLocalDate: true,
      endLocalTime: true,
      timezone: true,
      startTimezone: true,
      endTimezone: true,
      locationText: true,
      isInferred: true,
      confidence: true,
      state: true,
    },
  });

  const snapshot = buildTripItemsSnapshot(items);
  const intent = await runPatchModel({
    client: args.client,
    rawUpdateText: trimmed,
    tripItemsSnapshot: snapshot,
  });

  try {
    return await applyPatchOps({
      tripId: args.tripId,
      userId: args.userId,
      rawUpdateText: trimmed,
      client: args.client,
      items,
      intent,
    });
  } catch (error) {
    if (error instanceof PendingActionError) {
      return {
        status: "NEEDS_CLARIFICATION",
        pendingActionId: error.pendingActionId,
        intentType: error.intentType,
        candidates: error.candidates,
      };
    }
    throw error;
  }
}

export async function resolvePendingAction(args: {
  userId: string;
  pendingActionId: string;
  selectedItemId: string;
}): Promise<IngestResponse> {
  const pending = await prisma.pendingAction.findUnique({
    where: { id: args.pendingActionId },
  });
  if (!pending) throw new ApiError("Pending action not found.", 404);

  await tripService.getTripOrThrow(args.userId, pending.tripId);

  const opParsed = PatchOpSchema.safeParse(pending.payload);
  if (!opParsed.success) {
    throw new ApiError("Pending action payload is invalid.", 400);
  }
  const op = opParsed.data;

  const candidates = Array.isArray(pending.candidates)
    ? (pending.candidates as PendingActionCandidate[])
    : [];
  const selected = candidates.find((candidate) => candidate.itemId === args.selectedItemId);
  if (!selected) throw new ApiError("Selected item is not a valid candidate.", 400);

  await prisma.$transaction(async (tx) => {
    const patchRun = await tx.reconstructRun.create({
      data: {
        userId: args.userId,
        tripId: pending.tripId,
        status: "SUCCESS",
        timezone: "UTC",
        nowIso: null,
        rawText: pending.rawUpdateText,
        outputJson: buildPatchAuditPayload({
          rawUpdateText: pending.rawUpdateText,
          ops: [op],
          appliedAt: new Date().toISOString(),
          resolution: [{ opType: op.opType, targetId: args.selectedItemId }],
        }),
      },
    });

    const target = await tx.tripItem.findUnique({
      where: { id: args.selectedItemId },
      select: {
        id: true,
        title: true,
        kind: true,
        startLocalDate: true,
        startLocalTime: true,
        endLocalDate: true,
        endLocalTime: true,
        timezone: true,
        startTimezone: true,
        endTimezone: true,
        locationText: true,
        state: true,
        isInferred: true,
        confidence: true,
        metadata: true,
      },
    });
    if (!target) throw new ApiError("Target item not found.", 404);

    if (op.opType === "UPDATE_ITEM") {
      if (!op.updates) throw new ApiError("Update operation missing data.", 400);
      const nextFields = buildUpdateFields(target, op.updates);
      const previous: Record<string, unknown> = {};
      if (target.state === "CONFIRMED") {
        if (op.updates.title) previous.title = target.title;
        if (op.updates.locationText) previous.locationText = target.locationText;
        if (op.updates.start) {
          previous.startLocalDate = target.startLocalDate;
          previous.startLocalTime = target.startLocalTime;
          previous.startTimezone = target.startTimezone ?? target.timezone;
        }
        if (op.updates.end) {
          previous.endLocalDate = target.endLocalDate;
          previous.endLocalTime = target.endLocalTime;
          previous.endTimezone = target.endTimezone ?? target.timezone;
        }
      }
      await tx.tripItem.update({
        where: { id: target.id },
        data: {
          ...nextFields,
          metadata: asJson(mergeMetadata(target.metadata, patchRun.id, previous)),
        },
      });
    } else if (op.opType === "CANCEL_ITEM") {
      await tx.tripItem.update({
        where: { id: target.id },
        data: {
          state: "CANCELLED",
          metadata: asJson(mergeMetadata(target.metadata, patchRun.id)),
        },
      });
    } else if (op.opType === "DISMISS_ITEM") {
      await tx.tripItem.update({
        where: { id: target.id },
        data: {
          state: "DISMISSED",
          metadata: asJson(mergeMetadata(target.metadata, patchRun.id)),
        },
      });
    } else if (op.opType === "REPLACE_ITEM") {
      if (!op.replacement) throw new ApiError("Replace operation missing data.", 400);
      assertCreateData(op.replacement);
      await tx.tripItem.update({
        where: { id: target.id },
        data: {
          state: "CANCELLED",
          metadata: asJson(mergeMetadata(target.metadata, patchRun.id)),
        },
      });
      const fields = buildCreateFields(op.replacement);
      await tx.tripItem.create({
        data: {
          trip: { connect: { id: pending.tripId } },
          ...fields,
          state: "PROPOSED",
          source: "USER",
          sourceSnippet: pending.rawUpdateText.slice(0, 180),
          metadata: asJson({ lastUpdatedByRunId: patchRun.id }),
        },
      });
    }

    await tx.pendingAction.delete({ where: { id: pending.id } });
  });

  const tripItems = await tripService.getTripItems(args.userId, pending.tripId);
  return {
    status: "APPLIED",
    mode: "patch",
    tripItems,
    changedItemIds: [args.selectedItemId],
  };
}
