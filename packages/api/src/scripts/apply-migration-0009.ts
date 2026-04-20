import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { validateEnv } from "../env.js";

const env = validateEnv();
const db = createDb(env.DATABASE_URL);

const migration = `
CREATE TABLE IF NOT EXISTS "asset_accessories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "parent_asset_id" uuid NOT NULL REFERENCES "asset_definitions"("id") ON DELETE CASCADE,
  "name" varchar(200) NOT NULL,
  "category" varchar(50) NOT NULL,
  "quantity_per_parent" integer NOT NULL DEFAULT 1,
  "phase" varchar(20) NOT NULL,
  "after_depth" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "asset_accessories_parent_idx" ON "asset_accessories" ("parent_asset_id");
`;

await db.execute(sql.raw(migration));
// eslint-disable-next-line no-console -- CLI operator signal
console.log("Migration 0009_asset_accessories applied successfully");
process.exit(0);
