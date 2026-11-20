import { createDbConnection } from "../db/client.js";
import { checkEventRules, describeFailure, exitCodeOf, isFailedJoin } from "../services/event-rules-check.js";

// ---------------------------------------------------------------------------
// The event rules, read against a real database: the operator's command, and
// the one the nightly Event rules workflow runs with --join
// (.github/workflows/event-rules.yml). The check itself is
// services/event-rules-check.ts, proved on throwaway databases by
// event-rules-check-postgres.test.ts, which also runs this command.
//
//   pnpm --filter @omnitwin/api exec tsx src/scripts/check-booking-event-bind.ts [--join]
//
// With --join it first runs spine_join_old_records() in a transaction of its
// own, with short limits, so that records made since the last run are joined
// to their events. That join is the command's only write; a join that fails
// rolls back whole and the read still runs.
//
// It prints one line of JSON:
//   status               "holds" when the two bind counts and the nine spine
//                        counts are all zero, "broken" when one is not, and
//                        "unread" when the read failed (then readError says
//                        why, and the counts are absent)
//   unboundBookings      holds and inks without an event
//   contradictingEvents  events whose status disagrees with their Diary bookings
//   proposalsWithoutEvent ... eventDealPointersInUse
//                        the spine's nine counts (readSpineInvariant)
//   reviewList           what migration 0090 left for a person to look at,
//                        counted by reason (event_binding_reviews)
//   joinsToCheck         the open questions on the list of joins to check,
//                        counted by reason (event_link_reviews, October's
//                        copied questions among them)
//   migrations           { applied, local, pending }: the migrations ledger
//                        against the journal this code ships, so a stale or
//                        half-migrated database shows itself
//   joinRun              with --join only: { joined, eventsMade, listed }, or
//                        { error } when the join failed
// reviewList and joinsToCheck are information and never change the status:
// a question that matters already shows in a count.
//
// Exit codes: 0 = the rules hold (and the join, when asked for, ran);
// 1 = a count is not zero, or the join failed though the counts were read;
// 2 = setup error (no DATABASE_URL, an unknown argument) or the read failed.
// Neither the connection string nor a database error's message is printed:
// a failure is named by its error's name and its SQLSTATE (or system code),
// because the workflow's log is public with the repository. An undefined
// function, table or column is said in plain words: the spine's migration is
// not applied to this database.
//
// main runs unconditionally: this file is only ever a command, so nothing
// can make it exit 0 without having run.
// ---------------------------------------------------------------------------

async function main(args: readonly string[]): Promise<void> {
  if (args.some((arg) => arg !== "--join")) {
    process.stderr.write("[event-rules] the only argument is --join\n");
    process.exitCode = 2;
    return;
  }
  // dotenv never overrides a variable that is already set.
  await import("dotenv/config");
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    process.stderr.write("[event-rules] DATABASE_URL is not set\n");
    process.exitCode = 2;
    return;
  }
  const connection = createDbConnection(databaseUrl);
  try {
    const outcome = await checkEventRules(connection.db, { join: args.includes("--join") });
    if (isFailedJoin(outcome.joinRun)) {
      process.stderr.write(`[event-rules] the join failed and was rolled back: ${outcome.joinRun.error}\n`);
    }
    if (outcome.status === "unread") {
      process.stderr.write(`[event-rules] the read failed: ${outcome.readError}\n`);
    }
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
    process.exitCode = exitCodeOf(outcome);
  } finally {
    try {
      await connection.close();
    } catch (error: unknown) {
      // The name and code only: a driver error can carry connection details.
      process.stderr.write(`[event-rules] closing the connection failed: ${describeFailure(error)}\n`);
    }
  }
}

await main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`[event-rules] the check failed: ${describeFailure(error)}\n`);
  process.exitCode = 2;
});
