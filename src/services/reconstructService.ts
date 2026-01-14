import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  TripReconstructionSchema,
  type TripReconstruction,
} from "../ai/reconstruct/schema";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildRepairPrompt,
} from "../ai/reconstruct/prompts";
import { z } from "zod";
import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";
import env from "../config/env";
import {
  buildTripItemDrafts,
  type TripItemDraft,
} from "../mappers/tripItemMapper";
import { logger } from "../utils/logger";

type ReconstructServiceArgs = {
  userId: string;
  rawText: string;
  client: {
    timezone: string;
    nowIso?: string;
  };
  tripId?: string;
  inputMeta?: {
    rawTextTruncated?: boolean;
    rawTextOriginalChars?: number;
    rawTextKeptChars?: number;
    rawTextOmittedChars?: number;
  };
};

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    const err: any = new Error("Model did not return valid JSON.");
    err.code = "INVALID_MODEL_JSON";
    err.httpStatus = 502;
    err.publicMessage =
      "The AI response could not be parsed. Please try again.";
    err.stage = "parse";
    throw err;
  }
}

function summarizeZodIssues(issues: unknown, limit = 8) {
  if (!Array.isArray(issues)) return { count: 0, sample: [] as unknown[] };
  const sample = issues.slice(0, limit).map((issue: any) => ({
    path: Array.isArray(issue.path) ? issue.path.join(".") : String(issue.path),
    code: issue.code,
    message: issue.message,
  }));
  return { count: issues.length, sample };
}

async function callModel(system: string, user: string): Promise<string> {
  const model = env.AI_MODEL;
  logger.info("LLM call start", {
    model,
    systemChars: system.length,
    userChars: user.length,
  });
  const callStartMs = Date.now();
  const { text } = await generateText({
    model: openai(model),
    system,
    prompt: user,
    // temperature: 0.2,
  });
  logger.info("LLM call end", {
    model,
    durationMs: Date.now() - callStartMs,
    outputChars: text.length,
  });
  return text;
}

type RunData = Prisma.ReconstructRunUncheckedCreateInput;

function buildRunBase(args: ReconstructServiceArgs) {
  return {
    userId: args.userId,
    tripId: args.tripId ?? null,
    timezone: args.client.timezone,
    nowIso: args.client.nowIso ?? null,
    rawText: args.rawText,
  };
}

function truncate(value: string, max = 20_000) {
  if (value.length <= max) return value;
  return value.slice(0, max) + `\n...[truncated ${value.length - max} chars]`;
}

function toPublicMessage(err: any) {
  return err?.publicMessage ?? err?.message ?? "Unknown error.";
}

function toErrorCode(err: any) {
  return err?.code ?? "UNKNOWN_ERROR";
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function buildOutputJson(
  result: TripReconstruction,
  inputMeta?: ReconstructServiceArgs["inputMeta"]
): Prisma.InputJsonValue {
  if (inputMeta?.rawTextTruncated) {
    return asJson({
      ...result,
      _meta: {
        rawText: inputMeta,
      },
    });
  }
  return asJson(result);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeMetadata(
  existing: unknown,
  runId: string,
  aiDetails: Record<string, unknown> | null
): Prisma.InputJsonValue {
  const base = isPlainObject(existing) ? { ...existing } : {};
  const existingAi = isPlainObject(base.ai) ? (base.ai as Record<string, unknown>) : {};
  const nextAi = aiDetails ? { ...existingAi, ...aiDetails } : existingAi;
  return asJson({
    ...base,
    ...(aiDetails ? { ai: nextAi } : {}),
    lastUpdatedByRunId: runId,
  });
}

type AttemptDebug = {
  modelOutput: string | null;
  extractedJson: string | null;
  zodIssues: unknown;
};

type ReconstructAttemptResult =
  | {
      ok: true;
      data: TripReconstruction;
      attempt1: AttemptDebug;
      attempt2: AttemptDebug;
    }
  | {
      ok: false;
      error: any;
      attempt1: AttemptDebug;
      attempt2: AttemptDebug;
    };

/**
 * Runs:
 * 1) initial prompt
 * 2) if invalid: repair prompt using zod issues + invalid JSON
 *
 * Returns both result + debug context (bounded later in outputJson on failure).
 */
async function runOnceWithRepair(args: {
  system: string;
  userPrompt: string;
  repairPromptBuilder: (params: {
    invalidJson: string;
    zodIssues: unknown;
  }) => string;
}): Promise<ReconstructAttemptResult> {
  const attempt1: AttemptDebug = {
    modelOutput: null,
    extractedJson: null,
    zodIssues: null,
  };
  const attempt2: AttemptDebug = {
    modelOutput: null,
    extractedJson: null,
    zodIssues: null,
  };

  try {
    // Attempt 1
    const out1 = await callModel(args.system, args.userPrompt);
    attempt1.modelOutput = out1;
    attempt1.extractedJson = safeExtractJson(out1);

    let parsed1: any;
    try {
      parsed1 = parseJsonOrThrow(out1);
    } catch (err) {
      logger.warn("LLM JSON parse failed", {
        stage: "attempt1",
        extractedChars: attempt1.extractedJson?.length ?? null,
      });
      throw err;
    }
    const validated1 = TripReconstructionSchema.safeParse(parsed1);

    if (validated1.success) {
      logger.info("LLM output validated on first attempt");
      return { ok: true, data: validated1.data, attempt1, attempt2 };
    }

    attempt1.zodIssues = validated1.error.issues;
    const issues1 = summarizeZodIssues(validated1.error.issues);
    logger.warn("LLM output validation failed; running repair", issues1);

    // Attempt 2 (repair)
    const repairPrompt = args.repairPromptBuilder({
      invalidJson: attempt1.extractedJson ?? "",
      zodIssues: validated1.error.issues,
    });

    const out2 = await callModel(args.system, repairPrompt);
    attempt2.modelOutput = out2;
    attempt2.extractedJson = safeExtractJson(out2);

    let parsed2: any;
    try {
      parsed2 = parseJsonOrThrow(out2);
    } catch (err) {
      logger.warn("LLM JSON parse failed", {
        stage: "attempt2",
        extractedChars: attempt2.extractedJson?.length ?? null,
      });
      throw err;
    }
    const validated2 = TripReconstructionSchema.safeParse(parsed2);

    if (!validated2.success) {
      attempt2.zodIssues = validated2.error.issues;
      const issues2 = summarizeZodIssues(validated2.error.issues);
      logger.warn("LLM repair validation failed", issues2);

      const err: any = new Error(
        "Model output did not match schema after repair."
      );
      err.code = "SCHEMA_VALIDATION_FAILED";
      err.httpStatus = 502;
      err.publicMessage =
        "The AI output couldn’t be validated. Please try again.";
      err.details = z.treeifyError(validated2.error);
      err.stage = "repair_validate";
      throw err;
    }

    logger.info("LLM repair validated");
    return { ok: true, data: validated2.data, attempt1, attempt2 };
  } catch (err: any) {
    return { ok: false, error: err, attempt1, attempt2 };
  }
}

export async function reconstructService(
  args: ReconstructServiceArgs
): Promise<TripReconstruction> {
  const system = buildSystemPrompt();
  const userPrompt = buildUserPrompt({
    clientTimezone: args.client.timezone,
    nowIso: args.client.nowIso,
    rawText: args.rawText,
  });

  const base = buildRunBase(args);

  let result: TripReconstruction | null = null;
  let caughtError: any = null;
  let persistError: any = null;
  let runData: RunData | null = null;

  // Do all model work first, then persist in finally.
  const startMs = Date.now();
  logger.info("Reconstruction input", {
    rawTextChars: args.rawText.length,
    model: env.AI_MODEL,
  });
  const attempt = await runOnceWithRepair({
    system,
    userPrompt,
    repairPromptBuilder: ({ invalidJson, zodIssues }) =>
      buildRepairPrompt({
        clientTimezone: args.client.timezone,
        nowIso: args.client.nowIso,
        rawText: args.rawText,
        invalidJson,
        zodIssues,
      }),
  });
  const durationMs = Date.now() - startMs;
  logger.info("LLM reconstruction duration (ms)", { durationMs });

  try {
    if (attempt.ok) {
      result = attempt.data;

      runData = {
        ...base,
        status: "SUCCESS",
        outputJson: buildOutputJson(result, args.inputMeta),
        errorCode: null,
        errorMessage: null,
      };
    } else {
      caughtError = attempt.error;

      runData = {
        ...base,
        status: "FAILED",
        errorCode: toErrorCode(caughtError),
        errorMessage: toPublicMessage(caughtError),
        outputJson: asJson({
          type: "reconstruct_error",
          stage: caughtError?.stage ?? "unknown",
          code: toErrorCode(caughtError),
          message: toPublicMessage(caughtError),
          inputMeta: args.inputMeta ?? null,
          attempt1: {
            modelOutput: attempt.attempt1.modelOutput
              ? truncate(attempt.attempt1.modelOutput)
              : null,
            extractedJson: attempt.attempt1.extractedJson
              ? truncate(attempt.attempt1.extractedJson)
              : null,
            zodIssues: attempt.attempt1.zodIssues,
          },
          attempt2: {
            modelOutput: attempt.attempt2.modelOutput
              ? truncate(attempt.attempt2.modelOutput)
              : null,
            extractedJson: attempt.attempt2.extractedJson
              ? truncate(attempt.attempt2.extractedJson)
              : null,
            zodIssues: attempt.attempt2.zodIssues,
          },
          details: caughtError?.details ?? null,
        }),
      };
    }
  } finally {
    // Persist in finally, once.
    if (!runData) {
      persistError = new Error("Reconstruction did not produce run data.");
    } else {
      const persistStartMs = Date.now();
      try {
        if (attempt.ok && result && args.tripId) {
          await prisma.$transaction(async (tx) => {
            const runStartMs = Date.now();
            const run = await tx.reconstructRun.create({ data: runData! });
            logger.info("Reconstruct run persisted (ms)", {
              durationMs: Date.now() - runStartMs,
            });
            const items = buildTripItemDrafts({
              tripId: args.tripId!,
              reconstruction: result!,
              runId: run.id,
            });
            const upsertStartMs = Date.now();
            await upsertTripItems(tx, items, run.id);
            logger.info("Trip item upsert batch duration (ms)", {
              durationMs: Date.now() - upsertStartMs,
              itemCount: items.length,
            });
          });
        } else {
          const runStartMs = Date.now();
          await prisma.reconstructRun.create({ data: runData });
          logger.info("Reconstruct run persisted (ms)", {
            durationMs: Date.now() - runStartMs,
          });
        }
      } catch (err) {
        persistError = err;
      } finally {
        logger.info("Reconstruction persist total duration (ms)", {
          durationMs: Date.now() - persistStartMs,
        });
      }
    }
  }

  // Success requires persistence
  if (!caughtError && persistError) throw persistError;

  // Failure should throw original error regardless of persistence failure
  if (caughtError) throw caughtError;

  if (!result)
    throw new Error("Reconstruction succeeded but no result was produced.");

  return result;
}

async function upsertTripItems(
  tx: Prisma.TransactionClient,
  items: TripItemDraft[],
  runId: string
) {
  for (const item of items) {
    const itemStartMs = Date.now();
    const existing = await tx.tripItem.findUnique({
      where: {
        tripId_fingerprint: {
          tripId: item.tripId,
          fingerprint: item.fingerprint,
        },
      },
      select: {
        id: true,
        metadata: true,
      },
    });

    if (existing) {
      await tx.tripItem.update({
        where: { id: existing.id },
        data: {
          kind: item.kind,
          title: item.title,
          startIso: item.startIso,
          endIso: item.endIso,
          timezone: item.timezone,
          startTimezone: item.startTimezone,
          endTimezone: item.endTimezone,
          startLocalDate: item.startLocalDate,
          startLocalTime: item.startLocalTime,
          endLocalDate: item.endLocalDate,
          endLocalTime: item.endLocalTime,
          locationText: item.locationText,
          isInferred: item.isInferred,
          confidence: item.confidence,
          sourceSnippet: item.sourceSnippet,
          metadata: mergeMetadata(existing.metadata, runId, item.aiDetails),
        },
      });
    } else {
      await tx.tripItem.create({
        data: {
          trip: { connect: { id: item.tripId } },
          kind: item.kind,
          title: item.title,
          startIso: item.startIso,
          endIso: item.endIso,
          timezone: item.timezone,
          startTimezone: item.startTimezone,
          endTimezone: item.endTimezone,
          startLocalDate: item.startLocalDate,
          startLocalTime: item.startLocalTime,
          endLocalDate: item.endLocalDate,
          endLocalTime: item.endLocalTime,
          locationText: item.locationText,
          isInferred: item.isInferred,
          confidence: item.confidence,
          sourceSnippet: item.sourceSnippet,
          fingerprint: item.fingerprint,
          metadata: item.metadata ?? { lastUpdatedByRunId: runId },
          state: "PROPOSED",
          source: "AI",
        },
      });
    }
    const itemDurationMs = Date.now() - itemStartMs;
    if (itemDurationMs >= 250) {
      logger.info("Trip item upsert duration (ms)", {
        durationMs: itemDurationMs,
        fingerprint: item.fingerprint,
        kind: item.kind,
      });
    }
  }
}
