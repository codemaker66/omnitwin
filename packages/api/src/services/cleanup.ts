import { eq, and, gt, isNull, lt, sql, notExists, inArray } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  assumptionRecords, canonicalLayoutSnapshots, checkResults, claimStates, configurationReviewHistory,
  configurationSheetSnapshots, configurations, configurationViewTokens, enquiries, eventArchitectCandidates,
  eventArchitectOpsReviews, eventArchitectRuns, eventConfigurationLinks, eventPlanChanges, evidenceItems,
  evidencePacks, files, guestFlowReplays, guestFlowScenarios, hallkeeperProgress, handoffPacks, layoutVariants,
  navmeshVersions, phaseLayoutSnapshots, photoReferences, placedObjects, proposals, referencePhotos,
  revenueScenarios, reviewGates, staleEvidenceEvents,
} from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Cleanup — removes stale public preview configurations
// ---------------------------------------------------------------------------

/**
 * The keys that make a plan somebody's work. A row under any of them keeps
 * its plan from the preview sweep, however long the plan has gone unsaved.
 *
 * An ownerless public preview is not only a visitor's abandoned draft. The
 * venue can link one to an event, put it in a proposal, review and approve
 * it, compile it and study it, all without giving it an owner, and a plan in
 * the venue's work can never be claimed (routes/claim-config.ts). An approval
 * is not a save either, so such a plan soon looks unsaved for 72 hours.
 * Deleting it would delete those rows with it (ON DELETE CASCADE), leave them
 * without their layout (SET NULL), or be refused by the database (RESTRICT,
 * NO ACTION, a frozen phase snapshot's trigger). The sweep is one batch
 * statement, so a single refused row fails the whole batch, and with it the
 * retention passes that run after it (scripts/run-cleanup.ts).
 *
 * Every foreign key into configurations is either here or one of the plan's
 * own pieces, which go with it: placed_objects,
 * configuration_layout_revisions, layout_aliases,
 * configuration_claim_secrets, review_sessions, action_log and
 * configuration_view_tokens (only a working link keeps a plan, below).
 * remembered_dietary_notes outlives the layout it was saved from by design.
 * preview-sweep-kept-postgres.test.ts reads the keys from the catalogue and
 * fails when a new one has no meaning there: add a table that points at a
 * plan to this list unless its rows are the plan's own pieces.
 */
export const PLAN_KEPT_BY: readonly AnyPgColumn[] = [
  // Sent to the venue, and compiled for the day.
  enquiries.configurationId,
  handoffPacks.configId,
  // Linked to an event, or put in a proposal.
  eventConfigurationLinks.configurationId,
  layoutVariants.configurationId,
  phaseLayoutSnapshots.configurationId,
  eventPlanChanges.configurationId,
  proposals.configurationId,
  revenueScenarios.configurationId,
  // Reviewed or approved: the sheet versions, the review trail, the ticks.
  configurationSheetSnapshots.configurationId,
  configurationReviewHistory.configurationId,
  hallkeeperProgress.configId,
  // Evidence compiled from it.
  canonicalLayoutSnapshots.configurationId,
  evidenceItems.configId,
  checkResults.configId,
  assumptionRecords.configId,
  reviewGates.configId,
  claimStates.configId,
  evidencePacks.configId,
  staleEvidenceEvents.configId,
  // Guest flow studies and Event Architect runs.
  guestFlowScenarios.configurationId,
  navmeshVersions.configurationId,
  guestFlowReplays.configurationId,
  eventArchitectRuns.selectedConfigurationId,
  eventArchitectCandidates.configurationId,
  eventArchitectOpsReviews.configurationId,
  // Nothing writes this table now; its key refuses the delete.
  photoReferences.configurationId,
];

/**
 * Deletes public preview configurations (and their placed objects) that are:
 * - Unsaved for more than 72 hours (updated_at, which every save the planner
 *   makes of a plan or its pieces advances; judging by created_at deleted
 *   drafts still in use)
 * - Not claimed (userId is null, isPublicPreview is true)
 * - In nobody's work: no row under any key in PLAN_KEPT_BY (an enquiry, a
 *   handoff pack, an event link, a proposal, a review, an approved sheet …)
 * - Not shown by a working view-only link (fix-first item 11): someone the
 *   organiser sent the plan to must not find it gone. A stopped or expired
 *   link keeps nothing, and every link expires (services/plan-view-links.ts).
 *   View links go with their plan (ON DELETE CASCADE).
 *
 * This is the only hard delete of configurations. The rule keeps operational
 * records, and keeps cleanup working around the ones the database guards
 * itself (0095: a supplier pass RESTRICTs its handoff pack, a reply its pass;
 * snapshot pruning keeps snapshots a handoff pack refers to, and passes are
 * withdrawn, never deleted). The keys are what guarantee those records.
 *
 * The candidates are read under row locks, in one transaction with the
 * DELETE, which judges them again. Whatever would give a plan a use (an
 * enquiry, an event link, a review, a claim, a save) needs that row: it has
 * either committed before the lock, so the DELETE sees it and keeps the plan,
 * or it waits and finds the plan gone. A plan whose row someone holds as the
 * sweep reads is left for the next run (SKIP LOCKED). Judging again in the
 * DELETE alone was not enough: it judged by what was committed when the
 * statement began, so an event link committed while the DELETE waited for
 * the plan's row was deleted with the plan.
 *
 * To run on a cron: wire into a scheduled job (e.g. node-cron, platform cron,
 * or a GitHub Actions schedule) calling POST /admin/cleanup with an admin token.
 */
export async function cleanupPreviewConfigurations(db: Database, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 72 * 60 * 60 * 1000);
  const inNobodysWork = and(...PLAN_KEPT_BY.map((key) => (
    sql`NOT EXISTS (SELECT 1 FROM ${key.table} WHERE ${key} = ${configurations.id})`
  )));
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
    inNobodysWork,
    noLiveViewLink,
  );

  return db.transaction(async (tx) => {
    const stale = await tx.select({ id: configurations.id })
      .from(configurations)
      .where(abandonedPreview)
      .for("update", { skipLocked: true });

    if (stale.length === 0) return 0;

    const staleIds = stale.map((c) => c.id);

    // The configurations go first, under the whole rule again, so a plan
    // claimed or saved, or given a use, before its row was locked keeps its
    // configuration and its placed objects. Placed objects cascade with their
    // configuration; the explicit delete stays for the ones removed.
    const deleted = await tx.delete(configurations)
      .where(and(inArray(configurations.id, staleIds), abandonedPreview))
      .returning({ id: configurations.id });
    const deletedIds = deleted.map((row) => row.id);
    if (deletedIds.length > 0) {
      await tx.delete(placedObjects).where(inArray(placedObjects.configurationId, deletedIds));
    }

    return deletedIds.length;
  });
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
