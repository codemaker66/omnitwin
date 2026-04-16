import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { validateEnv } from "../env.js";

const env = validateEnv();
const db = createDb(env.DATABASE_URL);

const migration = `
CREATE TABLE IF NOT EXISTS "hallkeeper_progress" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "config_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
  "row_key" varchar(300) NOT NULL,
  "checked_by" uuid REFERENCES "users"("id"),
  "checked_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "hallkeeper_progress_config_row_unique" UNIQUE ("config_id", "row_key")
);

CREATE INDEX IF NOT EXISTS "hallkeeper_progress_config_idx" ON "hallkeeper_progress" ("config_id");
`;

await db.execute(sql.raw(migration));
console.log("Migration 0010_hallkeeper_progress applied successfully");
process.exit(0);
