import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { contacts, enquiries } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { outerColumn } from "../utils/outer-column.js";
import { sqlStateOf } from "../utils/sql-state.js";
import {
  ENQUIRY_FIELDS,
  eraseFoundPerson,
  findEnquiryRecords,
  findPersonRecords,
  keptRecord,
  lastInTouch,
  removeEnquiryRecords,
} from "./people-erasure.js";
import type { PeopleTx } from "./people-records.js";

// ---------------------------------------------------------------------------
// The 24-month pass (release audit people-privacy-5). The privacy page
// promises that an enquiry which did not become a booking is deleted 24
// months after our last contact with the person, and their contact record on
// the same rule. Every night this pass:
//   - erases each person we have not been in touch with for 24 months,
//     through the erase route's own erasure (services/people-erasure.ts), one
//     person per transaction. "In touch" is any contact about anything of
//     theirs: the People Book's last contact, and their enquiries, deals,
//     activity notes, proposals, client answers and Diary bookings
//     (lastInTouch), so a person the team is still working with is never
//     taken, and a staff edit to their record alone does not hold them;
//   - keeps a person with a booking or a contract the venue must keep, never
//     half-erased, but deletes their enquiries that never became one; the
//     result lists who was kept (ids only), for the six-year rule by hand;
//   - deletes each enquiry linked to nobody, sent from an address no live
//     person at its venue holds, last in touch 24 months ago and never
//     booked, with what hangs off it (its guest lead included).
// The 24 months are calendar months, counted by the database
// (now() - interval '24 months'), not 730 days.
//
// One person or enquiry failing is counted (its SQLSTATE only) and the rest
// go on; the next night tries it again. A night handles at most
// PEOPLE_PASS_LIMITS, oldest first, and reports what it left for the next.
//
// A dry run does every step in one transaction, each in its own savepoint,
// and rolls the whole of it back: the later steps see the earlier ones, as
// they would that night, so the counts are exactly what a real run would do
// on the data as it stands. It holds its row locks until it finishes.
// ---------------------------------------------------------------------------

/** The privacy page's 24 months after our last contact. */
export const PEOPLE_RETENTION_MONTHS = 24;

/** At most this many people and lone enquiries in one run, so a backlog (the
 *  People Book's backfill falls due together in 2028) finishes over several
 *  nights instead of overrunning the job. */
export const PEOPLE_PASS_LIMITS = { people: 100, enquiries: 200 } as const;

export interface PeopleRetentionOptions {
  readonly now?: Date;
  readonly dryRun?: boolean;
  readonly limits?: { readonly people: number; readonly enquiries: number };
}

export interface KeptPerson {
  readonly venueId: string;
  readonly personId: string;
}

export interface PeopleRetentionResult {
  readonly dryRun: boolean;
  /** People erased (or who would be). */
  readonly people: number;
  /** People past the 24 months who are kept for a booking or a contract. */
  readonly keptForBooking: number;
  /** People whose record is older than 24 months, still in touch through
   *  something of theirs. */
  readonly inTouch: number;
  /** Enquiries deleted with a person, of a kept person, or on their own. */
  readonly enquiries: number;
  /** Steps that failed and were rolled back; each is tried again next night. */
  readonly failed: number;
  /** Their SQLSTATEs, nothing else: this result reaches the public log. */
  readonly failedStates: readonly string[];
  /** Due, and left for the next night by the limits. */
  readonly deferred: { readonly people: number; readonly enquiries: number };
  /** Who was kept for a booking or a contract (ids only). */
  readonly kept: readonly KeptPerson[];
}

/** The pass failed as a whole. Carries the SQLSTATE and nothing else: the
 *  database's own error can quote the query's parameters (the very addresses
 *  being erased), and the nightly job's log is public with the repository. */
export class PeopleRetentionError extends Error {
  readonly sqlState: string | null;
  constructor(cause: unknown) {
    const sqlState = sqlStateOf(cause);
    super(`The 24-month people pass failed${sqlState === null ? "" : ` (SQLSTATE ${sqlState})`}`);
    this.name = "PeopleRetentionError";
    this.sqlState = sqlState;
  }
}

/** Thrown to roll a rehearsal back. */
class Rehearsal extends Error {}

interface Tally {
  readonly people: number;
  readonly keptForBooking: number;
  readonly inTouch: number;
  readonly enquiries: number;
  readonly kept: KeptPerson | null;
}

const NONE: Tally = { people: 0, keptForBooking: 0, inTouch: 0, enquiries: 0, kept: null };

function before(column: SQL, cutoff: Date): SQL {
  return sql`${column} < ${cutoff.toISOString()}::timestamptz`;
}

/** A person whose own record is older than the cutoff: the cheap test, before
 *  the full one (lastInTouch) inside their step. */
function personDue(cutoff: Date): SQL {
  return and(
    isNull(contacts.erasedAt),
    isNull(contacts.mergedIntoId),
    before(sql`coalesce(${contacts.lastContactAt}, ${contacts.createdAt})`, cutoff),
  ) ?? sql`false`;
}

/** An enquiry linked to nobody, untouched since the cutoff, from an address no
 *  live person at its venue holds (such an enquiry goes with that person). */
function loneEnquiryDue(cutoff: Date): SQL {
  const asked = sql`(lower(${outerColumn(enquiries.email)}), lower(${outerColumn(enquiries.guestEmail)}))`;
  return and(
    isNull(enquiries.contactId),
    before(sql`greatest(${enquiries.createdAt}, ${enquiries.updatedAt})`, cutoff),
    sql`not exists (
      select 1 from "contacts" as holder
      where holder."venue_id" = ${outerColumn(enquiries.venueId)} and holder."erased_at" is null
        and lower(holder."email") in ${asked}
    )`,
    sql`not exists (
      select 1 from "contact_points" as point join "contacts" as holder on holder."id" = point."contact_id"
      where point."venue_id" = ${outerColumn(enquiries.venueId)} and point."kind" = 'email'
        and holder."erased_at" is null and lower(point."value") in ${asked}
    )`,
  ) ?? sql`false`;
}

/** now minus 24 calendar months, as the database counts them. */
async function cutoffFor(db: Database, now: Date): Promise<Date> {
  const result = await db.execute<{ ms: number | string }>(sql`
    select (extract(epoch from (${now.toISOString()}::timestamptz - ${PEOPLE_RETENTION_MONTHS}::int * interval '1 month')) * 1000)::float8 as ms`);
  const ms = Number(result.rows[0]?.ms);
  if (!Number.isFinite(ms)) throw new Error("The database gave no cutoff");
  return new Date(ms);
}

export async function eraseLapsedPeople(db: Database, options: PeopleRetentionOptions = {}): Promise<PeopleRetentionResult> {
  try {
    return await runPass(db, options);
  } catch (error) {
    throw error instanceof PeopleRetentionError ? error : new PeopleRetentionError(error);
  }
}

async function runPass(db: Database, options: PeopleRetentionOptions): Promise<PeopleRetentionResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const limits = options.limits ?? PEOPLE_PASS_LIMITS;
  const cutoff = await cutoffFor(db, now);
  if (!dryRun) return runSteps({ db, outer: null, cutoff, now, limits, dryRun });

  const rehearsed: { result: PeopleRetentionResult | null } = { result: null };
  try {
    await db.transaction(async (outer) => {
      rehearsed.result = await runSteps({ db, outer, cutoff, now, limits, dryRun });
      throw new Rehearsal();
    });
  } catch (error) {
    if (!(error instanceof Rehearsal)) throw error;
  }
  if (rehearsed.result === null) throw new Error("The rehearsal returned no result");
  return rehearsed.result;
}

async function runSteps(input: {
  readonly db: Database;
  /** The rehearsal's transaction, or null for a real run. */
  readonly outer: PeopleTx | null;
  readonly cutoff: Date;
  readonly now: Date;
  readonly limits: { readonly people: number; readonly enquiries: number };
  readonly dryRun: boolean;
}): Promise<PeopleRetentionResult> {
  const { db, outer, cutoff, now, limits } = input;
  let people = 0;
  let keptForBooking = 0;
  let inTouch = 0;
  let enquiryCount = 0;
  const failedStates: string[] = [];
  const kept: KeptPerson[] = [];

  /** One step in its own transaction (a savepoint in a rehearsal). A failure
   *  rolls the step back, is counted by its SQLSTATE, and the pass goes on. */
  async function step(work: (tx: PeopleTx) => Promise<Tally>): Promise<void> {
    try {
      const tally = outer === null ? await db.transaction(work) : await outer.transaction(work);
      people += tally.people;
      keptForBooking += tally.keptForBooking;
      inTouch += tally.inTouch;
      enquiryCount += tally.enquiries;
      if (tally.kept !== null) kept.push(tally.kept);
    } catch (error) {
      failedStates.push(sqlStateOf(error) ?? "unknown");
    }
  }

  /** Reads the candidates where the steps run, so a rehearsal sees its own. */
  async function candidates<T>(read: (reader: PeopleTx | Database) => Promise<T>): Promise<T> {
    return outer === null ? read(db) : read(outer);
  }

  const duePeople = await candidates((reader) => reader.select({ id: contacts.id }).from(contacts)
    .where(personDue(cutoff))
    .orderBy(asc(sql`coalesce(${contacts.lastContactAt}, ${contacts.createdAt})`), asc(contacts.id)));
  for (const candidate of duePeople.slice(0, limits.people)) {
    await step(async (tx) => {
      // Locked and read again: someone may have written to them meanwhile.
      const [person] = await tx.select().from(contacts)
        .where(and(eq(contacts.id, candidate.id), personDue(cutoff))).for("update");
      if (person === undefined) return NONE;
      const records = await findPersonRecords(tx, person);
      const last = await lastInTouch(tx, records);
      if (last !== null && last >= cutoff) return { ...NONE, inTouch: 1 };
      const erased = await eraseFoundPerson(tx, person, records, { actorUserId: null, now });
      if (erased.ok) return { ...NONE, people: 1, enquiries: erased.counts.enquiries };
      // Kept for a booking or a contract: what never became one still goes.
      let removed = 0;
      for (const enquiry of records.enquiries) {
        const one = await findEnquiryRecords(tx, enquiry, { reword: false });
        if ((await keptRecord(tx, one)) !== null) continue;
        removed += (await removeEnquiryRecords(tx, one)).enquiries;
      }
      return { ...NONE, keptForBooking: 1, enquiries: removed, kept: { venueId: person.venueId, personId: person.id } };
    });
  }

  const dueEnquiries = await candidates((reader) => reader.select({ id: enquiries.id }).from(enquiries)
    .where(loneEnquiryDue(cutoff))
    .orderBy(asc(sql`greatest(${enquiries.createdAt}, ${enquiries.updatedAt})`), asc(enquiries.id)));
  for (const candidate of dueEnquiries.slice(0, limits.enquiries)) {
    await step(async (tx) => {
      const [enquiry] = await tx.select(ENQUIRY_FIELDS).from(enquiries)
        .where(and(eq(enquiries.id, candidate.id), loneEnquiryDue(cutoff))).for("update");
      if (enquiry === undefined) return NONE;
      const records = await findEnquiryRecords(tx, enquiry, { reword: true });
      const last = await lastInTouch(tx, records);
      if (last !== null && last >= cutoff) return NONE;
      if ((await keptRecord(tx, records)) !== null) return NONE;
      return { ...NONE, enquiries: (await removeEnquiryRecords(tx, records)).enquiries };
    });
  }

  return {
    dryRun: input.dryRun,
    people,
    keptForBooking,
    inTouch,
    enquiries: enquiryCount,
    failed: failedStates.length,
    failedStates,
    deferred: {
      people: Math.max(0, duePeople.length - limits.people),
      enquiries: Math.max(0, dueEnquiries.length - limits.enquiries),
    },
    kept,
  };
}
