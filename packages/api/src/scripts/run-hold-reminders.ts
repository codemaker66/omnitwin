/* eslint-disable no-console */
import "dotenv/config";
import { createDb } from "../db/client.js";
import { runHoldReminderPass } from "../services/hold-reminders.js";

// ---------------------------------------------------------------------------
// CRON-RUN: the hold-reminder delivery pass (T-527, Slice 7).
// Runbook: docs/operations/diary-first-week-operations.md §reminders.
//
// The admin endpoint (POST /admin/diary/hold-reminders) requires a signed-in
// platform admin — a scheduler cannot be one, so this script is the cron
// path: it calls the same service directly with DATABASE_URL from the
// environment. Safe to run repeatedly — sends dedupe on the email_sends
// unique idempotency key (hold-reminder:{bookingId}:t-{n}), so overlapping
// or repeated crons cannot double-send.
//
//   pnpm --filter @omnitwin/api exec tsx src/scripts/run-hold-reminders.ts            # real pass
//   pnpm --filter @omnitwin/api exec tsx src/scripts/run-hold-reminders.ts --dry-run  # report only
//
// Exit codes: 0 = pass completed with no failures (including nothing due);
// 1 = one or more sends failed (lets cron alerting fire); 2 = setup error.
// Without RESEND_API_KEY the email service records dev_mode rows instead of
// sending — the pass still "succeeds", so production must set the key.
// ---------------------------------------------------------------------------

const dryRun = process.argv.includes("--dry-run");

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined || databaseUrl === "") {
  console.error("[hold-reminders] DATABASE_URL is not set");
  process.exit(2);
}

const consoleLogger = {
  info: (obj: Record<string, unknown>, msg?: string): void => {
    console.log("[hold-reminders]", msg ?? "", JSON.stringify(obj));
  },
  warn: (obj: Record<string, unknown>, msg?: string): void => {
    console.warn("[hold-reminders]", msg ?? "", JSON.stringify(obj));
  },
  error: (obj: Record<string, unknown>, msg?: string): void => {
    console.error("[hold-reminders]", msg ?? "", JSON.stringify(obj));
  },
};

try {
  const db = createDb(databaseUrl);
  const summary = await runHoldReminderPass({ db, dryRun, logger: consoleLogger });
  console.log(
    "[hold-reminders] pass complete:",
    JSON.stringify({
      dryRun: summary.dryRun,
      scanned: summary.scanned,
      due: summary.due,
      sent: summary.sent,
      failed: summary.failed,
      reminders: summary.reminders,
    }),
  );
  process.exit(summary.failed > 0 ? 1 : 0);
} catch (err) {
  console.error(
    "[hold-reminders] pass crashed:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(2);
}
