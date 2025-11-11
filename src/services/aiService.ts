import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import env from "../config/env";
import { prisma } from "../lib/prisma";

const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });

export type GenerateAiInput = {
  prompt: string;
  userId: string;
};

export const aiService = {
  async generateResponse({ prompt, userId }: GenerateAiInput) {
    const result = await generateText({
      model: openai(env.AI_MODEL),
      prompt,
    });

    const session = await prisma.aiSession.create({
      data: {
        userId,
        prompt,
        response: result.text,
        model: env.AI_MODEL,
      },
    });

    return {
      text: result.text,
      sessionId: session.id,
      model: session.model,
      createdAt: session.createdAt,
    };
  },
};
