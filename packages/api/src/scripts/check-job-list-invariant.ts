/* eslint-disable no-console */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDbConnection } from "../db/client.js";
import { logJobAlerts } from "../services/jobs/alerts.js";
import { isHealthy, readJobListInvariant } from "../services/jobs/invariant.js";
import { buildJobRegistry, jobErrorText } from "../services/jobs/kinds.js";
import { buildJobKinds } from "../services/jobs/runtime.js";

// ---------------------------------------------------------------------------
// The job list's release check (T-702): nothing is stuck unseen.
//
// The same read the list's daily job makes (services/jobs/invariant.ts), run
// once by hand against a real database, after the first deploy and after any
// release that changes a kind:
//
//   pnpm --filter @omnitwin/api exec tsx src/scripts/check-job-list-invariant.ts
//
// It opens one READ ONLY transaction with DATABASE_URL and prints one line of
// JSON with the four counts, each of which must be 0:
//   overdueJobs       queued, due more than 2 hours ago, of a kind this build reads
//   expiredClaims     running, whose claim ran out more than 1 hour ago
//   staleQueuedSends  email_sends queued more than 1 day ago
//   unreadableJobs    queued, of a kind or version this build does not read
//
// "This build" is the checkout it runs from: run it from the commit that is
// deployed. Exit codes: 0 = healthy; 1 = not; 2 = it could not run. Nothing is
// written and the connection string is never printed.
// ---------------------------------------------------------------------------

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined || databaseUrl.trim() === "") {
  console.error("[job-list-invariant] DATABASE_URL is not set");
  process.exit(2);
}

const silent = { info: (): void => undefined, warn: (): void => undefined, error: (): void => undefined };
const registry = buildJobRegistry(buildJobKinds(logJobAlerts(silent)).kinds);

const connection = createDbConnection(databaseUrl);
try {
  const invariant = await connection.db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
    return readJobListInvariant(tx, registry);
  });
  console.log(JSON.stringify(invariant));
  if (!isHealthy(invariant)) process.exitCode = 1;
} catch (error: unknown) {
  // Scrubbed by jobErrorText: a driver's message can quote query parameters or
  // a connection string, and both go (anything shaped like user@host does).
  // A bare role or host name in the driver's own words is not removed.
  console.error("[job-list-invariant] the read failed:", jobErrorText(error));
  process.exitCode = 2;
} finally {
  await connection.close();
}
