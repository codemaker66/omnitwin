/* eslint-disable no-console */
// ---------------------------------------------------------------------------
// Scheduled cleanup — standalone script for cron / GitHub Actions
//
// Usage:
//   DATABASE_URL=<connection-string> pnpm --filter @omnitwin/api cleanup
//
// Runs daily from .github/workflows/cleanup.yml:
//   1. Stale preview configurations (unclaimed, >72h old, no enquiry)
//   2. Orphaned uploads (loadout context, >24h old, no reference_photos link):
//      each object is deleted from its bucket, then its row. With no bucket
//      settings in the job's environment the orphans are kept and counted.
//   3. Guests' allergy notes past their retention (removeLapsedDietaryNotes):
//      from a layout and its event sheets DIETARY_NOTE_RETENTION.daysAfterEvent
//      days after the event, as the privacy policy and the planner say.
//   4. Remembered allergy notes unused for the period the client agreed to
//      (DIETARY_MEMORY_RETENTION). The words beside the "remember" box promise
//      this removal.
//   5. Engagement events older than ENGAGEMENT_RETENTION_MONTHS (migration
//      0100): the enquiry funnel keeps them no longer than the privacy page
//      keeps an enquiry, whether or not their enquiry or proposal remains.
//
// Both note passes run on the schedule, not only when someone calls
// POST /admin/cleanup, because the product promises them. Their errors carry
// a SQLSTATE only, never the note: this job's log is public with the
// repository. Neither touches object storage (PR #130 stopped storing sheet
// PDFs). The job needs DATABASE_URL, and the PRIVATE_UPLOADS_R2_* settings
// to delete orphaned uploads' objects (pass 2).
//
// Exit codes: 0 = success, 1 = error
// ---------------------------------------------------------------------------

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDb, type Database } from "../db/client.js";
import { cleanupPreviewConfigurations, cleanupOrphanedFiles, type UploadObjectStore } from "../services/cleanup.js";
import { uploadObjectStore, type UploadStorageEnv } from "../routes/uploads.js";
import { removeUnusedRememberedNotes } from "../services/dietary-memory.js";
import { removeLapsedDietaryNotes } from "../services/dietary-retention.js";
import { removeExpiredEngagementEvents } from "../services/enquiry-funnel.js";

export interface ScheduledCleanupResult {
  readonly deletedConfigs: number;
  readonly deletedFiles: number;
  /** Orphaned uploads whose object could not be deleted, kept for the next run. */
  readonly keptOrphanedFiles: number;
  /** Layouts and event sheets whose allergy note passed its retention. */
  readonly lapsedNoteLayouts: number;
  readonly lapsedNoteSheets: number;
  readonly rememberedNotesRemoved: number;
  readonly engagementEventsRemoved: number;
}

/** Every scheduled pass, in order. Each log line carries counts only. */
export async function runScheduledCleanup(
  db: Database,
  uploadObjects: UploadObjectStore,
  log: (line: string) => void = (line) => { console.log(line); },
): Promise<ScheduledCleanupResult> {
  const deletedConfigs = await cleanupPreviewConfigurations(db);
  log(`[cleanup] Deleted ${String(deletedConfigs)} stale preview configuration(s)`);

  const orphanedFiles = await cleanupOrphanedFiles(db, uploadObjects);
  log(`[cleanup] Deleted ${String(orphanedFiles.deleted)} orphaned file(s) and their stored objects; kept ${String(orphanedFiles.kept)} whose object could not be deleted`);

  const lapsed = await removeLapsedDietaryNotes(db);
  log(`[cleanup] Removed the allergy note from ${String(lapsed.layouts)} layout(s) and ${String(lapsed.sheets)} event sheet(s) past their retention`);

  const remembered = await removeUnusedRememberedNotes(db);
  log(`[cleanup] Removed ${String(remembered.removed)} remembered allergy note(s) unused for the agreed period`);

  const engagementEventsRemoved = await removeExpiredEngagementEvents(db);
  log(`[cleanup] Removed ${String(engagementEventsRemoved)} engagement event(s) past their retention period`);

  return {
    deletedConfigs,
    deletedFiles: orphanedFiles.deleted,
    keptOrphanedFiles: orphanedFiles.kept,
    lapsedNoteLayouts: lapsed.layouts,
    lapsedNoteSheets: lapsed.sheets,
    rememberedNotesRemoved: remembered.removed,
    engagementEventsRemoved,
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") {
    console.error("[cleanup] DATABASE_URL is not set");
    process.exit(1);
  }

  const db = createDb(databaseUrl);

  console.log("[cleanup] Starting scheduled cleanup...");
  await runScheduledCleanup(db, uploadObjectStore(storageEnvFrom(process.env)));
  console.log("[cleanup] Done");
  process.exit(0);
}

/** The buckets' settings from the job's environment. Without the private
 *  bucket's, orphaned uploads are kept (and counted) rather than forgotten. */
export function storageEnvFrom(source: Readonly<Record<string, string | undefined>>): UploadStorageEnv {
  const read = (name: string): string | undefined => {
    const value = source[name]?.trim();
    return value === undefined || value === "" ? undefined : value;
  };
  return {
    R2_ACCOUNT_ID: read("R2_ACCOUNT_ID"),
    R2_ACCESS_KEY_ID: read("R2_ACCESS_KEY_ID"),
    R2_SECRET_ACCESS_KEY: read("R2_SECRET_ACCESS_KEY"),
    R2_BUCKET_NAME: read("R2_BUCKET_NAME"),
    PRIVATE_UPLOADS_R2_ACCOUNT_ID: read("PRIVATE_UPLOADS_R2_ACCOUNT_ID"),
    PRIVATE_UPLOADS_R2_ACCESS_KEY_ID: read("PRIVATE_UPLOADS_R2_ACCESS_KEY_ID"),
    PRIVATE_UPLOADS_R2_SECRET_ACCESS_KEY: read("PRIVATE_UPLOADS_R2_SECRET_ACCESS_KEY"),
    PRIVATE_UPLOADS_R2_BUCKET: read("PRIVATE_UPLOADS_R2_BUCKET"),
  };
}

// Runs only as the script itself, so tests can import runScheduledCleanup.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  main().catch((err: unknown) => {
    console.error("[cleanup] Fatal error:", err);
    process.exit(1);
  });
}
