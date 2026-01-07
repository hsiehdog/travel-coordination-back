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
import env from "../config/env";

type ReconstructServiceArgs = {
  userId: string;
  rawText: string;
  client: {
    timezone: string;
    nowIso?: string;
  };
};

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function safeExtractJson(text: string): string {
  // Models sometimes wrap JSON in fences; strip them if present.
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  // Attempt to find first { ... last }
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
  } catch (e) {
    const err: any = new Error("Model did not return valid JSON.");
    err.code = "INVALID_MODEL_JSON";
    err.httpStatus = 502;
    err.publicMessage =
      "The AI response could not be parsed. Please try again.";
    err.modelOutput = text;
    throw err;
  }
}

async function callModel(system: string, user: string): Promise<string> {
  const model = env.AI_MODEL;
  // console.log(`Calling model ${model}...`);
  // console.log("System prompt:", system);
  // console.log("User prompt:", user);
  const { text } = await generateText({
    model: openai(model),
    system,
    prompt: user,
    // temperature: 0.2,
  });
  return text;
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

  let outputText = await callModel(system, userPrompt);
  // console.log("Model output:");
  // console.dir(outputText, { depth: null, maxArrayLength: null });
  let parsed = parseJsonOrThrow(outputText);
  // console.log("Parsed JSON:");
  // console.dir(parsed, { depth: null, maxArrayLength: null });
  let validated = TripReconstructionSchema.safeParse(parsed);
  // console.log("Validation result:", validated);

  if (!validated.success) {
    // One repair attempt
    const repairPrompt = buildRepairPrompt({
      clientTimezone: args.client.timezone,
      nowIso: args.client.nowIso,
      rawText: args.rawText,
      invalidJson: safeExtractJson(outputText),
      zodIssues: validated.error.issues,
    });

    outputText = await callModel(system, repairPrompt);

    parsed = parseJsonOrThrow(outputText);
    validated = TripReconstructionSchema.safeParse(parsed);

    if (!validated.success) {
      const err: any = new Error(
        "Model output did not match schema after repair."
      );
      err.code = "SCHEMA_VALIDATION_FAILED";
      err.httpStatus = 502;
      err.publicMessage =
        "The AI output couldn’t be validated. Please try again.";
      err.details = z.treeifyError(validated.error);
      throw err;
    }
  }

  const result = validated.data;

  // Minimal DB write: one row per run
  // (Make sure you added ReconstructRun model as discussed.)
  await prisma.reconstructRun.create({
    data: {
      userId: args.userId,
      status: "SUCCESS",
      timezone: args.client.timezone,
      nowIso: args.client.nowIso ?? null,
      rawText: args.rawText,
      outputJson: result as any,
    },
  });

  return result;
}
