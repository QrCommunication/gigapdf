import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { api_key?: string };
    const apiKey = body.api_key;

    if (
      !apiKey ||
      typeof apiKey !== "string" ||
      (!apiKey.startsWith("giga_pk_") && !apiKey.startsWith("giga_pub_"))
    ) {
      return NextResponse.json({ valid: false }, { status: 400 });
    }

    // For publishable keys, validate via embed sessions endpoint
    // For secret keys, validate via api-keys endpoint
    const validateUrl = apiKey.startsWith("giga_pub_")
      ? `${API_BASE_URL}/api/v1/embed/sessions`
      : `${API_BASE_URL}/api/v1/api-keys`;

    const res = await fetch(validateUrl, {
      method: apiKey.startsWith("giga_pub_") ? "OPTIONS" : "GET",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (res.ok) {
      return NextResponse.json({ valid: true });
    }

    return NextResponse.json({ valid: false }, { status: 401 });
  } catch {
    return NextResponse.json({ valid: false }, { status: 500 });
  }
}
