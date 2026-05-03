/**
 * Prisma adapter for the pdf-engine FontCachePort.
 *
 * Wraps the `font_cache` table so the engine can call `get(sha)` /
 * `set(sha, bytes, meta)` without ever touching Prisma directly. The
 * engine layer stays DB-agnostic.
 *
 * On HIT we increment `hit_count` and bump `last_used_at` so we have a
 * usage signal to drive future LRU pruning. The bump happens AFTER the
 * read returns, so it never blocks the bake pipeline.
 */

import "server-only";
import type { FontCachePort, FontCacheMeta } from "@giga-pdf/pdf-engine";
import { getPrisma } from "@/lib/prisma";
import { serverLogger } from "@/lib/server-logger";

export function createFontCacheDbAdapter(): FontCachePort {
  return {
    async get(sha256) {
      const prisma = getPrisma();
      const row = await prisma.font_cache.findUnique({
        where: { sha256 },
        select: { id: true, bytes: true },
      });
      if (!row) return null;

      // Fire-and-forget update — don't block the bake on the bookkeeping.
      void prisma.font_cache
        .update({
          where: { id: row.id },
          data: {
            hit_count: { increment: 1 },
            last_used_at: new Date(),
          },
        })
        .catch((err: unknown) => {
          serverLogger.warn(
            "font_cache hit-count update failed (non-fatal)",
            {
              error: err instanceof Error ? err.message : String(err),
              sha256: sha256.slice(0, 12),
            },
          );
        });

      return new Uint8Array(row.bytes);
    },

    async set(sha256, ttfBytes, meta: FontCacheMeta) {
      const prisma = getPrisma();
      const buffer = Buffer.from(ttfBytes);
      // upsert handles concurrent bakes that race on the same hash —
      // sha256 is UNIQUE so the second call no-ops the data fields.
      await prisma.font_cache.upsert({
        where: { sha256 },
        create: {
          sha256,
          family: meta.family,
          postscript_name: meta.postscriptName,
          source: meta.source,
          bytes: buffer,
          byte_size: buffer.byteLength,
        },
        update: {
          // Non-data fields only — never overwrite the bytes once cached.
          last_used_at: new Date(),
        },
      });
    },
  };
}
