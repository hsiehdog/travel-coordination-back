import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import env, { appBaseUrl, isProduction, trustedOrigins as resolvedTrustedOrigins } from "../config/env";
import prisma from "./prisma";

const baseURL = appBaseUrl;
const trustedOrigins = resolvedTrustedOrigins.length ? resolvedTrustedOrigins : [baseURL];

export const auth = betterAuth({
  appName: "AI Dashboard Backend",
  baseURL,
  basePath: "/auth",
  trustedOrigins,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
  },
  session: {
    modelName: "AuthSession",
  },
  account: {
    modelName: "AuthAccount",
  },
  verification: {
    modelName: "AuthVerification",
  },
  user: {
    modelName: "User",
    additionalFields: {
      role: {
        type: "string",
        fieldName: "role",
      },
    },
  },
  plugins: [],
  advanced: {
    disableOriginCheck: !isProduction,
  },
});

export default auth;
