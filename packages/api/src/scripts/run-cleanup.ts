/* eslint-disable no-console */
// ---------------------------------------------------------------------------
// Scheduled cleanup — standalone script for cron / GitHub Actions
//
// Usage:
//   DATABASE_URL=<connection-string> pnpm --filter @omnitwin/api cleanup
//
// Runs daily from .github/workflows/cleanup.yml:
//   1. Stale preview configurations (unclaimed, >72h old, no enquiry)
//   2. Orphaned file rows (loadout context, >24h old, no reference_photos link)
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
// PDFs), so the job needs only DATABASE_URL.
//
// Exit codes: 0 = success, 1 = error
// ---------------------------------------------------------------------------

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDb, type Database } from "../db/client.js";
import { cleanupPreviewConfigurations, cleanupOrphanedFiles } from "../services/cleanup.js";
import { removeUnusedRememberedNotes } from "../services/dietary-memory.js";
import { removeLapsedDietaryNotes } from "../services/dietary-retention.js";
import { removeExpiredEngagementEvents } from "../services/enquiry-funnel.js";

export interface ScheduledCleanupResult {
  readonly deletedConfigs: number;
  readonly deletedFiles: number;
  /** Layouts and event sheets whose allergy note passed its retention. */
  readonly lapsedNoteLayouts: number;
  readonly lapsedNoteSheets: number;
  /** Action log entries that still held an allergy note. */
  readonly loggedNotesRemoved: number;
  readonly rememberedNotesRemoved: number;
  readonly engagementEventsRemoved: number;
}

/** Every scheduled pass, in order. Each log line carries counts only. */
export async function runScheduledCleanup(
  db: Database,
  log: (line: string) => void = (line) => { console.log(line); },
): Promise<ScheduledCleanupResult> {
  const deletedConfigs = await cleanupPreviewConfigurations(db);
  log(`[cleanup] Deleted ${String(deletedConfigs)} stale preview configuration(s)`);

  const deletedFiles = await cleanupOrphanedFiles(db);
  log(`[cleanup] Deleted ${String(deletedFiles)} orphaned file(s)`);

  const lapsed = await removeLapsedDietaryNotes(db);
  log(`[cleanup] Removed the allergy note from ${String(lapsed.layouts)} layout(s) and ${String(lapsed.sheets)} event sheet(s) past their retention, and from ${String(lapsed.actionLog)} logged change(s)`);

  const remembered = await removeUnusedRememberedNotes(db);
  log(`[cleanup] Removed ${String(remembered.removed)} remembered allergy note(s) unused for the agreed period`);

  const engagementEventsRemoved = await removeExpiredEngagementEvents(db);
  log(`[cleanup] Removed ${String(engagementEventsRemoved)} engagement event(s) past their retention period`);

  return {
    deletedConfigs,
    deletedFiles,
    lapsedNoteLayouts: lapsed.layouts,
    lapsedNoteSheets: lapsed.sheets,
    loggedNotesRemoved: lapsed.actionLog,
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
  await runScheduledCleanup(db);
  console.log("[cleanup] Done");
  process.exit(0);
}

// Runs only as the script itself, so tests can import runScheduledCleanup.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  main().catch((err: unknown) => {
    console.error("[cleanup] Fatal error:", err);
    process.exit(1);
  });
}
