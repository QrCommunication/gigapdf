import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { expo } from "@better-auth/expo";
import { jwt } from "better-auth/plugins/jwt";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  sendEmail,
  getWelcomeEmailTemplate,
  getPasswordResetEmailTemplate,
  getVerificationEmailTemplate,
} from "./email/mailer";

// Lazy initialization for Prisma client (server-side only)
// This prevents the module from crashing when imported on the client side
let prisma: PrismaClient | undefined;

function getPrismaClient(): PrismaClient {
  if (prisma) return prisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });

  return prisma;
}

export const auth = betterAuth({
  database: prismaAdapter(getPrismaClient(), {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      try {
        // Get user locale preference (default to French)
        const locale = (user as { locale?: string }).locale || "fr";
        const { subject, html } = getPasswordResetEmailTemplate(url, locale);

        await sendEmail({
          to: user.email,
          subject,
          html,
        });
      } catch (error) {
        // Log but don't throw - email failure shouldn't block reset flow
        console.error("Failed to send password reset email:", error);
      }
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      try {
        // Get user locale preference (default to French)
        const locale = (user as { locale?: string }).locale || "fr";
        const { subject, html } = getVerificationEmailTemplate(url, locale);

        await sendEmail({
          to: user.email,
          subject,
          html,
        });
      } catch (error) {
        // Log but don't throw - email failure shouldn't block signup
        console.error("Failed to send verification email:", error);
      }
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
  // Plugins: Expo pour le support mobile + JWT pour l'authentification API
  plugins: [
    expo(),
    jwt({
      jwks: {
        keyPairConfig: {
          alg: "RS256",
        },
      },
    }),
  ],
  trustedOrigins: [
    process.env.NEXT_PUBLIC_APP_URL!,
    process.env.NEXT_PUBLIC_API_URL!,
    // Mobile app schemes
    "gigapdf://",
    "gigapdf://*",
    // Expo development
    ...(process.env.NODE_ENV === "development"
      ? ["exp://*/*", "exp://192.168.*.*:*/*", "exp://localhost:*/*"]
      : []),
  ].filter(Boolean),
  // User hooks for sending welcome email
  user: {
    additionalFields: {
      locale: {
        type: "string",
        required: false,
        defaultValue: "fr",
      },
      is_admin: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
    },
  },
  // Social providers
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    // github: {
    //   clientId: process.env.GITHUB_CLIENT_ID!,
    //   clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    // },
  },
});

// Export function to send welcome email (called from sign-up handler)
export async function sendWelcomeEmail(email: string, name: string, locale: string = "fr") {
  const { subject, html } = getWelcomeEmailTemplate(name, locale);
  return sendEmail({ to: email, subject, html });
}

export type Session = typeof auth.$Infer.Session;
