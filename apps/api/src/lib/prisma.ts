import { PrismaClient } from '@prisma/client';
import { env, isProd } from '../config/env';

/** Single client instance; `tsx watch` reuses it across reloads in dev. */
const globalRef = globalThis as unknown as { __flowdeskPrisma?: PrismaClient };

export const prisma =
  globalRef.__flowdeskPrisma ??
  new PrismaClient({
    log: isProd ? ['warn', 'error'] : ['warn', 'error'],
    datasources: { db: { url: env.DATABASE_URL } },
  });

if (!isProd) globalRef.__flowdeskPrisma = prisma;

export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
