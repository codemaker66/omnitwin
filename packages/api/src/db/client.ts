import { Pool as NeonPool } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import { drizzle as neonDrizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

// ---------------------------------------------------------------------------
// Database client — local PostgreSQL TCP or production Neon WebSocket.
//
// Both pool drivers support real multi-statement transactions. Local URLs use
// their own port directly; neither branch changes the Neon driver's globals.
// ---------------------------------------------------------------------------

/** Shared structural query/transaction contract supported by both drivers. */
export type Database = NeonDatabase<typeof schema>;

export interface DatabaseConnection {
  readonly db: Database;
  /** Drain owned pooled connections. Repeated calls share the same completion. */
  readonly close: () => Promise<void>;
}

/** A URL is local when it targets the developer's own machine. */
export function isLocalDatabaseUrl(databaseUrl: string): boolean {
  try {
    const url = new URL(databaseUrl);
    return (url.protocol === "postgres:" || url.protocol === "postgresql:")
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

/**
 * Owns the pool alongside the database, for API shutdown hooks and short-lived
 * scripts. Construction is lazy: queries establish the connection.
 */
export function createDbConnection(databaseUrl: string): DatabaseConnection {
  const local = isLocalDatabaseUrl(databaseUrl);
  const pool = local
    ? new PgPool({ connectionString: databaseUrl })
    : new NeonPool({ connectionString: databaseUrl });
  // An idle pooled client can error at any time (dropped socket, server
  // restart). Without a listener that is an unhandled 'error' event — it
  // kills the whole process (observed live in Slice 4). Log and let the
  // pool replace the client; in-flight queries fail individually.
  pool.on("error", (error) => {
    // eslint-disable-next-line no-console -- no request logger exists at pool scope; this replaces a process crash
    console.error("[db] idle client error:", error.message);
  });
  const db: Database = pool instanceof PgPool
    ? pgDrizzle(pool, { schema })
    : neonDrizzle(pool, { schema });
  let closing: Promise<void> | undefined;
  return {
    db,
    close: () => {
      closing ??= pool.end();
      return closing;
    },
  };
}

/** Existing callers can keep the database-only interface. New owners close it. */
export function createDb(databaseUrl: string): Database {
  return createDbConnection(databaseUrl).db;
}
