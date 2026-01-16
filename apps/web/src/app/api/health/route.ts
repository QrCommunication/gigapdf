import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (session?.user) {
      return NextResponse.json({
        authenticated: true,
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        },
      });
    }

    const response = NextResponse.json({ authenticated: false }, { status: 401 });
    response.cookies.set("__Secure-better-auth.session_token", "", { expires: new Date(0), path: "/" });
    response.cookies.set("better-auth.session_token", "", { expires: new Date(0), path: "/" });
    response.cookies.set("__Secure-better-auth.session_data", "", { expires: new Date(0), path: "/" });
    return response;
  } catch {
    const response = NextResponse.json({ authenticated: false }, { status: 500 });
    response.cookies.set("__Secure-better-auth.session_token", "", { expires: new Date(0), path: "/" });
    response.cookies.set("better-auth.session_token", "", { expires: new Date(0), path: "/" });
    response.cookies.set("__Secure-better-auth.session_data", "", { expires: new Date(0), path: "/" });
    return response;
  }
}
