/**
 * Auth helpers for API route handlers.
 *
 * ARCHITECTURE NOTE: The Next.js middleware (proxy.ts / middleware.ts) explicitly
 * excludes all /api/* routes from its matcher. Every route under /api/ is
 * responsible for its own authentication via requireSession().
 *
 * DO NOT add /api/* to the middleware matcher without first ensuring the route
 * calls requireSession().
 */

import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthContext = {
  userId: string;
  email: string;
  role: string;
};

type RequireSessionSuccess = { ok: true; context: AuthContext };
type RequireSessionFailure = { ok: false; response: Response };
export type RequireSessionResult = RequireSessionSuccess | RequireSessionFailure;

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Validates the Better Auth session for the current request.
 *
 * Reads the session from the incoming request headers (supports both session
 * cookies and Authorization Bearer tokens via the Better Auth `expo` plugin).
 *
 * Usage:
 *   const authResult = await requireSession();
 *   if (!authResult.ok) return authResult.response;
 *   const { userId } = authResult.context;
 *
 * Returns:
 *   { ok: true,  context: { userId, email, role } } — authenticated
 *   { ok: false, response: Response(401) }           — unauthenticated
 */
export async function requireSession(): Promise<RequireSessionResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: 'Authentication required.' },
          { status: 401 },
        ),
      };
    }

    const user = session.user as {
      id: string;
      email: string;
      role?: string;
    };

    return {
      ok: true,
      context: {
        userId: user.id,
        email: user.email,
        role: user.role ?? 'user',
      },
    };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 },
      ),
    };
  }
}

// ─── Internal service-to-service auth ───────────────────────────────────────

/**
 * Checks whether the request carries the shared internal-service secret.
 *
 * Some routes must be callable both by authenticated users AND by trusted
 * backend services that have no user session — notably the Celery export
 * worker rendering pages via POST /api/pdf/preview. The worker sends the
 * secret in the `X-Internal-Secret` header; it must match `INTERNAL_API_SECRET`.
 *
 * Fail-closed: returns false when the secret is unset or too short, so the
 * caller falls back to requireSession() and the route never becomes public.
 * Uses a constant-time comparison to avoid timing attacks.
 */
export function isInternalServiceRequest(request: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected || expected.length < 16) return false;

  const provided = request.headers.get('x-internal-secret');
  if (!provided) return false;

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}
