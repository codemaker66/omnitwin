import type { FastifyInstance } from "fastify";
import type { Database } from "../db/client.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { cleanupPreviewConfigurations, cleanupOrphanedFiles } from "../services/cleanup.js";

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
    const deletedConfigs = await cleanupPreviewConfigurations(db);
    const deletedFiles = await cleanupOrphanedFiles(db);
    return {
      data: {
        deletedConfigs,
        deletedFiles,
        message: `Cleaned up ${String(deletedConfigs)} stale preview configuration(s) and ${String(deletedFiles)} orphaned file(s)`,
      },
    };
  });
}
