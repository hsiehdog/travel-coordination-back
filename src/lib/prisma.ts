import { PrismaClient } from "@prisma/client";
import { isProduction } from "../config/env";

type GlobalPrisma = {
  prisma?: PrismaClient;
};

const globalForPrisma = globalThis as unknown as GlobalPrisma;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ["error"] : ["query", "info", "warn"],
  });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}

export default prisma;
