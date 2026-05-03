-- ─────────────────────────────────────────────────────────────────────────────
-- font_cache — process-shared TTF cache for Type1/CFF→TTF conversions
--
-- The PDF editor's bake pipeline often hits the same embedded font across
-- many documents. Converting Type1 or CFF programs via fontforge costs
-- ~50-150 ms per call; we therefore memoise the result by SHA-256 of the
-- source font program bytes.
--
-- Idempotent: safe to re-run on every deploy. Run via:
--   psql "$DATABASE_URL" -f apps/web/prisma/manual-migrations/001_font_cache.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS font_cache (
  id              TEXT PRIMARY KEY,
  sha256          VARCHAR(64) NOT NULL UNIQUE,
  family          VARCHAR(255),
  postscript_name VARCHAR(255),
  source          VARCHAR(32) NOT NULL,
  bytes           BYTEA NOT NULL,
  byte_size       INTEGER NOT NULL,
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  hit_count       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_font_cache_last_used
  ON font_cache (last_used_at);
