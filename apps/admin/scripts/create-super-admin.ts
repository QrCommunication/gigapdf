/**
 * Create (or update) a back-office super admin.
 *
 * Usage, from apps/admin with the production environment loaded:
 *
 *   pnpm create:admin                        # prompts for email, name, password
 *   ADMIN_EMAIL=… ADMIN_NAME=… pnpm create:admin
 *   pnpm create:admin --reset-password       # existing admin: set a new password
 *
 * The password is read from the ADMIN_PASSWORD environment variable or
 * prompted for; there is no default. It is hashed with Better Auth's own
 * hasher (the one its sign-in verifies against). The previous version stored
 * a salted SHA-256 placeholder that Better Auth could never verify, and the
 * seed script it replaced created admin@gigapdf.com / "Admin123!" through the
 * public sign-up, which is now disabled.
 *
 * Idempotent: an existing admin is promoted to super_admin and marked
 * verified; its password changes only with --reset-password.
 */
import { randomUUID } from "node:crypto";
import * as readline from "node:readline";

import { hashPassword } from "better-auth/crypto";

import prisma from "../src/lib/prisma";

const CREDENTIAL_PROVIDER = "credential";
const MIN_PASSWORD_LENGTH = 12;

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  const password = await ask("Password: ");
  const confirmation = await ask("Confirm password: ");
  if (password !== confirmation) throw new Error("Passwords do not match.");
  return password;
}

async function main(): Promise<void> {
  const resetPassword = process.argv.includes("--reset-password");
  const email = (process.env.ADMIN_EMAIL || (await ask("Email: "))).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("A valid email is required.");

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  const name = existing?.name ?? (process.env.ADMIN_NAME || (await ask("Name: ")));

  let passwordHash: string | null = null;
  if (!existing || resetPassword) {
    const password = await readPassword();
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    passwordHash = await hashPassword(password);
  }

  await prisma.$transaction(async (tx) => {
    const user = existing
      ? await tx.adminUser.update({
          where: { id: existing.id },
          data: { role: "super_admin", emailVerified: true },
        })
      : await tx.adminUser.create({
          data: { id: randomUUID(), email, name, role: "super_admin", emailVerified: true },
        });

    if (passwordHash === null) return;

    const account = await tx.adminAccount.findFirst({
      where: { userId: user.id, providerId: CREDENTIAL_PROVIDER },
    });
    if (account) {
      await tx.adminAccount.update({ where: { id: account.id }, data: { password: passwordHash } });
    } else {
      await tx.adminAccount.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          accountId: user.id,
          providerId: CREDENTIAL_PROVIDER,
          password: passwordHash,
        },
      });
    }
  });

  if (!existing) console.log(`Super admin created: ${email}`);
  else if (resetPassword) console.log(`Super admin updated, password reset: ${email}`);
  else console.log(`Super admin updated (password unchanged): ${email}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
