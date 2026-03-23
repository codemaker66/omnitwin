import type { FastifyInstance } from "fastify";
import type { Database } from "../db/client.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { cleanupPreviewConfigurations } from "../services/cleanup.js";

// ---------------------------------------------------------------------------
// Plugin — admin-only endpoints
// ---------------------------------------------------------------------------

export async function adminRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // POST /admin/cleanup — trigger manual cleanup of stale preview configs
  server.post("/cleanup", {
    preHandler: [authenticate, authorize("admin")],
  }, async () => {
    const deletedCount = await cleanupPreviewConfigurations(db);
    return { data: { deletedCount, message: `Cleaned up ${String(deletedCount)} stale preview configuration(s)` } };
  });
}
