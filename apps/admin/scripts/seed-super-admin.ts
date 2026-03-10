/**
 * Script to seed a super admin user using BetterAuth API
 * Usage: npx tsx scripts/seed-super-admin.ts
 *
 * This script uses the BetterAuth signUp API to create a properly hashed user,
 * then updates the role to super_admin.
 *
 * Environment variables required:
 * - DATABASE_URL: PostgreSQL connection string
 * - BETTER_AUTH_URL: BetterAuth server URL (default: http://localhost:3001)
 */

import { PrismaClient } from ".prisma/admin-client";

const prisma = new PrismaClient();

// Default super admin credentials
const DEFAULT_ADMIN = {
  email: "admin@gigapdf.com",
  password: "Admin123!",
  name: "Super Admin",
};

async function seedSuperAdmin() {
  console.log("\n🔐 GigaPDF Super Admin Seeder\n");
  console.log("================================\n");

  const email = process.env.ADMIN_EMAIL || DEFAULT_ADMIN.email;
  const password = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN.password;
  const name = process.env.ADMIN_NAME || DEFAULT_ADMIN.name;

  try {
    // Check if admin already exists
    const existingAdmin = await prisma.adminUser.findUnique({
      where: { email },
    });

    if (existingAdmin) {
      console.log(`ℹ️  Admin with email "${email}" already exists.`);

      // Update to super_admin if not already
      if (existingAdmin.role !== "super_admin") {
        await prisma.adminUser.update({
          where: { id: existingAdmin.id },
          data: { role: "super_admin" },
        });
        console.log("✅ Updated role to super_admin.\n");
      } else {
        console.log("✅ Already a super_admin.\n");
      }

      return;
    }

    // Use the BetterAuth signup API to create user with properly hashed password
    const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3001";

    console.log(`📡 Creating admin via BetterAuth API at ${baseUrl}...\n`);

    const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        name,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create admin: ${error}`);
    }

    // Update the user role to super_admin
    const createdUser = await prisma.adminUser.findUnique({
      where: { email },
    });

    if (createdUser) {
      await prisma.adminUser.update({
        where: { id: createdUser.id },
        data: { role: "super_admin" },
      });
    }

    console.log("✅ Super Admin created successfully!\n");
    console.log("================================");
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    console.log(`Name: ${name}`);
    console.log(`Role: super_admin`);
    console.log("================================\n");
    console.log("🔒 Please change the password after first login!\n");

  } catch (error) {
    // If the API is not available, create directly in DB
    console.log("⚠️  BetterAuth API not available, creating directly in DB...\n");

    try {
      // Import bcrypt for password hashing
      const bcryptModule = await import("bcryptjs").catch(() => null);

      if (!bcryptModule) {
        console.error("❌ bcryptjs not installed. Run: pnpm add bcryptjs @types/bcryptjs");
        console.log("\nAlternatively, start the admin server and run this script again.");
        process.exit(1);
      }

      const bcrypt = bcryptModule.default || bcryptModule;
      const hashedPassword = await bcrypt.hash(password, 10);

      const adminUser = await prisma.adminUser.create({
        data: {
          email,
          name,
          role: "super_admin",
          emailVerified: true,
        },
      });

      await prisma.adminAccount.create({
        data: {
          userId: adminUser.id,
          accountId: adminUser.id,
          providerId: "credential",
          password: hashedPassword,
        },
      });

      console.log("✅ Super Admin created successfully!\n");
      console.log("================================");
      console.log(`Email: ${email}`);
      console.log(`Password: ${password}`);
      console.log(`Name: ${name}`);
      console.log(`Role: super_admin`);
      console.log("================================\n");
      console.log("🔒 Please change the password after first login!\n");

    } catch (dbError) {
      console.error("❌ Error creating admin:", dbError);
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

seedSuperAdmin();
