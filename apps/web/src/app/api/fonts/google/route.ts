/**
 * Google Fonts Resolution Route
 *
 * GET /api/fonts/google?name={postscriptName}&weight={100-900}&italic={0|1}
 *
 * Resolves a PostScript/BaseFont name against the Google Fonts API and
 * returns the TTF bytes (base64) of the closest variant. The download is
 * server-side (engine `downloadGoogleFont`) with a write-through Prisma
 * `font_cache` adapter, so repeated lookups never hit Google twice.
 *
 * Query params:
 *   name   — required, 1-128 chars, charset [\w\s+,.-] (PostScript names,
 *            subset prefixes "ABCDEF+..." included)
 *   weight — optional integer 100-900 (overrides the name-derived weight)
 *   italic — optional "0" | "1" (overrides the name-derived style)
 *
 * Responses (always 200 on a completed lookup):
 *   { success: true, data: { found: false } }
 *   { success: true, data: { found: true, family, weight, style,
 *                            format: "ttf", mimeType: "font/ttf", dataBase64 } }
 *
 * Errors:
 *   400 — invalid name / weight / italic
 *   401 — unauthenticated
 *   500 — unhandled error
 */

import { NextResponse } from 'next/server';
import { downloadGoogleFont } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { createFontCacheDbAdapter } from '@/lib/font-cache-db';
import { serverLogger } from '@/lib/server-logger';

// ── Constants ─────────────────────────────────────────────────────────────────

const NAME_MAX_LENGTH = 128;

/** PostScript names: word chars, spaces, subset "+", commas, dots, hyphens. */
const NAME_PATTERN = /^[\w\s+,.-]+$/;

const WEIGHT_MIN = 100;
const WEIGHT_MAX = 900;

/** Lookups are stable for a given (name, weight, italic) → 1h private cache. */
const CACHE_CONTROL = 'private, max-age=3600';

// ── Validation helpers ────────────────────────────────────────────────────────

type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

function validateName(raw: string | null): Validated<string> {
  if (raw === null || raw.length === 0) {
    return { ok: false, error: 'Missing required query param: name.' };
  }
  if (raw.length > NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Invalid name: must be 1-${NAME_MAX_LENGTH} characters.`,
    };
  }
  if (!NAME_PATTERN.test(raw)) {
    return {
      ok: false,
      error: 'Invalid name: only letters, digits, spaces, "+", ",", "." and "-" are allowed.',
    };
  }
  return { ok: true, value: raw };
}

function validateWeight(raw: string | null): Validated<number | undefined> {
  if (raw === null) return { ok: true, value: undefined };
  if (!/^\d+$/.test(raw)) {
    return { ok: false, error: 'Invalid weight: must be an integer.' };
  }
  const weight = Number.parseInt(raw, 10);
  if (weight < WEIGHT_MIN || weight > WEIGHT_MAX) {
    return {
      ok: false,
      error: `Invalid weight: must be between ${WEIGHT_MIN} and ${WEIGHT_MAX}.`,
    };
  }
  return { ok: true, value: weight };
}

function validateItalic(raw: string | null): Validated<boolean | undefined> {
  if (raw === null) return { ok: true, value: undefined };
  if (raw !== '0' && raw !== '1') {
    return { ok: false, error: 'Invalid italic: must be "0" or "1".' };
  }
  return { ok: true, value: raw === '1' };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  const { userId } = authResult.context;

  try {
    const { searchParams } = new URL(request.url);

    const name = validateName(searchParams.get('name'));
    if (!name.ok) {
      return NextResponse.json(
        { success: false, error: name.error },
        { status: 400 },
      );
    }

    const weight = validateWeight(searchParams.get('weight'));
    if (!weight.ok) {
      return NextResponse.json(
        { success: false, error: weight.error },
        { status: 400 },
      );
    }

    const italic = validateItalic(searchParams.get('italic'));
    if (!italic.ok) {
      return NextResponse.json(
        { success: false, error: italic.error },
        { status: 400 },
      );
    }

    const result = await downloadGoogleFont(
      {
        name: name.value,
        ...(weight.value !== undefined ? { weight: weight.value } : {}),
        ...(italic.value !== undefined ? { italic: italic.value } : {}),
      },
      { cache: createFontCacheDbAdapter() },
    );

    if (!result.found) {
      serverLogger.info('[api/fonts/google] Font not found on Google Fonts', {
        userId,
        name: name.value,
      });
      return NextResponse.json(
        { success: true, data: { found: false } },
        { status: 200, headers: { 'Cache-Control': CACHE_CONTROL } },
      );
    }

    serverLogger.info('[api/fonts/google] Font resolved via Google Fonts', {
      userId,
      name: name.value,
      family: result.family,
      weight: result.weight,
      style: result.style,
      byteLength: result.bytes.byteLength,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          found: true,
          family: result.family,
          weight: result.weight,
          style: result.style,
          format: 'ttf',
          mimeType: 'font/ttf',
          dataBase64: Buffer.from(result.bytes).toString('base64'),
        },
      },
      { status: 200, headers: { 'Cache-Control': CACHE_CONTROL } },
    );
  } catch (error: unknown) {
    serverLogger.error('[api/fonts/google] Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred during font resolution.' },
      { status: 500 },
    );
  }
}
