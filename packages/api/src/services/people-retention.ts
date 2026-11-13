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
// Who is looked at is decided in SQL from their own records (linked
// enquiries, deals, the events of those and of the organisations and
// households they lead or belong to): someone in touch through those, and
// someone kept for a booking or a contract with nothing left to remove, is
// never a candidate, so they cannot crowd the front of the queue night after
// night. The step then checks everything of theirs (lastInTouch, keptRecord),
// which can still keep a few.
//
// One person or enquiry failing is counted (its SQLSTATE only) and the rest
// go on; the next night tries it again. A night acts on at most
// PEOPLE_PASS_LIMITS people and lone enquiries, oldest first, looks at no more
// than `examined` of each, and reports what it left for the next.
//
// A dry run does every step in one transaction, each in its own savepoint,
// and rolls the whole of it back: the later steps see the earlier ones, as
// they would that night, so the counts are exactly what a real run would do
// on the data as it stands. A step that changes nothing is rolled back at
// once, so the people kept or in touch are not held locked; the erasures it
// rehearses hold their rows until it finishes.
// ---------------------------------------------------------------------------

/** The privacy page's 24 months after our last contact. */
export const PEOPLE_RETENTION_MONTHS = 24;

/** At most this many people and lone enquiries acted on in one run, and
 *  looked at, so a backlog (the People Book's backfill falls due together in
 *  2028) finishes over several nights instead of overrunning the job. */
export const PEOPLE_PASS_LIMITS = { people: 100, enquiries: 200, examined: 500 } as const;

export interface PeopleRetentionLimits {
  readonly people: number;
  readonly enquiries: number;
  readonly examined: number;
}

export interface PeopleRetentionOptions {
  readonly now?: Date;
  readonly dryRun?: boolean;
  readonly limits?: Partial<PeopleRetentionLimits>;
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

/** Thrown to roll back a rehearsed step that changed nothing, with its tally. */
class Unchanged extends Error {
  constructor(readonly tally: Tally) {
    super("unchanged");
  }
}

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

/** A booking the venue keeps: confirmed, or provisional and still live. */
function liveBooking(alias: string): SQL {
  return sql.raw(`${alias}."deleted_at" is null and (${alias}."kind" = 'ink' or (${alias}."kind" = 'hold' and ${alias}."status" = 'active'))`);
}

/** The person's own records, from the outer `contacts` row. */
function ownRecords(): { linked: SQL; deals: SQL; events: SQL; proposals: SQL } {
  const id = outerColumn(contacts.id);
  const linked = sql`select e."id" from "enquiries" as e where e."contact_id" = ${id}`;
  const deals = sql`select o."id" from "opportunities" as o where o."primary_contact_id" = ${id}`;
  const accounts = sql`select ca."id" from "client_accounts" as ca where ca."primary_contact_id" = ${id}
    union select m."client_account_id" from "account_memberships" as m
      join "client_accounts" as hh on hh."id" = m."client_account_id"
      where m."contact_id" = ${id} and hh."kind" = 'household'`;
  const events = sql`select ev."id" from "events" as ev where ev."opportunity_id" in (${deals}) or ev."client_account_id" in (${accounts})
    union select bk."event_id" from "bookings" as bk where bk."enquiry_id" in (${linked}) and bk."event_id" is not null`;
  const proposals = sql`select p."id" from "proposals" as p where p."enquiry_id" in (${linked}) or p."opportunity_id" in (${deals})`;
  return { linked, deals, events, proposals };
}

/** Kept by their own records: a live booking, a contract or a deposit. */
function keptByOwnRecords(): SQL {
  const own = ownRecords();
  return sql`(
    exists (select 1 from "bookings" as kb where (kb."enquiry_id" in (${own.linked}) or kb."event_id" in (${own.events})) and ${liveBooking("kb")})
    or exists (select 1 from "proposal_contract_versions" as cv where cv."proposal_id" in (${own.proposals}))
    or exists (select 1 from "proposal_deposit_requests" as dr where dr."proposal_id" in (${own.proposals}) or dr."event_id" in (${own.events}))
  )`;
}

/** A linked enquiry of theirs that never became a booking or a contract. */
function spareEnquiry(): SQL {
  return sql`exists (
    select 1 from "enquiries" as se where se."contact_id" = ${outerColumn(contacts.id)}
      and not exists (select 1 from "bookings" as sb where sb."enquiry_id" = se."id" and ${liveBooking("sb")})
      and not exists (select 1 from "bookings" as sb0 join "bookings" as sb1 on sb1."event_id" = sb0."event_id"
        where sb0."enquiry_id" = se."id" and ${liveBooking("sb1")})
      and not exists (select 1 from "proposals" as sp join "proposal_contract_versions" as scv on scv."proposal_id" = sp."id"
        where sp."enquiry_id" = se."id")
      and not exists (select 1 from "proposals" as sp2 join "proposal_deposit_requests" as sdr on sdr."proposal_id" = sp2."id"
        where sp2."enquiry_id" = se."id")
  )`;
}

/** The last contact their own records show (lastInTouch, from SQL). */
function ownLastContact(): SQL {
  const own = ownRecords();
  const id = outerColumn(contacts.id);
  return sql`greatest(
    coalesce(${contacts.lastContactAt}, ${contacts.createdAt}),
    (select max(greatest(e2."created_at", e2."updated_at")) from "enquiries" as e2 where e2."contact_id" = ${id}),
    (select max(greatest(o2."created_at", o2."updated_at")) from "opportunities" as o2 where o2."primary_contact_id" = ${id}),
    (select max(a."created_at") from "activities" as a where a."opportunity_id" in (${own.deals})),
    (select max(greatest(p2."created_at", p2."updated_at", p2."sent_at")) from "proposals" as p2 where p2."id" in (${own.proposals})),
    (select max(pc."created_at") from "proposal_comments" as pc where pc."proposal_id" in (${own.proposals})),
    (select max(greatest(b2."created_at", b2."updated_at")) from "bookings" as b2
      where b2."enquiry_id" in (${own.linked}) or b2."event_id" in (${own.events}))
  )`;
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

/** A person to look at tonight: due, out of touch by their own records, and
 *  not kept with nothing left to remove. */
function personCandidate(cutoff: Date): SQL {
  return and(
    personDue(cutoff),
    before(ownLastContact(), cutoff),
    sql`not (${keptByOwnRecords()} and not ${spareEnquiry()})`,
  ) ?? sql`false`;
}

/** Due and kept with nothing left to remove: listed, never looked at. */
function personKeptAlready(cutoff: Date): SQL {
  return and(
    personDue(cutoff),
    before(ownLastContact(), cutoff),
    keptByOwnRecords(),
    sql`not ${spareEnquiry()}`,
  ) ?? sql`false`;
}

/** An enquiry linked to nobody, untouched since the cutoff (nor its bookings,
 *  proposals or the client's answers on them), never booked or contracted,
 *  from an address no live person at its venue holds (such an enquiry goes
 *  with that person). */
function loneEnquiryDue(cutoff: Date): SQL {
  const id = outerColumn(enquiries.id);
  const asked = sql`(lower(${outerColumn(enquiries.email)}), lower(${outerColumn(enquiries.guestEmail)}))`;
  const itsProposals = sql`select lp."id" from "proposals" as lp where lp."enquiry_id" = ${id}`;
  return and(
    isNull(enquiries.contactId),
    before(sql`greatest(
      ${enquiries.createdAt}, ${enquiries.updatedAt},
      (select max(greatest(lb."created_at", lb."updated_at")) from "bookings" as lb where lb."enquiry_id" = ${id}),
      (select max(greatest(lq."created_at", lq."updated_at", lq."sent_at")) from "proposals" as lq where lq."enquiry_id" = ${id}),
      (select max(lc."created_at") from "proposal_comments" as lc where lc."proposal_id" in (${itsProposals}))
    )`, cutoff),
    sql`not exists (
      select 1 from "bookings" as kb
      where (kb."enquiry_id" = ${id} or kb."event_id" in (select ob."event_id" from "bookings" as ob where ob."enquiry_id" = ${id}))
        and ${liveBooking("kb")}
    )`,
    sql`not exists (select 1 from "proposal_contract_versions" as lcv where lcv."proposal_id" in (${itsProposals}))`,
    sql`not exists (select 1 from "proposal_deposit_requests" as ldr where ldr."proposal_id" in (${itsProposals}))`,
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
  const limits: PeopleRetentionLimits = { ...PEOPLE_PASS_LIMITS, ...options.limits };
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
  readonly limits: PeopleRetentionLimits;
  readonly dryRun: boolean;
}): Promise<PeopleRetentionResult> {
  const { db, outer, cutoff, now, limits } = input;
  let people = 0;
  let keptForBooking = 0;
  let inTouch = 0;
  let enquiryCount = 0;
  const failedStates: string[] = [];
  const kept: KeptPerson[] = [];

  /** One step in its own transaction (a savepoint in a rehearsal, rolled back
   *  at once when it changed nothing). A failure rolls the step back, is
   *  counted by its SQLSTATE, and the pass goes on. Returns whether the step
   *  acted (erased or deleted something). */
  async function step(work: (tx: PeopleTx) => Promise<Tally>): Promise<boolean> {
    const run = async (tx: PeopleTx): Promise<Tally> => {
      const tally = await work(tx);
      if (outer !== null && tally.people === 0 && tally.enquiries === 0) throw new Unchanged(tally);
      return tally;
    };
    let tally: Tally;
    try {
      tally = outer === null ? await db.transaction(run) : await outer.transaction(run);
    } catch (error) {
      if (!(error instanceof Unchanged)) {
        failedStates.push(sqlStateOf(error) ?? "unknown");
        return false;
      }
      tally = error.tally;
    }
    people += tally.people;
    keptForBooking += tally.keptForBooking;
    inTouch += tally.inTouch;
    enquiryCount += tally.enquiries;
    if (tally.kept !== null) kept.push(tally.kept);
    return tally.people > 0 || tally.enquiries > 0;
  }

  /** Reads the candidates where the steps run, so a rehearsal sees its own. */
  async function candidates<T>(read: (reader: PeopleTx | Database) => Promise<T>): Promise<T> {
    return outer === null ? read(db) : read(outer);
  }

  // Kept with nothing left to remove: listed for the six-year rule, not looked at.
  const keptAlready = await candidates((reader) => reader.select({ venueId: contacts.venueId, personId: contacts.id }).from(contacts)
    .where(personKeptAlready(cutoff))
    .orderBy(asc(contacts.venueId), asc(contacts.id)));
  const duePeople = await candidates((reader) => reader.select({ id: contacts.id }).from(contacts)
    .where(personCandidate(cutoff))
    .orderBy(asc(sql`coalesce(${contacts.lastContactAt}, ${contacts.createdAt})`), asc(contacts.id)));
  let peopleActedOn = 0;
  let peopleLooked = 0;
  for (const candidate of duePeople) {
    if (peopleActedOn >= limits.people || peopleLooked >= limits.examined) break;
    peopleLooked += 1;
    const acted = await step(async (tx) => {
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
    if (acted) peopleActedOn += 1;
  }

  const dueEnquiries = await candidates((reader) => reader.select({ id: enquiries.id }).from(enquiries)
    .where(loneEnquiryDue(cutoff))
    .orderBy(asc(sql`greatest(${enquiries.createdAt}, ${enquiries.updatedAt})`), asc(enquiries.id)));
  let enquiriesActedOn = 0;
  let enquiriesLooked = 0;
  for (const candidate of dueEnquiries) {
    if (enquiriesActedOn >= limits.enquiries || enquiriesLooked >= limits.examined) break;
    enquiriesLooked += 1;
    const acted = await step(async (tx) => {
      const [enquiry] = await tx.select(ENQUIRY_FIELDS).from(enquiries)
        .where(and(eq(enquiries.id, candidate.id), loneEnquiryDue(cutoff))).for("update");
      if (enquiry === undefined) return NONE;
      const records = await findEnquiryRecords(tx, enquiry, { reword: true });
      const last = await lastInTouch(tx, records);
      if (last !== null && last >= cutoff) return NONE;
      if ((await keptRecord(tx, records)) !== null) return NONE;
      return { ...NONE, enquiries: (await removeEnquiryRecords(tx, records)).enquiries };
    });
    if (acted) enquiriesActedOn += 1;
  }

  return {
    dryRun: input.dryRun,
    people,
    keptForBooking: keptForBooking + keptAlready.length,
    inTouch,
    enquiries: enquiryCount,
    failed: failedStates.length,
    failedStates,
    deferred: {
      people: duePeople.length - peopleLooked,
      enquiries: dueEnquiries.length - enquiriesLooked,
    },
    kept: [...kept, ...keptAlready],
  };
}
