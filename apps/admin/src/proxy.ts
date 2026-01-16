import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public paths that don't require authentication
  const publicPaths = ["/login", "/api/auth"];

  // Check if the path is public
  const isPublicPath = publicPaths.some((path) => pathname.startsWith(path));

  if (isPublicPath) {
    return NextResponse.next();
  }

  // Check for session cookie
  const sessionCookie = request.cookies.get("better-auth.session_token");

  if (!sessionCookie) {
    // No session, redirect to login
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Verify session by calling the auth API
  try {
    const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3001";
    const response = await fetch(`${baseUrl}/api/auth/get-session`, {
      headers: {
        cookie: `better-auth.session_token=${sessionCookie.value}`,
      },
    });

    if (!response.ok) {
      // Session invalid, redirect to login
      return NextResponse.redirect(new URL("/login", request.url));
    }

    const session = await response.json();

    if (!session || !session.user) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    // Session is valid, allow access
    return NextResponse.next();
  } catch (error) {
    console.error("Proxy auth error:", error);
    // On error, redirect to login
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (auth API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - Static assets (images, fonts, etc.)
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.gif$|.*\\.svg$|.*\\.ico$|.*\\.woff$|.*\\.woff2$).*)",
  ],
};
