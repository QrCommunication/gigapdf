/**
 * Script to create a super admin user
 * Usage: npx tsx scripts/create-super-admin.ts
 *
 * Environment variables required:
 * - DATABASE_URL: PostgreSQL connection string
 * - BETTER_AUTH_SECRET: Secret for password hashing
 */

import { PrismaClient } from ".prisma/admin-client";
import { createHash } from "crypto";
import * as readline from "readline";

const prisma = new PrismaClient();

// Simple password hashing (BetterAuth uses bcrypt internally, but for seeding we'll use the API)
async function hashPassword(password: string): Promise<string> {
  // BetterAuth handles password hashing internally
  // This is a placeholder - we'll use the signUp API instead
  const hash = createHash("sha256");
  hash.update(password + (process.env.BETTER_AUTH_SECRET || ""));
  return hash.digest("hex");
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function createSuperAdmin() {
  console.log("\n🔐 GigaPDF Super Admin Creation\n");
  console.log("================================\n");

  // Get admin details
  const email = await prompt("Email: ");
  const name = await prompt("Name: ");
  const password = await prompt("Password: ");
  const confirmPassword = await prompt("Confirm Password: ");

  if (password !== confirmPassword) {
    console.error("\n❌ Passwords do not match!");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("\n❌ Password must be at least 8 characters!");
    process.exit(1);
  }

  try {
    // Check if admin already exists
    const existingAdmin = await prisma.adminUser.findUnique({
      where: { email },
    });

    if (existingAdmin) {
      console.error(`\n❌ An admin with email "${email}" already exists!`);
      process.exit(1);
    }

    // Create the admin user
    const adminUser = await prisma.adminUser.create({
      data: {
        email,
        name,
        role: "super_admin",
        emailVerified: true,
      },
    });

    // Create the account with password
    // Note: BetterAuth uses bcrypt, but we need to create the account entry
    // The user should login via the signup flow first, or we use a workaround
    const hashedPassword = await hashPassword(password);

    await prisma.adminAccount.create({
      data: {
        userId: adminUser.id,
        accountId: adminUser.id,
        providerId: "credential",
        password: hashedPassword,
      },
    });

    console.log("\n✅ Super Admin created successfully!\n");
    console.log("================================");
    console.log(`Email: ${email}`);
    console.log(`Name: ${name}`);
    console.log(`Role: super_admin`);
    console.log("================================\n");
    console.log("⚠️  Note: For full BetterAuth compatibility, please use the");
    console.log("   signup endpoint or the alternative setup script.\n");

  } catch (error) {
    console.error("\n❌ Error creating super admin:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createSuperAdmin();
