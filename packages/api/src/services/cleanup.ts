import { eq, and, isNull, lt, sql, notExists, inArray } from "drizzle-orm";
import { configurations, placedObjects, enquiries, files, handoffPacks, referencePhotos } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Cleanup — removes stale public preview configurations
// ---------------------------------------------------------------------------

/**
 * Deletes public preview configurations (and their placed objects) that are:
 * - Older than 72 hours
 * - Not claimed (userId is null, isPublicPreview is true)
 * - Not linked to any enquiry
 * - Not the source of any compiled handoff pack
 *
 * The last rule keeps operational records. handoff_packs cascade from their
 * configuration, supplier passes (supplier_coordination_packs) cascade from
 * the handoff pack, and a supplier's acknowledgements cascade from the pass,
 * so deleting the configuration would erase what a supplier was told and
 * what they confirmed. This is the only hard delete of configurations;
 * snapshot pruning already keeps snapshots a handoff pack refers to, and
 * passes are withdrawn, never deleted. The foreign keys still cascade at the
 * database level: changing them needs a migration (a decision left for
 * Blake), so this guard is what holds the records today.
 *
 * To run on a cron: wire into a scheduled job (e.g. node-cron, platform cron,
 * or a GitHub Actions schedule) calling POST /admin/cleanup with an admin token.
 */
export async function cleanupPreviewConfigurations(db: Database): Promise<number> {
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const noHandoffPack = notExists(
    db.select({ one: sql`1` })
      .from(handoffPacks)
      .where(eq(handoffPacks.configId, configurations.id)),
  );

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
      noHandoffPack,
    ));

  if (stale.length === 0) return 0;

  const staleIds = stale.map((c) => c.id);

  // The configurations go first, under the same guard, so a handoff pack
  // compiled since the read keeps its configuration and its placed objects.
  // Placed objects cascade with their configuration; the explicit delete
  // stays for the ones removed.
  const deleted = await db.delete(configurations)
    .where(and(inArray(configurations.id, staleIds), noHandoffPack))
    .returning({ id: configurations.id });
  const deletedIds = deleted.map((row) => row.id);
  if (deletedIds.length > 0) {
    await db.delete(placedObjects).where(inArray(placedObjects.configurationId, deletedIds));
  }

  return deletedIds.length;
}

/**
 * Deletes loadout-context file records that are older than 24 hours and have
 * no corresponding reference_photos entry. These are abandoned presigned-URL
 * uploads: the user received a presigned URL but never attached the file to a
 * loadout. Scoped to context='loadout' to avoid touching venue/space/asset
 * files which are referenced differently (direct URL columns, not reference_photos).
 *
 * See F17 in audit findings.
 */
export async function cleanupOrphanedFiles(db: Database): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const stale = await db.select({ id: files.id })
    .from(files)
    .where(and(
      eq(files.context, "loadout"),
      lt(files.uploadedAt, cutoff),
      notExists(
        db.select({ one: sql`1` })
          .from(referencePhotos)
          .where(eq(referencePhotos.fileId, files.id)),
      ),
    ));

  if (stale.length === 0) return 0;

  const staleIds = stale.map((f) => f.id);
  await db.delete(files).where(inArray(files.id, staleIds));

  return stale.length;
}
