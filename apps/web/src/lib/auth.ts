import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaClient } from "@prisma/client";
import {
  sendEmail,
  getWelcomeEmailTemplate,
  getPasswordResetEmailTemplate,
  getVerificationEmailTemplate,
} from "./email/mailer";

const prisma = new PrismaClient();

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Set to true in production
    sendResetPassword: async ({ user, url }) => {
      // Get user locale preference (default to French)
      const locale = "fr";
      const { subject, html } = getPasswordResetEmailTemplate(url, locale);

      await sendEmail({
        to: user.email,
        subject,
        html,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const locale = "fr";
      const { subject, html } = getVerificationEmailTemplate(url, locale);

      await sendEmail({
        to: user.email,
        subject,
        html,
      });
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
  trustedOrigins: [
    process.env.NEXT_PUBLIC_APP_URL!,
    process.env.NEXT_PUBLIC_API_URL!,
  ].filter(Boolean),
  // JWT Configuration for FastAPI backend compatibility
  jwt: {
    enabled: true,
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    issuer: process.env.BETTER_AUTH_URL!,
    audience: [process.env.NEXT_PUBLIC_API_URL!],
  },
  // User hooks for sending welcome email
  user: {
    additionalFields: {
      locale: {
        type: "string",
        required: false,
        defaultValue: "fr",
      },
    },
  },
  // Social providers can be added here
  socialProviders: {
    // google: {
    //   clientId: process.env.GOOGLE_CLIENT_ID!,
    //   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    // },
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
