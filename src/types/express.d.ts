import { User as PrismaUser } from "@prisma/client";

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface User extends Omit<PrismaUser, "aiSessions" | "authSessions" | "accounts"> {}
    interface Request {
      user?: Express.User;
    }
  }
}

export {};
