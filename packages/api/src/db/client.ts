import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

// ---------------------------------------------------------------------------
// Database client — Neon serverless + Drizzle ORM
// ---------------------------------------------------------------------------

/** Type alias for the database instance (avoids heavy generic expansion). */
export type Database = NeonHttpDatabase<typeof schema>;

/**
 * Creates a Drizzle ORM instance connected to Neon via HTTP.
 * Uses @neondatabase/serverless (HTTP/WebSocket) — not node-postgres.
 */
export function createDb(databaseUrl: string): Database {
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}
