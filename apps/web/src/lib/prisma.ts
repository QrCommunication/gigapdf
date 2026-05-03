/**
 * Singleton Prisma client for app-wide use outside of better-auth.
 *
 * better-auth has its own getPrismaClient() in lib/auth.ts; for everything
 * else (the apply-elements font cache, future analytics, etc.) we use this
 * module so we don't duplicate Pool/Adapter wiring or open multiple
 * connection pools per Next.js worker.
 *
 * Lazy: the client is only created on first access — keeps `next build`
 * from crashing if DATABASE_URL is missing at build time.
 */

import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

declare global {
  var __prismaClient: PrismaClient | undefined;
}

export function getPrisma(): PrismaClient {
  if (globalThis.__prismaClient) return globalThis.__prismaClient;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter });

  // Reuse across HMR reloads in dev so we don't exhaust the pool.
  if (process.env.NODE_ENV !== "production") {
    globalThis.__prismaClient = client;
  }

  return client;
}
