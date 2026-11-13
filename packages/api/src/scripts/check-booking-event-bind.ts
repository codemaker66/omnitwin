/* eslint-disable no-console */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDbConnection } from "../db/client.js";
import { readBindInvariant } from "../services/event-binding.js";

// ---------------------------------------------------------------------------
// The bind's invariant, read once against a real database (event-spine
// Phase A; migration 0090). CI proves it on the platform database
// (booking-event-bind-postgres.test.ts); this is the operator's read of the
// same query against production after 0090 has run:
//
//   pnpm --filter @omnitwin/api exec tsx src/scripts/check-booking-event-bind.ts
//
// It opens one READ ONLY transaction with DATABASE_URL and prints:
//   unboundBookings      holds and inks without an event (must be 0)
//   contradictingEvents  events whose status disagrees with their Diary
//                        bookings (must be 0)
//   reviewList           what migration 0090 left for a person to look at,
//                        counted by reason (event_binding_reviews)
//
// Exit codes: 0 = the invariant holds; 1 = it does not; 2 = setup error.
// Nothing is written and the connection string is never printed.
// ---------------------------------------------------------------------------

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined || databaseUrl.trim() === "") {
  console.error("[bind-invariant] DATABASE_URL is not set");
  process.exit(2);
}

const connection = createDbConnection(databaseUrl);
try {
  const report = await connection.db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
    const invariant = await readBindInvariant(tx);
    const reviews = await tx.execute(sql`
      SELECT reason, count(*)::int AS count FROM event_binding_reviews GROUP BY reason ORDER BY reason
    `);
    const reviewList: Record<string, number> = {};
    for (const row of reviews.rows) {
      const reason = row["reason"];
      const count = row["count"];
      if (typeof reason === "string" && typeof count === "number") reviewList[reason] = count;
    }
    return { ...invariant, reviewList };
  });
  const holds = report.unboundBookings === 0 && report.contradictingEvents === 0;
  console.log(JSON.stringify({ status: holds ? "holds" : "broken", ...report }));
  if (!holds) process.exitCode = 1;
} catch (error: unknown) {
  // The message only: a driver error can carry connection details.
  console.error("[bind-invariant] the read failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 2;
} finally {
  await connection.close();
}
