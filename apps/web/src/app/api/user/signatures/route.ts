/**
 * Saved signatures API — the "Fill & Sign" reusable stamp store.
 *
 *   GET    /api/user/signatures            → 200 { signatures: UserSignature[] }  (newest first)
 *   POST   /api/user/signatures            → 201 { signature: UserSignature }
 *   DELETE /api/user/signatures?id=<uuid>  → 200 { ok: true }
 *
 * A UserSignature is:
 *   { id, kind: "signature"|"initials", dataUrl, width, height, createdAt }
 *
 * Security:
 *   - Every handler authenticates via requireSession(); no session ⇒ 401.
 *   - IDOR-safe: GET filters `where: { userId }`; DELETE uses deleteMany with
 *     `{ id, userId }`, so a caller can never read or delete another user's row.
 *   - The dataUrl is never written to logs.
 *
 * Resilience:
 *   The shared Postgres database may not have the `user_signatures` table yet —
 *   it is created later via a one-time additive `prisma db push`. Until then,
 *   Prisma raises P2021 ("table does not exist"); we degrade gracefully instead
 *   of 500-ing (GET → empty list, POST → 503, DELETE → idempotent no-op).
 */

import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-helpers';
import { getPrisma } from '@/lib/prisma';
import { serverLogger } from '@/lib/server-logger';

// ─── Contract ─────────────────────────────────────────────────────────────────

const SIGNATURE_KINDS = ['signature', 'initials'] as const;
type SignatureKind = (typeof SIGNATURE_KINDS)[number];

/** Max decoded image size accepted for a stored signature. */
const MAX_DECODED_BYTES = Math.floor(1.5 * 1024 * 1024); // 1.5 MB
/** Signatures are small stamps — cap either dimension well below page rasters. */
const MAX_DIMENSION = 4000;
/**
 * Hard cap on the raw request body BEFORE parsing (base64 inflates the decoded
 * cap by ~4/3, plus the JSON envelope). Rejected via Content-Length so a client
 * can't force a large in-memory buffer before the decoded-size check runs.
 */
const MAX_REQUEST_BYTES = 3 * 1024 * 1024; // 3 MB
/**
 * Only accept BASE64-encoded RASTER images (png/jpeg/webp). Rejecting `svg+xml`
 * and non-base64 `data:` URLs keeps a stored signature a plain bitmap — no markup
 * that a future non-canvas render path could treat as active content — and keeps
 * the decoded-size math (which assumes base64) exact.
 */
const RASTER_DATA_URL = /^data:image\/(png|jpeg|webp);base64,/;

type UserSignatureRow = {
  id: string;
  kind: string;
  dataUrl: string;
  width: number;
  height: number;
  createdAt: Date;
};

type UserSignatureDTO = {
  id: string;
  kind: SignatureKind;
  dataUrl: string;
  width: number;
  height: number;
  createdAt: string;
};

const SELECT = {
  id: true,
  kind: true,
  dataUrl: true,
  width: true,
  height: true,
  createdAt: true,
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function jsonError(message: string, status: number): Response {
  return NextResponse.json({ success: false, error: message }, { status });
}

function serialize(row: UserSignatureRow): UserSignatureDTO {
  return {
    id: row.id,
    kind: row.kind as SignatureKind,
    dataUrl: row.dataUrl,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

/**
 * True when Prisma reports the underlying table is missing (P2021). This lets
 * the route degrade gracefully before the one-time `prisma db push` has run.
 */
function isMissingTableError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2021'
  );
}

/** Non-leaking error metadata for logs — never carries the dataUrl or query. */
function safeErrorMeta(error: unknown): Record<string, unknown> {
  if (typeof error === 'object' && error !== null) {
    const e = error as { name?: unknown; code?: unknown };
    return {
      name: typeof e.name === 'string' ? e.name : undefined,
      code: typeof e.code === 'string' ? e.code : undefined,
    };
  }
  return { name: typeof error };
}

function isPositiveIntWithinMax(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_DIMENSION;
}

/**
 * Decoded byte length of a `data:image/...;base64,<payload>` URL, derived from
 * the base64 payload length (4 base64 chars ⇒ 3 bytes, minus padding). Cheaper
 * and safer than actually decoding a potentially large buffer.
 */
function decodedByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const base64 = dataUrl.slice(comma + 1).replace(/\s/g, '');
  const len = base64.length;
  if (len === 0) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

type CreateBody = { kind: SignatureKind; dataUrl: string; width: number; height: number };
type ValidationResult =
  | { ok: true; value: CreateBody }
  | { ok: false; response: Response };

function validateCreateBody(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, response: jsonError('Request body must be a JSON object.', 400) };
  }

  const { kind, dataUrl, width, height } = body as Record<string, unknown>;

  if (typeof kind !== 'string' || !SIGNATURE_KINDS.includes(kind as SignatureKind)) {
    return { ok: false, response: jsonError('Field "kind" must be one of: signature, initials.', 400) };
  }

  if (typeof dataUrl !== 'string' || !RASTER_DATA_URL.test(dataUrl)) {
    return {
      ok: false,
      response: jsonError('Field "dataUrl" must be a base64 data:image/(png|jpeg|webp) URL.', 400),
    };
  }

  if (decodedByteLength(dataUrl) > MAX_DECODED_BYTES) {
    return { ok: false, response: jsonError('Signature image is too large (max 1.5 MB).', 413) };
  }

  if (!isPositiveIntWithinMax(width) || !isPositiveIntWithinMax(height)) {
    return {
      ok: false,
      response: jsonError(`Fields "width" and "height" must be positive integers <= ${MAX_DIMENSION}.`, 400),
    };
  }

  return { ok: true, value: { kind: kind as SignatureKind, dataUrl, width, height } };
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult.context;

  const prisma = getPrisma();
  try {
    const rows = (await prisma.userSignature.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: SELECT,
    })) as UserSignatureRow[];

    return NextResponse.json({ signatures: rows.map(serialize) });
  } catch (error: unknown) {
    if (isMissingTableError(error)) {
      // Table not provisioned yet — behave as if the user has no signatures.
      return NextResponse.json({ signatures: [] });
    }
    serverLogger.error('api.user.signatures.get', safeErrorMeta(error));
    return jsonError('Failed to load signatures.', 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult.context;

  // Reject an oversized body via Content-Length BEFORE buffering it into memory
  // (App Router route handlers impose no default body-size limit).
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonError('Request body too large.', 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Request body must be valid JSON.', 400);
  }

  const validation = validateCreateBody(body);
  if (!validation.ok) return validation.response;
  const { kind, dataUrl, width, height } = validation.value;

  const prisma = getPrisma();
  try {
    const row = (await prisma.userSignature.create({
      data: { userId, kind, dataUrl, width, height },
      select: SELECT,
    })) as UserSignatureRow;

    return NextResponse.json({ signature: serialize(row) }, { status: 201 });
  } catch (error: unknown) {
    if (isMissingTableError(error)) {
      return jsonError('Signature storage is not available yet.', 503);
    }
    // NB: never log `dataUrl` (or the raw error, which may echo the query).
    serverLogger.error('api.user.signatures.post', safeErrorMeta(error));
    return jsonError('Failed to save signature.', 500);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult.context;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return jsonError('Missing required query parameter: id.', 400);
  }

  const prisma = getPrisma();
  try {
    // deleteMany scoped by { id, userId } → deleting a row the caller does not
    // own affects zero rows (IDOR-safe) and never leaks its existence.
    await prisma.userSignature.deleteMany({ where: { id, userId } });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (isMissingTableError(error)) {
      // Nothing can exist yet — treat as an idempotent no-op delete.
      return NextResponse.json({ ok: true });
    }
    serverLogger.error('api.user.signatures.delete', safeErrorMeta(error));
    return jsonError('Failed to delete signature.', 500);
  }
}
