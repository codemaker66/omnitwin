import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema.js";

// ---------------------------------------------------------------------------
// Database client — Neon serverless (WebSocket) + Drizzle ORM
//
// Uses the WebSocket-based Pool driver instead of HTTP. This enables
// db.transaction() for atomic multi-statement operations (batch save).
//
// Local development: the serverless driver cannot speak plain Postgres TCP,
// so a localhost DATABASE_URL is routed through the Neon proxy container in
// infra/dev-db/docker-compose.yml. This branch is inert for every non-local
// URL — production Neon connections are untouched.
// ---------------------------------------------------------------------------

/** Host port of the neon-proxy service in infra/dev-db/docker-compose.yml. */
const LOCAL_WS_PROXY_PORT = 54331;

/** Type alias for the database instance. */
export type Database = NeonDatabase<typeof schema>;

/** A URL is local when it targets the developer's own machine. */
export function isLocalDatabaseUrl(databaseUrl: string): boolean {
  try {
    const host = new URL(databaseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Creates a Drizzle ORM instance connected to Neon via WebSocket Pool.
 * Supports db.transaction() for atomic operations.
 */
export function createDb(databaseUrl: string): Database {
  if (isLocalDatabaseUrl(databaseUrl)) {
    neonConfig.wsProxy = (host) => `${host}:${String(LOCAL_WS_PROXY_PORT)}/v1`;
    neonConfig.useSecureWebSocket = false;
    neonConfig.pipelineTLS = false;
    neonConfig.pipelineConnect = false;
  } else {
    // neonConfig is a module singleton — restore the driver defaults so a
    // process that mixed localities (tests, tools) is deterministic per call.
    neonConfig.wsProxy = undefined;
    neonConfig.useSecureWebSocket = true;
    neonConfig.pipelineTLS = true;
    neonConfig.pipelineConnect = "password";
  }
  const pool = new Pool({ connectionString: databaseUrl });
  // An idle pooled client can error at any time (dropped socket, server
  // restart). Without a listener that is an unhandled 'error' event — it
  // kills the whole process (observed live in Slice 4). Log and let the
  // pool replace the client; in-flight queries fail individually.
  pool.on("error", (error) => {
    // eslint-disable-next-line no-console -- no request logger exists at pool scope; this replaces a process crash
    console.error("[db] idle client error:", error.message);
  });
  return drizzle(pool, { schema });
}
