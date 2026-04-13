import { eq, and, isNull, lt, sql, notExists, inArray } from "drizzle-orm";
import { configurations, placedObjects, enquiries } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Cleanup — removes stale public preview configurations
// ---------------------------------------------------------------------------

/**
 * Deletes public preview configurations (and their placed objects) that are:
 * - Older than 72 hours
 * - Not claimed (userId is null, isPublicPreview is true)
 * - Not linked to any enquiry
 *
 * To run on a cron: wire into a scheduled job (e.g. node-cron, Fly.io cron,
 * or a GitHub Actions schedule) calling POST /admin/cleanup with an admin token.
 */
export async function cleanupPreviewConfigurations(db: Database): Promise<number> {
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);

  // Single query: find stale preview configs NOT linked to any enquiry
  // Replaces N+1 per-config enquiry existence check
  const stale = await db.select({ id: configurations.id })
    .from(configurations)
    .where(and(
      eq(configurations.isPublicPreview, true),
      isNull(configurations.userId),
      lt(configurations.createdAt, cutoff),
      notExists(
        db.select({ one: sql`1` })
          .from(enquiries)
          .where(eq(enquiries.configurationId, configurations.id)),
      ),
    ));

  if (stale.length === 0) return 0;

  const staleIds = stale.map((c) => c.id);

  // Batch delete: placed objects first (cascade exists but be explicit), then configs
  await db.delete(placedObjects).where(inArray(placedObjects.configurationId, staleIds));
  await db.delete(configurations).where(inArray(configurations.id, staleIds));

  return stale.length;
}
