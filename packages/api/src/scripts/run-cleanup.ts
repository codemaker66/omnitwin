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
//   6. Field web vitals older than WEB_VITAL_RETENTION_DAYS (goal 07).
//
// Both note passes run on the schedule, not only when someone calls
// POST /admin/cleanup, because the product promises them. Their errors carry
// a SQLSTATE only, never the note: this job's log is public with the
// repository. Neither touches object storage (PR #130 stopped storing sheet
// PDFs), so the job needs only DATABASE_URL.
//
// Each pass runs even when an earlier one fails, and the job then exits 1.
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
import { removeExpiredWebVitalSamples } from "../services/web-vitals.js";

export interface ScheduledCleanupResult {
  readonly deletedConfigs: number;
  readonly deletedFiles: number;
  /** Layouts and event sheets whose allergy note passed its retention. */
  readonly lapsedNoteLayouts: number;
  readonly lapsedNoteSheets: number;
  /** Action log entries that still held an allergy note. */
  readonly loggedNotesRemoved: number;
  /** Layouts whose notes on single pieces passed their retention. */
  readonly lapsedPieceNoteLayouts: number;
  readonly rememberedNotesRemoved: number;
  readonly engagementEventsRemoved: number;
  readonly webVitalSamplesRemoved: number;
}

/**
 * Every scheduled pass, in order. Each log line carries counts only. A pass
 * runs even when one before it failed, so one broken pass never holds back
 * another's retention promise (the allergy notes', the web vitals' 90 days);
 * the job still fails, after the last pass, with the failure (or, when
 * several failed, an AggregateError of them all).
 */
export async function runScheduledCleanup(
  db: Database,
  log: (line: string) => void = (line) => { console.log(line); },
): Promise<ScheduledCleanupResult> {
  const failures: unknown[] = [];
  async function pass<T>(name: string, run: () => Promise<T>): Promise<T | undefined> {
    try {
      return await run();
    } catch (error) {
      failures.push(error);
      // The pass's name only: an error may hold what it was removing.
      log(`[cleanup] The ${name} pass failed; the passes after it still run`);
      return undefined;
    }
  }

  const deletedConfigs = await pass("stale preview configuration", async () => {
    const count = await cleanupPreviewConfigurations(db);
    log(`[cleanup] Deleted ${String(count)} stale preview configuration(s)`);
    return count;
  });

  const deletedFiles = await pass("orphaned file", async () => {
    const count = await cleanupOrphanedFiles(db);
    log(`[cleanup] Deleted ${String(count)} orphaned file(s)`);
    return count;
  });

  const lapsed = await pass("allergy note retention", async () => {
    const result = await removeLapsedDietaryNotes(db);
    log(`[cleanup] Removed the allergy note from ${String(result.layouts)} layout(s) and ${String(result.sheets)} event sheet(s) past their retention, and from ${String(result.actionLog)} logged change(s)`);
    log(`[cleanup] Removed the notes on single pieces from ${String(result.pieceNotes.layouts)} layout(s) past their retention`);
    return result;
  });

  const remembered = await pass("remembered allergy note", async () => {
    const result = await removeUnusedRememberedNotes(db);
    log(`[cleanup] Removed ${String(result.removed)} remembered allergy note(s) unused for the agreed period`);
    return result;
  });

  const engagementEventsRemoved = await pass("engagement event retention", async () => {
    const count = await removeExpiredEngagementEvents(db);
    log(`[cleanup] Removed ${String(count)} engagement event(s) past their retention period`);
    return count;
  });

  const webVitalSamplesRemoved = await pass("web vital retention", async () => {
    const count = await removeExpiredWebVitalSamples(db);
    log(`[cleanup] Removed ${String(count)} web vital sample(s) past their retention period`);
    return count;
  });

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, `${String(failures.length)} cleanup passes failed`);

  // Every pass ran, so every count is here.
  return {
    deletedConfigs: deletedConfigs ?? 0,
    deletedFiles: deletedFiles ?? 0,
    lapsedNoteLayouts: lapsed?.layouts ?? 0,
    lapsedNoteSheets: lapsed?.sheets ?? 0,
    loggedNotesRemoved: lapsed?.actionLog ?? 0,
    lapsedPieceNoteLayouts: lapsed?.pieceNotes.layouts ?? 0,
    rememberedNotesRemoved: remembered?.removed ?? 0,
    engagementEventsRemoved: engagementEventsRemoved ?? 0,
    webVitalSamplesRemoved: webVitalSamplesRemoved ?? 0,
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
