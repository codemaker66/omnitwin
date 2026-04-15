/* eslint-disable no-console */
// ---------------------------------------------------------------------------
// Scheduled cleanup — standalone script for cron / GitHub Actions
//
// Usage:
//   DATABASE_URL=<connection-string> pnpm --filter @omnitwin/api cleanup
//
// Runs both cleanup tasks:
//   1. Stale preview configurations (unclaimed, >72h old, no enquiry)
//   2. Orphaned file rows (loadout context, >24h old, no reference_photos link)
//
// Exit codes: 0 = success, 1 = error
// ---------------------------------------------------------------------------

import { createDb } from "../db/client.js";
import { cleanupPreviewConfigurations, cleanupOrphanedFiles } from "../services/cleanup.js";

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") {
    console.error("[cleanup] DATABASE_URL is not set");
    process.exit(1);
  }

  const db = createDb(databaseUrl);

  console.log("[cleanup] Starting scheduled cleanup...");

  const deletedConfigs = await cleanupPreviewConfigurations(db);
  console.log(`[cleanup] Deleted ${String(deletedConfigs)} stale preview configuration(s)`);

  const deletedFiles = await cleanupOrphanedFiles(db);
  console.log(`[cleanup] Deleted ${String(deletedFiles)} orphaned file(s)`);

  console.log("[cleanup] Done");
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("[cleanup] Fatal error:", err);
  process.exit(1);
});
