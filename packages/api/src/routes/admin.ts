import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { cleanupPreviewConfigurations, cleanupOrphanedFiles } from "../services/cleanup.js";
import {
  DEFAULT_SNAPSHOT_RETENTION,
  pruneArchivedConfigSnapshots,
  pruneSnapshotsForConfig,
} from "../services/sheet-snapshot.js";

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

  // -------------------------------------------------------------------------
  // POST /admin/prune-snapshots — retention for `configuration_sheet_snapshots`
  //
  // Two modes:
  //   - body.configId absent   → prune across EVERY archived config
  //   - body.configId present  → prune just that config (admin override
  //                               for an explicit ask)
  //
  // Non-archived configs are never touched by the global-mode path;
  // see the `pruneArchivedConfigSnapshots` comment for rationale.
  // Retention count defaults to 3 (see `DEFAULT_SNAPSHOT_RETENTION`);
  // operators can override via body.keep.
  //
  // Idempotent: re-running produces deleted=0 on the second pass.
  // -------------------------------------------------------------------------

  const PruneBody = z.object({
    configId: z.string().uuid().optional(),
    keep: z.number().int().min(1).max(100).optional(),
  });

  server.post("/prune-snapshots", {
    preHandler: [authenticate, authorize("admin")],
  }, async (request, reply) => {
    const body = PruneBody.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid body",
        code: "VALIDATION_ERROR",
        details: body.error.issues,
      });
    }
    const keep = body.data.keep ?? DEFAULT_SNAPSHOT_RETENTION;
    const result = body.data.configId !== undefined
      ? await pruneSnapshotsForConfig(db, body.data.configId, keep)
      : await pruneArchivedConfigSnapshots(db, keep);
    return {
      data: {
        scope: body.data.configId !== undefined ? "single-config" : "all-archived",
        configId: body.data.configId ?? null,
        keep,
        deleted: result.deleted,
        kept: result.kept,
      },
    };
  });
}
