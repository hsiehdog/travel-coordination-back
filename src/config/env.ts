import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url({ message: "DATABASE_URL must be a valid URL" }),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  APP_BASE_URL: z
    .string()
    .url({ message: "APP_BASE_URL must be a valid URL" })
    .optional(),
  TRUSTED_ORIGINS: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  AI_MODEL: z.string().default("gpt-5-mini"),
});

const env = envSchema.parse(process.env);

export const isProduction = env.NODE_ENV === "production";
export const appBaseUrl = env.APP_BASE_URL ?? `http://localhost:${env.PORT}`;
export const trustedOrigins = Array.from(
  new Set(
    [
      appBaseUrl,
      ...(env.TRUSTED_ORIGINS
        ? env.TRUSTED_ORIGINS.split(",")
            .map((origin) => origin.trim())
            .filter(Boolean)
        : []),
    ].filter(Boolean)
  )
);
export default env;
