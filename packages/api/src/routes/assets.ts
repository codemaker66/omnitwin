import type { FastifyInstance } from "fastify";
import { assetDefinitions } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Asset definitions — public read-only endpoint
//
// GET /assets returns the full furniture catalogue from the database.
// No auth required — the catalogue is not PII. This endpoint exists so
// the web editor can verify its local catalogue against the DB and
// (in a future multi-venue world) fetch venue-specific items that weren't
// in the static seed.
//
// The response shape matches the Drizzle row directly — no Zod reshaping
// needed because the DB schema IS the contract.
// ---------------------------------------------------------------------------

export async function assetRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.get("/", async () => {
    const rows = await db.select().from(assetDefinitions).orderBy(assetDefinitions.name);
    return { data: rows };
  });
}
