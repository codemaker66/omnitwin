import { Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema.js";

// ---------------------------------------------------------------------------
// Database client — Neon serverless (WebSocket) + Drizzle ORM
//
// Uses the WebSocket-based Pool driver instead of HTTP. This enables
// db.transaction() for atomic multi-statement operations (batch save).
// ---------------------------------------------------------------------------

/** Type alias for the database instance. */
export type Database = NeonDatabase<typeof schema>;

/**
 * Creates a Drizzle ORM instance connected to Neon via WebSocket Pool.
 * Supports db.transaction() for atomic operations.
 */
export function createDb(databaseUrl: string): Database {
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzle(pool, { schema });
}
