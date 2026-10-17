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
//   3. Remembered allergy notes unused for the period the client agreed to
//      (DIETARY_MEMORY_RETENTION). The words beside the "remember" box promise
//      this removal, so it runs on the schedule, not only when someone calls
//      POST /admin/cleanup. Its errors carry a SQLSTATE only, never the note.
//
// Not here: the layouts' own allergy-note removal 30 days after the event
// (removeLapsedDietaryNotes). It also removes stored event-sheet PDFs, which
// needs storage configuration this job does not have, and scheduling it is
// still Blake's decision; it runs through POST /admin/cleanup.
//
// Exit codes: 0 = success, 1 = error
// ---------------------------------------------------------------------------

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDb, type Database } from "../db/client.js";
import { cleanupPreviewConfigurations, cleanupOrphanedFiles } from "../services/cleanup.js";
import { removeUnusedRememberedNotes } from "../services/dietary-memory.js";

export interface ScheduledCleanupResult {
  readonly deletedConfigs: number;
  readonly deletedFiles: number;
  readonly rememberedNotesRemoved: number;
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

  const remembered = await removeUnusedRememberedNotes(db);
  log(`[cleanup] Removed ${String(remembered.removed)} remembered allergy note(s) unused for the agreed period`);

  return { deletedConfigs, deletedFiles, rememberedNotesRemoved: remembered.removed };
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
