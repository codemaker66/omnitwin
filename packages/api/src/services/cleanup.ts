import { eq, and, gt, isNull, lt, sql, notExists, inArray } from "drizzle-orm";
import { configurations, configurationViewTokens, placedObjects, enquiries, files, handoffPacks, referencePhotos } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Cleanup — removes stale public preview configurations
// ---------------------------------------------------------------------------

/**
 * Deletes public preview configurations (and their placed objects) that are:
 * - Unsaved for 72 hours (updated_at, which every save of the plan or its
 *   pieces advances; judging by created_at deleted drafts still in use)
 * - Not claimed (userId is null, isPublicPreview is true)
 * - Not linked to any enquiry
 * - Not the source of any compiled handoff pack
 * - Not shown by a working view-only link (fix-first item 11): someone the
 *   organiser sent the plan to must not find it gone. A stopped or expired
 *   link keeps nothing, and every link expires (services/plan-view-links.ts).
 *
 * The handoff rule keeps operational records. handoff_packs cascade from their
 * configuration, so deleting it would erase the hallkeeper's handoff. Where a
 * supplier pass was issued from that handoff pack, the database itself now
 * refuses the delete (0095: a pass RESTRICTs its handoff pack, a reply its
 * pass), and because this is one batch statement, a single refused row
 * would fail the whole batch and leave every abandoned preview in place.
 * The guard keeps cleanup working around those records; the keys are what
 * guarantee them. This is the only hard delete of configurations; snapshot
 * pruning already keeps snapshots a handoff pack refers to, and passes are
 * withdrawn, never deleted.
 *
 * Both guards are applied again in the DELETE itself, so a plan that gains a
 * handoff pack or a view-only link while the sweep runs is judged by the rule
 * as it stands when its row is deleted, not by the earlier read. View links go
 * with their plan (ON DELETE CASCADE).
 *
 * To run on a cron: wire into a scheduled job (e.g. node-cron, platform cron,
 * or a GitHub Actions schedule) calling POST /admin/cleanup with an admin token.
 */
export async function cleanupPreviewConfigurations(db: Database, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 72 * 60 * 60 * 1000);
  const noHandoffPack = notExists(
    db.select({ one: sql`1` })
      .from(handoffPacks)
      .where(eq(handoffPacks.configId, configurations.id)),
  );
  const noLiveViewLink = notExists(
    db.select({ one: sql`1` })
      .from(configurationViewTokens)
      .where(and(
        eq(configurationViewTokens.configurationId, configurations.id),
        isNull(configurationViewTokens.revokedAt),
        gt(configurationViewTokens.expiresAt, now),
      )),
  );

  // Inactivity, not age: every save of the plan or its pieces advances
  // updated_at, so a draft worked on all week is not deleted on its fourth
  // day. Ownerless public previews only; an owned plan is never touched.
  const abandonedPreview = and(
    eq(configurations.isPublicPreview, true),
    isNull(configurations.userId),
    lt(configurations.updatedAt, cutoff),
  );

  // Single query: find stale preview configs NOT linked to any enquiry
  // Replaces N+1 per-config enquiry existence check
  const stale = await db.select({ id: configurations.id })
    .from(configurations)
    .where(and(
      abandonedPreview,
      notExists(
        db.select({ one: sql`1` })
          .from(enquiries)
          .where(eq(enquiries.configurationId, configurations.id)),
      ),
      noHandoffPack,
      noLiveViewLink,
    ));

  if (stale.length === 0) return 0;

  const staleIds = stale.map((c) => c.id);

  // The configurations go first, under the same guards, so a plan claimed or
  // saved, a handoff pack compiled or a view-only link made since the read
  // keeps its configuration and its placed objects. Placed objects cascade
  // with their configuration; the explicit delete stays for the ones removed.
  const deleted = await db.delete(configurations)
    .where(and(inArray(configurations.id, staleIds), abandonedPreview, noHandoffPack, noLiveViewLink))
    .returning({ id: configurations.id });
  const deletedIds = deleted.map((row) => row.id);
  if (deletedIds.length > 0) {
    await db.delete(placedObjects).where(inArray(placedObjects.configurationId, deletedIds));
  }

  return deletedIds.length;
}

/** Where an upload's object lives (routes/uploads.ts `deleteUploadObject`);
 *  tests give a fake. */
export interface UploadObjectStore {
  /** Resolves true once the object is gone, false when its storage cannot be
   *  reached from here (not configured); rejects on a provider error. */
  remove(fileKey: string, visibility: "private" | "public"): Promise<boolean>;
}

export interface OrphanedFileCleanup {
  /** File rows deleted, each after its object was deleted. */
  readonly deleted: number;
  /** Orphans kept for the next run: their object could not be deleted. */
  readonly kept: number;
}

/** The most orphans one pass deletes: each is a call to the bucket made
 *  while its row is locked, so a backlog drains over a few nights. */
export const ORPHANED_FILE_BATCH = 200;

/**
 * Deletes loadout-context uploads that are older than 24 hours and have no
 * reference_photos entry, object first, then row. These are abandoned
 * presigned-URL uploads: the user received a presigned URL but never attached
 * the file to a loadout. Scoped to context='loadout' to avoid touching
 * venue/space/asset files which are referenced differently (direct URL
 * columns, not reference_photos). See F17 in audit findings.
 *
 * Deleting only the row left the object in the bucket with nothing pointing
 * at it, so the upload outlived every record of it. Now, in one transaction:
 * the orphans are locked (FOR UPDATE SKIP LOCKED: attaching a photo takes a
 * key-share lock on its file, so a file being attached is skipped, and none
 * can be attached until the pass commits), checked again for a photo, their
 * objects deleted, and only the rows whose object went are deleted. An object
 * that cannot be deleted (a provider error, or no storage configured here)
 * keeps its row, so the next run tries again and no key is forgotten.
 */
export async function cleanupOrphanedFiles(
  db: Database,
  store: UploadObjectStore,
  now: Date = new Date(),
): Promise<OrphanedFileCleanup> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  return db.transaction(async (tx) => {
    const stale = await tx.select({ id: files.id, fileKey: files.fileKey, visibility: files.visibility })
      .from(files)
      .where(and(
        eq(files.context, "loadout"),
        lt(files.uploadedAt, cutoff),
        notExists(
          tx.select({ one: sql`1` })
            .from(referencePhotos)
            .where(eq(referencePhotos.fileId, files.id)),
        ),
      ))
      .orderBy(files.uploadedAt)
      .limit(ORPHANED_FILE_BATCH)
      .for("update", { skipLocked: true });
    if (stale.length === 0) return { deleted: 0, kept: 0 };

    // Read again under the locks: a photo committed while this pass waited
    // keeps its file.
    const attached = new Set((await tx.select({ fileId: referencePhotos.fileId })
      .from(referencePhotos)
      .where(inArray(referencePhotos.fileId, stale.map((row) => row.id)))).map((row) => row.fileId));

    const gone: string[] = [];
    let kept = 0;
    for (const row of stale) {
      if (attached.has(row.id)) continue;
      let removed: boolean;
      try {
        removed = await store.remove(row.fileKey, row.visibility === "public" ? "public" : "private");
      } catch {
        removed = false;
      }
      if (removed) gone.push(row.id);
      else kept += 1;
    }

    if (gone.length > 0) await tx.delete(files).where(inArray(files.id, gone));
    return { deleted: gone.length, kept };
  });
}
