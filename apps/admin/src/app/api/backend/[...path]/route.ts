import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = (
  process.env.PYTHON_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000"
).replace(/\/+$/, "");

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const sessionCookie =
    request.cookies.get("__Secure-better-auth.session_token") ||
    request.cookies.get("better-auth.session_token");

  if (!sessionCookie) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { path } = await params;
  if (path.some((segment) => !segment || segment === "." || segment === "..")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const endpoint = path.map(encodeURIComponent).join("/");
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${sessionCookie.value}`);
  headers.set("X-Admin-Session", "1");
  for (const header of [
    "accept-encoding",
    "connection",
    "content-length",
    "cookie",
    "host",
    "origin",
  ]) {
    headers.delete(header);
  }

  try {
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      cache: "no-store",
      redirect: "manual",
      duplex: "half",
    };
    const response = await fetch(`${API_BASE_URL}/${endpoint}${request.nextUrl.search}`, init);
    const responseHeaders = new Headers(response.headers);
    for (const header of [
      "connection",
      "content-encoding",
      "content-length",
      "set-cookie",
      "transfer-encoding",
    ]) {
      responseHeaders.delete(header);
    }
    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Admin API proxy failed", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Upstream request failed" }, { status: 502 });
  }
}

export {
  proxyRequest as DELETE,
  proxyRequest as GET,
  proxyRequest as HEAD,
  proxyRequest as OPTIONS,
  proxyRequest as PATCH,
  proxyRequest as POST,
  proxyRequest as PUT,
};
