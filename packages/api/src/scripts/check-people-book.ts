import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { NON_BOOKING_ENQUIRY_TYPES } from "@omnitwin/types";
import { createDbConnection } from "../db/client.js";

// ---------------------------------------------------------------------------
// The People Book's backfill, read once against a real database (T-665,
// migration 0095). CI proves it on the platform database
// (check-people-book-postgres.test.ts); this is the operator's read of the
// same query against a rehearsal copy or, with approval, production after
// 0095 has run:
//
//   pnpm --filter @omnitwin/api exec tsx src/scripts/check-people-book.ts
//
// It opens one READ ONLY transaction with DATABASE_URL and prints one JSON
// line of counts. mustBeZero:
//   mirrorMismatches    live people with points or memberships whose email,
//                       phone or client_account_id is not their primary
//                       email's or phone's display value or their primary
//                       live membership's account
//   primaryViolations   people with points of a kind but not exactly one
//                       primary of it, or memberships but not exactly one
//                       primary membership
//   crossVenueLinks     enquiries whose person is at another venue
// counts: what there is, for comparing with what was expected. Among them
// peopleWithoutPoints, live people with an email or phone mirror but no
// points: what the previous release writes in the pre-deploy window, so a
// count, not a failure; and unlinkedWithOneHolder, the venue's client
// enquiries with no person whose email exactly one live person holds.
//
// Exit codes: 0 = every mustBeZero count is 0; 1 = one is not; 2 = setup
// error. Nothing is written, and no name, email, phone or connection string
// is printed.
// ---------------------------------------------------------------------------

/** What the check reads through: the database or a transaction on it. */
export interface PeopleBookReader {
  execute(query: SQL): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export interface PeopleBookCheck {
  readonly mustBeZero: {
    readonly mirrorMismatches: number;
    readonly primaryViolations: number;
    readonly crossVenueLinks: number;
  };
  readonly counts: {
    readonly livePeople: number;
    readonly peopleWithoutPoints: number;
    readonly contactPoints: number;
    readonly memberships: number;
    /** Live client accounts of each kind. */
    readonly households: number;
    readonly organisations: number;
    /** Enquiries of any kind that name a person. */
    readonly linkedEnquiries: number;
    /** The venue's client enquiries (no seed, draft, access request or pricing lead) that name none. */
    readonly unlinkedEnquiries: number;
    readonly unlinkedWithOneHolder: number;
    /** Emails, per venue, that two or more live people hold. */
    readonly sharedEmails: number;
    /** Kept-apart marks not withdrawn. */
    readonly keptApartMarks: number;
  };
}

const count = z.number().int().nonnegative();
const CheckRowSchema = z.object({
  mirror_mismatches: count,
  primary_violations: count,
  cross_venue_links: count,
  live_people: count,
  people_without_points: count,
  contact_points: count,
  memberships: count,
  households: count,
  organisations: count,
  linked_enquiries: count,
  unlinked_enquiries: count,
  unlinked_with_one_holder: count,
  shared_emails: count,
  kept_apart_marks: count,
});

const live = (alias: string): SQL =>
  sql.raw(`${alias}.deleted_at IS NULL AND ${alias}.merged_into_id IS NULL AND ${alias}.erased_at IS NULL`);

/**
 * Reads every count in one statement, so all of them see one snapshot.
 * venueIds limits each count to rows of those venues (the tests' own);
 * null reads the whole database.
 */
export async function checkPeopleBook(db: PeopleBookReader, venueIds: readonly string[] | null = null): Promise<PeopleBookCheck> {
  const inScope = (column: string): SQL => {
    if (venueIds === null) return sql`true`;
    if (venueIds.length === 0) return sql`false`;
    return sql`${sql.raw(column)} IN (${sql.join(venueIds.map((id) => sql`${id}::uuid`), sql`, `)})`;
  };
  // normaliseEmail in @omnitwin/types, as migration 0095's people_normalise_email
  // runs it, written out so this check outlives the backfill's helpers.
  const enquiryEmail = sql.raw(
    "NULLIF(lower(regexp_replace(coalesce(e.guest_email, e.email), '^[[:space:]]+|[[:space:]]+$', '', 'g')), '')",
  );
  // The venue's clients' enquiries, as the backfill and the live linking read them.
  const clientEnquiry = sql`e.fixture_source IS NULL AND e.state <> 'draft'
    AND (e.event_type IS NULL OR e.event_type NOT IN (${sql.join(NON_BOOKING_ENQUIRY_TYPES.map((type) => sql`${type}`), sql`, `)}))`;
  const primaryEmail = sql`(SELECT p.display_value FROM contact_points p WHERE p.contact_id = c.id AND p.kind = 'email' AND p.is_primary)`;
  const primaryPhone = sql`(SELECT p.display_value FROM contact_points p WHERE p.contact_id = c.id AND p.kind = 'phone' AND p.is_primary)`;
  const primaryAccount = sql`(SELECT m.client_account_id FROM account_memberships m
    JOIN client_accounts a ON a.id = m.client_account_id AND a.deleted_at IS NULL AND a.merged_into_id IS NULL
    WHERE m.contact_id = c.id AND m.is_primary)`;
  const hasPoints = sql`EXISTS (SELECT 1 FROM contact_points p WHERE p.contact_id = c.id)`;
  const hasMemberships = sql`EXISTS (SELECT 1 FROM account_memberships m WHERE m.contact_id = c.id)`;

  const result = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM contacts c
        WHERE ${live("c")} AND ${inScope("c.venue_id")} AND (${hasPoints} OR ${hasMemberships})
          AND (c.email IS DISTINCT FROM ${primaryEmail}
            OR c.phone IS DISTINCT FROM ${primaryPhone}
            OR c.client_account_id IS DISTINCT FROM ${primaryAccount}))::int AS mirror_mismatches,
      (SELECT count(*) FROM contacts c
        WHERE ${inScope("c.venue_id")} AND (
          EXISTS (SELECT 1 FROM contact_points p WHERE p.contact_id = c.id
            GROUP BY p.kind HAVING count(*) FILTER (WHERE p.is_primary) <> 1)
          OR EXISTS (SELECT 1 FROM account_memberships m WHERE m.contact_id = c.id
            GROUP BY m.contact_id HAVING count(*) FILTER (WHERE m.is_primary) <> 1)))::int AS primary_violations,
      (SELECT count(*) FROM enquiries e JOIN contacts c ON c.id = e.contact_id
        WHERE ${inScope("e.venue_id")} AND c.venue_id <> e.venue_id)::int AS cross_venue_links,
      (SELECT count(*) FROM contacts c WHERE ${live("c")} AND ${inScope("c.venue_id")})::int AS live_people,
      (SELECT count(*) FROM contacts c
        WHERE ${live("c")} AND ${inScope("c.venue_id")} AND (c.email IS NOT NULL OR c.phone IS NOT NULL)
          AND NOT ${hasPoints})::int AS people_without_points,
      (SELECT count(*) FROM contact_points p WHERE ${inScope("p.venue_id")})::int AS contact_points,
      (SELECT count(*) FROM account_memberships m WHERE ${inScope("m.venue_id")})::int AS memberships,
      (SELECT count(*) FROM client_accounts a
        WHERE a.kind = 'household' AND a.deleted_at IS NULL AND a.merged_into_id IS NULL AND ${inScope("a.venue_id")})::int AS households,
      (SELECT count(*) FROM client_accounts a
        WHERE a.kind = 'organisation' AND a.deleted_at IS NULL AND a.merged_into_id IS NULL AND ${inScope("a.venue_id")})::int AS organisations,
      (SELECT count(*) FROM enquiries e WHERE e.contact_id IS NOT NULL AND ${inScope("e.venue_id")})::int AS linked_enquiries,
      (SELECT count(*) FROM enquiries e WHERE e.contact_id IS NULL AND ${clientEnquiry} AND ${inScope("e.venue_id")})::int AS unlinked_enquiries,
      (SELECT count(*) FROM enquiries e
        WHERE e.contact_id IS NULL AND ${clientEnquiry} AND ${inScope("e.venue_id")}
          AND (SELECT count(DISTINCT p.contact_id) FROM contact_points p JOIN contacts c ON c.id = p.contact_id AND ${live("c")}
                WHERE p.venue_id = e.venue_id AND p.kind = 'email' AND p.value = ${enquiryEmail}) = 1)::int AS unlinked_with_one_holder,
      (SELECT count(*) FROM (
        SELECT 1 FROM contact_points p JOIN contacts c ON c.id = p.contact_id AND ${live("c")}
        WHERE p.kind = 'email' AND ${inScope("p.venue_id")}
        GROUP BY p.venue_id, p.value HAVING count(DISTINCT p.contact_id) > 1
      ) shared)::int AS shared_emails,
      (SELECT count(*) FROM contact_kept_apart k WHERE k.withdrawn_at IS NULL AND ${inScope("k.venue_id")})::int AS kept_apart_marks
  `);
  const row = CheckRowSchema.parse(result.rows[0]);
  return {
    mustBeZero: {
      mirrorMismatches: row.mirror_mismatches,
      primaryViolations: row.primary_violations,
      crossVenueLinks: row.cross_venue_links,
    },
    counts: {
      livePeople: row.live_people,
      peopleWithoutPoints: row.people_without_points,
      contactPoints: row.contact_points,
      memberships: row.memberships,
      households: row.households,
      organisations: row.organisations,
      linkedEnquiries: row.linked_enquiries,
      unlinkedEnquiries: row.unlinked_enquiries,
      unlinkedWithOneHolder: row.unlinked_with_one_holder,
      sharedEmails: row.shared_emails,
      keptApartMarks: row.kept_apart_marks,
    },
  };
}

/** Whether every count that must be zero is. */
export function peopleBookHolds(check: PeopleBookCheck): boolean {
  return Object.values(check.mustBeZero).every((value) => value === 0);
}

/* eslint-disable no-console -- the operator reads this script's output on the console */
async function main(): Promise<void> {
  // Loaded here, not on import, so a test that imports the check never reads .env.
  // dotenv never overrides a variable that is already set.
  await import("dotenv/config");
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    console.error("[people-book-check] DATABASE_URL is not set");
    process.exitCode = 2;
    return;
  }
  const connection = createDbConnection(databaseUrl);
  try {
    const check = await connection.db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      await tx.execute(sql`SET LOCAL statement_timeout = '60s'`);
      return checkPeopleBook(tx);
    });
    const holds = peopleBookHolds(check);
    console.log(JSON.stringify({ status: holds ? "holds" : "broken", ...check }));
    if (!holds) process.exitCode = 1;
  } catch (error: unknown) {
    // The message only: a driver error can carry connection details.
    console.error("[people-book-check] the read failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 2;
  } finally {
    await connection.close();
  }
}
/* eslint-enable no-console */

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  await main();
}
