import { eq, and, isNull, lt, sql } from "drizzle-orm";
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

  // Find stale preview configs not linked to any enquiry
  const stale = await db.select({ id: configurations.id })
    .from(configurations)
    .where(and(
      eq(configurations.isPublicPreview, true),
      isNull(configurations.userId),
      lt(configurations.createdAt, cutoff),
    ));

  let deleted = 0;
  for (const config of stale) {
    // Check if linked to any enquiry
    const [linked] = await db.select({ count: sql<number>`count(*)::int` })
      .from(enquiries)
      .where(eq(enquiries.configurationId, config.id));

    if ((linked?.count ?? 0) > 0) continue;

    // Delete placed objects first (cascade should handle this, but be explicit)
    await db.delete(placedObjects).where(eq(placedObjects.configurationId, config.id));
    await db.delete(configurations).where(eq(configurations.id, config.id));
    deleted++;
  }

  return deleted;
}
