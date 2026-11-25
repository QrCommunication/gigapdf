import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reset-password"),
    password: z.string().min(12).max(128),
  }),
  z.object({ action: z.literal("verify-email") }),
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
): Promise<Response> {
  const session = await getSession(request.headers);
  if (!session?.user || session.user.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action or password (12–128 characters)" }, { status: 400 });
  }

  const { userId } = await params;
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (parsed.data.action === "verify-email") {
    await prisma.users.update({ where: { id: userId }, data: { emailVerified: true } });
    return NextResponse.json({ success: true });
  }

  const password = await bcrypt.hash(parsed.data.password, 12);
  const updated = await prisma.accounts.updateMany({
    where: { userId, providerId: "credential" },
    data: { password },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "No credential account found" }, { status: 409 });
  }
  await prisma.sessions.deleteMany({ where: { userId } });
  return NextResponse.json({ success: true });
}
