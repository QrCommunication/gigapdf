/**
 * Script to seed subscription plans
 * Usage: npx tsx scripts/seed-plans.ts
 *
 * Creates the 4 default plans: free, starter, pro, enterprise
 *
 * Environment variables required:
 * - DATABASE_URL: PostgreSQL connection string
 */

import { PrismaClient } from ".prisma/admin-client";

const prisma = new PrismaClient();

// Convert GB to bytes
const GB = (n: number) => n * 1024 * 1024 * 1024;

// Plans configuration based on landing page
const PLANS = [
  {
    slug: "free",
    name: "Gratuit",
    description: "Parfait pour découvrir GigaPDF",
    price: 0,
    currency: "EUR",
    interval: "month",
    storage_limit_bytes: GB(5),
    api_calls_limit: 1000,
    document_limit: 100,
    is_tenant_plan: false,
    max_members: 1,
    features: {
      storageGb: 5,
      apiCallsPerMonth: 1000,
      basicEditing: true,
      advancedEditing: false,
      customBranding: false,
      prioritySupport: false,
      emailSupport: false,
      communitySupport: true,
      apiAccess: false,
      sla: false,
      dedicatedAccount: false,
      customIntegrations: false,
    },
    is_active: true,
    is_popular: false,
    display_order: 1,
    cta_text: "Commencer",
    trial_days: null,
  },
  {
    slug: "starter",
    name: "Démarrage",
    description: "Pour les particuliers et petites équipes",
    price: 9,
    currency: "EUR",
    interval: "month",
    storage_limit_bytes: GB(25),
    api_calls_limit: 10000,
    document_limit: 500,
    is_tenant_plan: false,
    max_members: 5,
    features: {
      storageGb: 25,
      apiCallsPerMonth: 10000,
      basicEditing: true,
      advancedEditing: true,
      customBranding: false,
      prioritySupport: false,
      emailSupport: true,
      communitySupport: true,
      apiAccess: false,
      sla: false,
      dedicatedAccount: false,
      customIntegrations: false,
    },
    is_active: true,
    is_popular: true,
    display_order: 2,
    cta_text: "Essai gratuit",
    trial_days: 14,
  },
  {
    slug: "pro",
    name: "Pro",
    description: "Pour les entreprises en croissance",
    price: 29,
    currency: "EUR",
    interval: "month",
    storage_limit_bytes: GB(100),
    api_calls_limit: 100000,
    document_limit: 2000,
    is_tenant_plan: false,
    max_members: 20,
    features: {
      storageGb: 100,
      apiCallsPerMonth: 100000,
      basicEditing: true,
      advancedEditing: true,
      customBranding: true,
      prioritySupport: true,
      emailSupport: true,
      communitySupport: true,
      apiAccess: true,
      sla: false,
      dedicatedAccount: false,
      customIntegrations: false,
    },
    is_active: true,
    is_popular: false,
    display_order: 3,
    cta_text: "Essai gratuit",
    trial_days: 14,
  },
  {
    slug: "enterprise",
    name: "Entreprise",
    description: "Pour les grandes organisations avec des besoins personnalisés",
    price: 0, // Contact sales
    currency: "EUR",
    interval: "month",
    storage_limit_bytes: -1, // Unlimited
    api_calls_limit: -1, // Unlimited
    document_limit: -1, // Unlimited
    is_tenant_plan: true,
    max_members: -1, // Unlimited
    features: {
      storageGb: -1, // Unlimited
      apiCallsPerMonth: -1, // Unlimited
      basicEditing: true,
      advancedEditing: true,
      customBranding: true,
      prioritySupport: true,
      emailSupport: true,
      communitySupport: true,
      apiAccess: true,
      sla: true,
      dedicatedAccount: true,
      customIntegrations: true,
      support247: true,
    },
    is_active: true,
    is_popular: false,
    display_order: 4,
    cta_text: "Contacter les ventes",
    trial_days: null,
  },
];

async function seedPlans() {
  console.log("\n💰 GigaPDF Plans Seeder\n");
  console.log("================================\n");

  try {
    for (const planData of PLANS) {
      // Check if plan already exists
      const existingPlan = await prisma.plans.findUnique({
        where: { slug: planData.slug },
      });

      if (existingPlan) {
        console.log(`ℹ️  Plan "${planData.name}" (${planData.slug}) already exists, updating...`);

        await prisma.plans.update({
          where: { slug: planData.slug },
          data: {
            name: planData.name,
            description: planData.description,
            price: planData.price,
            currency: planData.currency,
            interval: planData.interval,
            storage_limit_bytes: BigInt(planData.storage_limit_bytes),
            api_calls_limit: planData.api_calls_limit,
            document_limit: planData.document_limit,
            is_tenant_plan: planData.is_tenant_plan,
            max_members: planData.max_members,
            features: planData.features,
            is_active: planData.is_active,
            is_popular: planData.is_popular,
            display_order: planData.display_order,
            cta_text: planData.cta_text,
            trial_days: planData.trial_days,
            updated_at: new Date(),
          },
        });

        console.log(`✅ Plan "${planData.name}" updated.\n`);
      } else {
        await prisma.plans.create({
          data: {
            slug: planData.slug,
            name: planData.name,
            description: planData.description,
            price: planData.price,
            currency: planData.currency,
            interval: planData.interval,
            storage_limit_bytes: BigInt(planData.storage_limit_bytes),
            api_calls_limit: planData.api_calls_limit,
            document_limit: planData.document_limit,
            is_tenant_plan: planData.is_tenant_plan,
            max_members: planData.max_members,
            features: planData.features,
            is_active: planData.is_active,
            is_popular: planData.is_popular,
            display_order: planData.display_order,
            cta_text: planData.cta_text,
            trial_days: planData.trial_days,
          },
        });

        console.log(`✅ Plan "${planData.name}" created.\n`);
      }
    }

    console.log("================================");
    console.log("✅ All plans seeded successfully!\n");

    // Display summary
    console.log("📊 Plans Summary:\n");
    console.log("| Slug       | Name       | Price     | Storage  | API Calls |");
    console.log("|------------|------------|-----------|----------|-----------|");

    for (const plan of PLANS) {
      const storage =
        plan.storage_limit_bytes === -1
          ? "Illimité"
          : `${plan.storage_limit_bytes / GB(1)} Go`;
      const apiCalls =
        plan.api_calls_limit === -1
          ? "Illimité"
          : plan.api_calls_limit.toLocaleString();
      const price = plan.price === 0 ? "Gratuit" : `${plan.price}€/mois`;

      console.log(
        `| ${plan.slug.padEnd(10)} | ${plan.name.padEnd(10)} | ${price.padEnd(9)} | ${storage.padEnd(8)} | ${apiCalls.padEnd(9)} |`
      );
    }

    console.log("\n");
  } catch (error) {
    console.error("❌ Error seeding plans:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedPlans();
