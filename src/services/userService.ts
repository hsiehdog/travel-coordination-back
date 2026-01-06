import type { IncomingHttpHeaders } from "http";
import type { Response as ExpressResponse } from "express";
import { prisma } from "../lib/prisma";
import { auth } from "../lib/auth";
import { appBaseUrl } from "../config/env";
import { headersFromExpress } from "../utils/http";

type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions?: boolean;
};

export const userService = {
  async listSessions(userId: string) {
    return prisma.aiSession.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  },

  async updateDisplayName(headers: IncomingHttpHeaders, name: string) {
    const result = await auth.api.updateUser({
      headers: headersFromExpress(headers),
      body: { name },
    });

    return { status: result?.status ?? true, name };
  },

  async changePassword(headers: IncomingHttpHeaders, body: ChangePasswordInput) {
    return auth.api.changePassword({
      headers: headersFromExpress(headers),
      body,
    });
  },

  async signOut(headers: IncomingHttpHeaders) {
    return auth.handler(
      new Request(new URL("/auth/sign-out", appBaseUrl), {
        method: "POST",
        headers: headersFromExpress(headers),
      }),
    );
  },

  async relayAuthResponse(res: ExpressResponse, response: globalThis.Response): Promise<void> {
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    res.status(response.status);

    if (response.body) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length) {
        res.send(buffer);
        return;
      }
    }

    res.end();
  },
};
