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
