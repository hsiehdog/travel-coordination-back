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

type ReconstructServiceArgs = {
  userId: string;
  rawText: string;
  client: {
    timezone: string;
    nowIso?: string;
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

async function callModel(system: string, user: string): Promise<string> {
  const model = env.AI_MODEL;
  const { text } = await generateText({
    model: openai(model),
    system,
    prompt: user,
    // temperature: 0.2,
  });
  return text;
}

type RunData = Prisma.ReconstructRunUncheckedCreateInput;

function buildRunBase(args: ReconstructServiceArgs) {
  return {
    userId: args.userId,
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

    const parsed1 = parseJsonOrThrow(out1);
    const validated1 = TripReconstructionSchema.safeParse(parsed1);

    if (validated1.success) {
      return { ok: true, data: validated1.data, attempt1, attempt2 };
    }

    attempt1.zodIssues = validated1.error.issues;

    // Attempt 2 (repair)
    const repairPrompt = args.repairPromptBuilder({
      invalidJson: attempt1.extractedJson ?? "",
      zodIssues: validated1.error.issues,
    });

    const out2 = await callModel(args.system, repairPrompt);
    attempt2.modelOutput = out2;
    attempt2.extractedJson = safeExtractJson(out2);

    const parsed2 = parseJsonOrThrow(out2);
    const validated2 = TripReconstructionSchema.safeParse(parsed2);

    if (!validated2.success) {
      attempt2.zodIssues = validated2.error.issues;

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

  try {
    if (attempt.ok) {
      result = attempt.data;

      runData = {
        ...base,
        status: "SUCCESS",
        outputJson: result as unknown as Prisma.InputJsonValue,
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
      try {
        await prisma.reconstructRun.create({ data: runData });
      } catch (err) {
        persistError = err;
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
