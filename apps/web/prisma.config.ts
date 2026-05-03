import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),

  // Prisma 7 needs an explicit URL for `db push` / `migrate dev`. Reading
  // from process.env at config-load time keeps it consistent with the
  // datasource{} block in schema.prisma (`url = env("DATABASE_URL")`).
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },

  migrate: {
    async adapter() {
      const { PrismaPg } = await import("@prisma/adapter-pg");
      const { Pool } = await import("pg");

      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        throw new Error("DATABASE_URL environment variable is not set");
      }

      const pool = new Pool({ connectionString });
      return new PrismaPg(pool);
    },
  },
});
