import { eq, and, gt, isNull, lt, sql, notExists, inArray } from "drizzle-orm";
import { configurations, configurationViewTokens, enquiries, files, referencePhotos } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Cleanup — removes stale public preview configurations
// ---------------------------------------------------------------------------

/**
 * Deletes public preview configurations (and their placed objects) that are:
 * - Older than 72 hours
 * - Not claimed (userId is null, isPublicPreview is true)
 * - Not linked to any enquiry
 * - Not shown by a working view-only link (fix-first item 11): someone the
 *   organiser sent the plan to must not find it gone. A stopped or expired
 *   link keeps nothing, and every link expires (services/plan-view-links.ts).
 *
 * One DELETE carries the whole rule, so a plan that gains a link while the
 * sweep runs is judged by the rule as it stands when its row is deleted, not
 * by an earlier read. Placed objects and view links go with their plan
 * (ON DELETE CASCADE).
 *
 * To run on a cron: wire into a scheduled job (e.g. node-cron, platform cron,
 * or a GitHub Actions schedule) calling POST /admin/cleanup with an admin token.
 */
export async function cleanupPreviewConfigurations(db: Database, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 72 * 60 * 60 * 1000);

  const deleted = await db.delete(configurations)
    .where(and(
      eq(configurations.isPublicPreview, true),
      isNull(configurations.userId),
      lt(configurations.createdAt, cutoff),
      notExists(
        db.select({ one: sql`1` })
          .from(enquiries)
          .where(eq(enquiries.configurationId, configurations.id)),
      ),
      notExists(
        db.select({ one: sql`1` })
          .from(configurationViewTokens)
          .where(and(
            eq(configurationViewTokens.configurationId, configurations.id),
            isNull(configurationViewTokens.revokedAt),
            gt(configurationViewTokens.expiresAt, now),
          )),
      ),
    ))
    .returning({ id: configurations.id });

  return deleted.length;
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
