import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./prisma";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  // Map BetterAuth models to our admin-specific tables
  user: {
    modelName: "AdminUser",
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "admin",
      },
    },
  },
  account: {
    modelName: "AdminAccount",
  },
  session: {
    modelName: "AdminSession",
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
  trustedOrigins: [
    process.env.NEXT_PUBLIC_ADMIN_URL!,
    process.env.NEXT_PUBLIC_API_URL!,
  ].filter(Boolean),
});

export type Session = typeof auth.$Infer.Session;

// Helper function to check if user is super admin
export async function requireSuperAdmin(userId: string): Promise<boolean> {
  try {
    const user = await prisma.adminUser.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    return user?.role === "super_admin";
  } catch {
    return false;
  }
}

// Helper function to get current session from headers
export async function getSession(headers: Headers) {
  const session = await auth.api.getSession({
    headers,
  });
  return session;
}
