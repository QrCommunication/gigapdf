import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { api_key?: string };
    const apiKey = body.api_key;

    if (!apiKey || typeof apiKey !== "string" || !apiKey.startsWith("giga_pk_")) {
      return NextResponse.json({ valid: false }, { status: 400 });
    }

    const res = await fetch(`${API_BASE_URL}/api/v1/api-keys`, {
      method: "GET",
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
