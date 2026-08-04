import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (process.env["DATABASE_URL"] === undefined) {
  throw new Error("DATABASE_URL is required in .env for drizzle-kit");
}

// Local dev database note (Slice 4, T-518): drizzle-kit prefers the `pg`
// devDependency (plain TCP), so migrate/generate work against the local
// Postgres in infra/dev-db/ and against Neon alike. The API runtime itself
// stays on @neondatabase/serverless — see db/client.ts for the local branch.

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"],
  },
});
