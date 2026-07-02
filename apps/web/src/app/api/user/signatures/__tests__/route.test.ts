/**
 * Tests for the saved-signatures API: GET / POST / DELETE /api/user/signatures.
 *
 * Strategy (mirrors office/export/__tests__/route.test.ts):
 *   - Mock @/lib/prisma so getPrisma() returns a stub client with vi.fn() spies
 *     for userSignature.{findMany,create,deleteMany} — no real DB is touched.
 *   - Mock @/lib/auth-helpers to control the session (authenticated by default;
 *     individual tests flip it to the 401 path).
 *   - Mock @/lib/server-logger and 'server-only' so the module imports cleanly.
 *   - Drive the handlers with plain Request / query params.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (declared before route import) ──────────────────────────────────────

vi.mock('server-only', () => ({}));

vi.mock('@/lib/auth-helpers', () => ({
  requireSession: vi.fn(),
}));

vi.mock('@/lib/server-logger', () => ({
  serverLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockFindMany = vi.fn();
const mockCreate = vi.fn();
const mockDeleteMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  getPrisma: vi.fn(() => ({
    userSignature: {
      findMany: mockFindMany,
      create: mockCreate,
      deleteMany: mockDeleteMany,
    },
  })),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET, POST, DELETE } from '../route';
import { requireSession } from '@/lib/auth-helpers';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-123';

const mockAuthOk = {
  ok: true as const,
  context: { userId: USER_ID, email: 'test@example.com', role: 'user' },
};

const mockAuthFail = {
  ok: false as const,
  response: new Response(
    JSON.stringify({ success: false, error: 'Authentication required.' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  ),
};

/** A 1×1 PNG data URL — small, valid, decodes to a few bytes. */
const SMALL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAQAB3H3XSwAAAABJRU5ErkJggg==';

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sig-1',
    kind: 'signature',
    dataUrl: SMALL_PNG,
    width: 300,
    height: 120,
    createdAt: new Date('2026-07-01T10:00:00.000Z'),
    ...overrides,
  };
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/user/signatures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deleteRequest(query = ''): Request {
  return new Request(`http://localhost/api/user/signatures${query}`, { method: 'DELETE' });
}

/** Prisma "table does not exist" error shape. */
function missingTableError(): Error & { code: string } {
  const err = new Error('The table `public.user_signatures` does not exist.') as Error & {
    code: string;
  };
  err.code = 'P2021';
  return err;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('/api/user/signatures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
  });

  // ── Auth ─────────────────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('GET returns 401 when unauthenticated', async () => {
      vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
      const res = await GET();
      expect(res.status).toBe(401);
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it('POST returns 401 when unauthenticated', async () => {
      vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
      const res = await POST(postRequest({ kind: 'signature', dataUrl: SMALL_PNG, width: 10, height: 10 }));
      expect(res.status).toBe(401);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('DELETE returns 401 when unauthenticated', async () => {
      vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
      const res = await DELETE(deleteRequest('?id=sig-1'));
      expect(res.status).toBe(401);
      expect(mockDeleteMany).not.toHaveBeenCalled();
    });
  });

  // ── GET ────────────────────────────────────────────────────────────────────

  describe('GET', () => {
    it('returns only the caller rows (filtered by userId, newest first)', async () => {
      mockFindMany.mockResolvedValue([makeRow(), makeRow({ id: 'sig-2', kind: 'initials' })]);

      const res = await GET();
      expect(res.status).toBe(200);

      // IDOR-safe: the query is scoped to the caller's userId.
      expect(mockFindMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        orderBy: { createdAt: 'desc' },
        select: expect.any(Object),
      });

      const json = await res.json();
      expect(json.signatures).toHaveLength(2);
      expect(json.signatures[0]).toEqual({
        id: 'sig-1',
        kind: 'signature',
        dataUrl: SMALL_PNG,
        width: 300,
        height: 120,
        createdAt: '2026-07-01T10:00:00.000Z',
      });
    });

    it('degrades to an empty list when the table is missing (P2021)', async () => {
      mockFindMany.mockRejectedValue(missingTableError());
      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ signatures: [] });
    });

    it('returns 500 (generic) on any other DB error', async () => {
      mockFindMany.mockRejectedValue(new Error('connection reset'));
      const res = await GET();
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Failed to load signatures.');
    });
  });

  // ── POST ───────────────────────────────────────────────────────────────────

  describe('POST', () => {
    it('rejects an invalid kind with 400', async () => {
      const res = await POST(postRequest({ kind: 'stamp', dataUrl: SMALL_PNG, width: 10, height: 10 }));
      expect(res.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rejects a non-image dataUrl with 400', async () => {
      const res = await POST(
        postRequest({ kind: 'signature', dataUrl: 'data:text/plain;base64,aGk=', width: 10, height: 10 }),
      );
      expect(res.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rejects an oversized dataUrl with 413', async () => {
      // ~2 MB of base64 → decodes to ~1.5 MB+, above MAX_DECODED_BYTES.
      const bigDataUrl = 'data:image/png;base64,' + 'A'.repeat(2_200_000);
      const res = await POST(postRequest({ kind: 'signature', dataUrl: bigDataUrl, width: 100, height: 100 }));
      expect(res.status).toBe(413);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rejects bad dimensions with 400', async () => {
      const zero = await POST(postRequest({ kind: 'signature', dataUrl: SMALL_PNG, width: 0, height: 10 }));
      expect(zero.status).toBe(400);

      const tooBig = await POST(postRequest({ kind: 'signature', dataUrl: SMALL_PNG, width: 5000, height: 10 }));
      expect(tooBig.status).toBe(400);

      const nonInt = await POST(postRequest({ kind: 'signature', dataUrl: SMALL_PNG, width: 10.5, height: 10 }));
      expect(nonInt.status).toBe(400);

      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rejects a non-JSON body with 400', async () => {
      const req = new Request('http://localhost/api/user/signatures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json{',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('creates a signature (201) scoping the row to the caller', async () => {
      mockCreate.mockResolvedValue(makeRow());

      const res = await POST(postRequest({ kind: 'signature', dataUrl: SMALL_PNG, width: 300, height: 120 }));
      expect(res.status).toBe(201);

      expect(mockCreate).toHaveBeenCalledWith({
        data: { userId: USER_ID, kind: 'signature', dataUrl: SMALL_PNG, width: 300, height: 120 },
        select: expect.any(Object),
      });

      const json = await res.json();
      expect(json.signature).toEqual({
        id: 'sig-1',
        kind: 'signature',
        dataUrl: SMALL_PNG,
        width: 300,
        height: 120,
        createdAt: '2026-07-01T10:00:00.000Z',
      });
    });

    it('accepts "initials" as a valid kind', async () => {
      mockCreate.mockResolvedValue(makeRow({ kind: 'initials' }));
      const res = await POST(postRequest({ kind: 'initials', dataUrl: SMALL_PNG, width: 120, height: 60 }));
      expect(res.status).toBe(201);
    });

    it('returns 503 when the table is missing (P2021)', async () => {
      mockCreate.mockRejectedValue(missingTableError());
      const res = await POST(postRequest({ kind: 'signature', dataUrl: SMALL_PNG, width: 100, height: 100 }));
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json).toEqual({ success: false, error: 'Signature storage is not available yet.' });
    });

    it('returns 500 (generic) on any other DB error', async () => {
      mockCreate.mockRejectedValue(new Error('deadlock detected'));
      const res = await POST(postRequest({ kind: 'signature', dataUrl: SMALL_PNG, width: 100, height: 100 }));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Failed to save signature.');
    });
  });

  // ── DELETE ───────────────────────────────────────────────────────────────────

  describe('DELETE', () => {
    it('deletes scoped by { id, userId } (IDOR-safe)', async () => {
      mockDeleteMany.mockResolvedValue({ count: 1 });

      const res = await DELETE(deleteRequest('?id=sig-1'));
      expect(res.status).toBe(200);
      expect(mockDeleteMany).toHaveBeenCalledWith({ where: { id: 'sig-1', userId: USER_ID } });

      const json = await res.json();
      expect(json).toEqual({ ok: true });
    });

    it('deleting a row the caller does not own removes zero rows but still 200', async () => {
      // deleteMany scoped by userId simply matches nothing for a foreign id.
      mockDeleteMany.mockResolvedValue({ count: 0 });

      const res = await DELETE(deleteRequest('?id=someone-elses-sig'));
      expect(res.status).toBe(200);
      expect(mockDeleteMany).toHaveBeenCalledWith({
        where: { id: 'someone-elses-sig', userId: USER_ID },
      });
      expect(await res.json()).toEqual({ ok: true });
    });

    it('returns 400 when id is missing', async () => {
      const res = await DELETE(deleteRequest());
      expect(res.status).toBe(400);
      expect(mockDeleteMany).not.toHaveBeenCalled();
    });

    it('is an idempotent no-op (200) when the table is missing (P2021)', async () => {
      mockDeleteMany.mockRejectedValue(missingTableError());
      const res = await DELETE(deleteRequest('?id=sig-1'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it('returns 500 (generic) on any other DB error', async () => {
      mockDeleteMany.mockRejectedValue(new Error('io error'));
      const res = await DELETE(deleteRequest('?id=sig-1'));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Failed to delete signature.');
    });
  });
});
