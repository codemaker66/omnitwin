import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

// ---------------------------------------------------------------------------
// Database client — Neon serverless + Drizzle ORM
// ---------------------------------------------------------------------------

/**
 * Creates a Drizzle ORM instance connected to Neon via HTTP.
 * Uses @neondatabase/serverless (HTTP/WebSocket) — not node-postgres.
 */
export function createDb(databaseUrl: string): ReturnType<typeof drizzle<typeof schema>> {
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

/** Type alias for the database instance. */
export type Database = ReturnType<typeof createDb>;
