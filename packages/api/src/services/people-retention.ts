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
// The 24 months are calendar months: the run's time (the app's clock, or
// the time a test gives) minus 24 months, counted by the database
// (`interval '1 month'` times 24), not 730 days.
//
// Who is looked at is decided in one SQL query from each person's own
// records, by the erasure's own rule of what is theirs (lapsedPeople):
// someone in touch through those, and someone kept for a booking or a
// contract with nothing left to remove, is never a candidate, so they cannot
// crowd the front of the queue night after night. The step then checks
// everything of theirs, the records merged into them included (lastInTouch,
// keptRecord), which can still keep a few.
//
// One person or enquiry failing is counted (its SQLSTATE only) and the rest
// go on; the next night tries it again. A night acts on at most
// PEOPLE_PASS_LIMITS people and lone enquiries, oldest first, looks at no more
// than `examined` of each, starts no step after PEOPLE_PASS_BUDGET_MS, and
// reports what it left for the next.
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

/** No new step starts after this long, so the nightly job (cleanup.yml stops
 *  it at five minutes) keeps time for the passes after this one. Measured on
 *  the public run 43398620096: about 6 s an erasure, 3 s a look. */
export const PEOPLE_PASS_BUDGET_MS = 150_000;

export interface PeopleRetentionLimits {
  readonly people: number;
  readonly enquiries: number;
  readonly examined: number;
}

export interface PeopleRetentionOptions {
  readonly now?: Date;
  readonly dryRun?: boolean;
  readonly limits?: Partial<PeopleRetentionLimits>;
  /** Milliseconds after which no new step starts (PEOPLE_PASS_BUDGET_MS). */
  readonly budgetMs?: number;
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
  /** People looked at and found in touch by the full check (lastInTouch: the
   *  records merged into them, a deal made from their enquiry, an event of
   *  their proposal's layout). Those in touch by their own records are never
   *  looked at, and not counted here. */
  readonly inTouch: number;
  /** Enquiries deleted with a person, of a kept person, or on their own. */
  readonly enquiries: number;
  /** Steps that failed and were rolled back; each is tried again next night. */
  readonly failed: number;
  /** Their SQLSTATEs, nothing else: this result reaches the public log. */
  readonly failedStates: readonly string[];
  /** Due, and left for the next night by the limits or the time budget. */
  readonly deferred: { readonly people: number; readonly enquiries: number };
  /** The time budget ran out before every due step was looked at. */
  readonly outOfTime: boolean;
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

/** A live person (not deleted, merged away or erased), by alias. */
function livePerson(alias: string): SQL {
  return sql.raw(`${alias}."deleted_at" is null and ${alias}."merged_into_id" is null and ${alias}."erased_at" is null`);
}

/** One row of lapsedPeople. */
interface LapsedRow extends Record<string, unknown> {
  readonly id: string;
  readonly venueId: string;
  /** Out of touch by their own records. */
  readonly lapsed: boolean;
  /** A booking, a contract or a deposit of theirs keeps them. */
  readonly kept: boolean;
  /** An enquiry of theirs that never became a booking or a contract is left. */
  readonly spare: boolean;
}

/**
 * Every person whose own record is past the cutoff, oldest first, with what
 * their own records show, each set read once per person (lateral): the last
 * contact, whether a booking or a contract keeps them, and whether an
 * enquiry of theirs that never became one is left to remove. "Theirs" is
 * findPersonRecords' rule (people-erasure.ts), from the person's own row:
 *   - their addresses that no other live person at the venue holds;
 *   - their enquiries: linked to them, or linked to nobody from one of those;
 *   - their deals: led by them, or made from their enquiries and led by no
 *     other live person. A deal made from their enquiries that another live
 *     person leads is that person's ("near"): it counts only as contact;
 *   - their accounts, the proposals of their enquiries and deals (one on a
 *     near deal is near), and the events of their deals, accounts and
 *     proposals' layouts and of their enquiries' holds, but never a near
 *     deal's event, nor a booking pencilled from their enquiry onto one.
 * The records merged into them are left to the step, which follows the
 * chain: it can only find more of theirs, so nobody this reads as kept or in
 * touch is someone the step would take.
 */
function lapsedPeople(cutoff: Date): SQL {
  const at = sql`${cutoff.toISOString()}::timestamptz`;
  return sql`
    select c."id", c."venue_id" as "venueId", (t."last_contact" < ${at}) as "lapsed", t."kept", t."spare"
    from "contacts" as c
    cross join lateral (
      select coalesce(array_agg(own."address"), '{}'::text[]) as "list" from (
        select lower(oc."email") as "address" from "contacts" as oc where oc."id" = c."id"
        union select lower(op."value") from "contact_points" as op where op."contact_id" = c."id" and op."kind" = 'email'
        union select lower(oe."email") from "enquiries" as oe where oe."contact_id" = c."id"
        union select lower(og."guest_email") from "enquiries" as og where og."contact_id" = c."id"
      ) as own
      where own."address" is not null
        and not exists (select 1 from "contacts" as rc where rc."venue_id" = c."venue_id" and rc."id" <> c."id"
          and ${livePerson("rc")} and lower(rc."email") = own."address")
        and not exists (select 1 from "contact_points" as rp join "contacts" as rpc on rpc."id" = rp."contact_id"
          where rp."venue_id" = c."venue_id" and rp."kind" = 'email' and rp."contact_id" <> c."id" and ${livePerson("rpc")}
            and lower(rp."value") = own."address")
    ) as addr
    cross join lateral (
      select array(
        select e."id" from "enquiries" as e where e."contact_id" = c."id"
        union
        select u."id" from "enquiries" as u
        where cardinality(addr."list") > 0 and u."venue_id" = c."venue_id" and u."contact_id" is null
          and (lower(u."email") = any(addr."list") or lower(u."guest_email") = any(addr."list"))
      ) as "ids"
    ) as linked
    cross join lateral (
      select coalesce(array_agg(d."id") filter (where not d."near"), '{}'::uuid[]) as "own",
             coalesce(array_agg(d."id") filter (where d."near"), '{}'::uuid[]) as "near"
      from (
        select o."id", (o."primary_contact_id" is not null and o."primary_contact_id" <> c."id" and exists (
          select 1 from "contacts" as ol where ol."id" = o."primary_contact_id" and ${livePerson("ol")})) as "near"
        from "opportunities" as o
        where o."venue_id" = c."venue_id" and (o."primary_contact_id" = c."id" or o."source_enquiry_id" = any(linked."ids"))
      ) as d
    ) as deals
    cross join lateral (
      select array(
        select ca."id" from "client_accounts" as ca where ca."venue_id" = c."venue_id" and ca."primary_contact_id" = c."id"
        union
        select m."client_account_id" from "account_memberships" as m
          join "client_accounts" as hh on hh."id" = m."client_account_id"
          where m."contact_id" = c."id" and hh."kind" = 'household'
      ) as "ids"
    ) as accounts
    cross join lateral (
      select coalesce(array_agg(p."id") filter (where p."opportunity_id" is null or p."opportunity_id" = any(deals."own")), '{}'::uuid[]) as "own",
             coalesce(array_agg(p."id"), '{}'::uuid[]) as "all",
             coalesce(array_agg(p."configuration_id") filter (
               where (p."opportunity_id" is null or p."opportunity_id" = any(deals."own")) and p."configuration_id" is not null
             ), '{}'::uuid[]) as "layouts"
      from "proposals" as p
      where p."venue_id" = c."venue_id" and (p."enquiry_id" = any(linked."ids") or p."opportunity_id" = any(deals."own" || deals."near"))
    ) as props
    cross join lateral (
      select array(
        select ne."id" from "events" as ne
        where ne."opportunity_id" = any(deals."near") and not coalesce(ne."client_account_id" = any(accounts."ids"), false)
      ) as "ids"
    ) as near_events
    cross join lateral (
      select array(
        select ev."id" from "events" as ev
        where ev."venue_id" = c."venue_id" and (ev."opportunity_id" = any(deals."own") or ev."client_account_id" = any(accounts."ids"))
        union
        select ecl."event_id" from "event_configuration_links" as ecl join "events" as le on le."id" = ecl."event_id"
        where le."venue_id" = c."venue_id" and ecl."configuration_id" = any(props."layouts")
        union
        select bk."event_id" from "bookings" as bk
        where bk."enquiry_id" = any(linked."ids") and bk."event_id" is not null and not (bk."event_id" = any(near_events."ids"))
      ) as "ids"
    ) as own_events
    cross join lateral (
      select
        greatest(
          coalesce(c."last_contact_at", c."created_at"),
          (select max(greatest(e2."created_at", e2."updated_at")) from "enquiries" as e2 where e2."id" = any(linked."ids")),
          (select max(greatest(o2."created_at", o2."updated_at")) from "opportunities" as o2 where o2."id" = any(deals."own" || deals."near")),
          (select max(a."created_at") from "activities" as a where a."opportunity_id" = any(deals."own" || deals."near")),
          (select max(greatest(p2."created_at", p2."updated_at", p2."sent_at")) from "proposals" as p2 where p2."id" = any(props."all")),
          (select max(pc."created_at") from "proposal_comments" as pc where pc."proposal_id" = any(props."all")),
          (select max(greatest(b2."created_at", b2."updated_at")) from "bookings" as b2
            where b2."enquiry_id" = any(linked."ids") or b2."event_id" = any(own_events."ids" || near_events."ids"))
        ) as "last_contact",
        (
          exists (select 1 from "bookings" as kb
            where (kb."event_id" = any(own_events."ids")
                or (kb."enquiry_id" = any(linked."ids") and (kb."event_id" is null or not (kb."event_id" = any(near_events."ids")))))
              and ${liveBooking("kb")})
          or exists (select 1 from "proposal_contract_versions" as cv where cv."proposal_id" = any(props."own"))
          or exists (select 1 from "proposal_deposit_requests" as dr
            where dr."proposal_id" = any(props."own") or dr."event_id" = any(own_events."ids"))
        ) as "kept",
        exists (
          select 1 from unnest(linked."ids") as se("id")
          where not exists (select 1 from "bookings" as sb where sb."enquiry_id" = se."id" and ${liveBooking("sb")}
              and (sb."event_id" is null or not (sb."event_id" = any(near_events."ids"))))
            and not exists (select 1 from "bookings" as sb0 join "bookings" as sb1 on sb1."event_id" = sb0."event_id"
              where sb0."enquiry_id" = se."id" and not (sb0."event_id" = any(near_events."ids")) and ${liveBooking("sb1")})
            and not exists (select 1 from "proposals" as sp join "proposal_contract_versions" as scv on scv."proposal_id" = sp."id"
              where sp."enquiry_id" = se."id" and not coalesce(sp."opportunity_id" = any(deals."near"), false))
            and not exists (select 1 from "proposals" as sp2 join "proposal_deposit_requests" as sdr on sdr."proposal_id" = sp2."id"
              where sp2."enquiry_id" = se."id" and not coalesce(sp2."opportunity_id" = any(deals."near"), false))
        ) as "spare"
    ) as t
    where c."erased_at" is null and c."merged_into_id" is null and coalesce(c."last_contact_at", c."created_at") < ${at}
    order by coalesce(c."last_contact_at", c."created_at"), c."id"`;
}

/** A person whose own record is older than the cutoff: the cheap test, before
 *  the full one (lastInTouch) inside their step. */
function personDue(cutoff: Date): SQL {
  return and(
    isNull(contacts.erasedAt),
    isNull(contacts.mergedIntoId),
    before(sql`coalesce(${outerColumn(contacts.lastContactAt)}, ${outerColumn(contacts.createdAt)})`, cutoff),
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
      ${outerColumn(enquiries.createdAt)}, ${outerColumn(enquiries.updatedAt)},
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
      where holder."venue_id" = ${outerColumn(enquiries.venueId)} and ${livePerson("holder")}
        and lower(holder."email") in ${asked}
    )`,
    sql`not exists (
      select 1 from "contact_points" as point join "contacts" as holder on holder."id" = point."contact_id"
      where point."venue_id" = ${outerColumn(enquiries.venueId)} and point."kind" = 'email'
        and ${livePerson("holder")} and lower(point."value") in ${asked}
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
  const deadline = Date.now() + (options.budgetMs ?? PEOPLE_PASS_BUDGET_MS);
  if (!dryRun) return runSteps({ db, outer: null, cutoff, now, limits, dryRun, deadline });

  const rehearsed: { result: PeopleRetentionResult | null } = { result: null };
  try {
    await db.transaction(async (outer) => {
      rehearsed.result = await runSteps({ db, outer, cutoff, now, limits, dryRun, deadline });
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
  /** Date.now() after which no new step starts. */
  readonly deadline: number;
}): Promise<PeopleRetentionResult> {
  const { db, outer, cutoff, now, limits, deadline } = input;
  let outOfTime = false;
  /** Whether another step may start: within the limits and the time. */
  const mayGoOn = (actedOn: number, actLimit: number, looked: number): boolean => {
    if (actedOn >= actLimit || looked >= limits.examined) return false;
    if (Date.now() >= deadline) {
      outOfTime = true;
      return false;
    }
    return true;
  };
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

  // Out of touch by their own records. Kept with nothing left to remove:
  // listed for the six-year rule, not looked at. The rest are tonight's queue.
  const lapsed = (await (outer === null ? db.execute<LapsedRow>(lapsedPeople(cutoff)) : outer.execute<LapsedRow>(lapsedPeople(cutoff))))
    .rows.filter((row) => row.lapsed);
  const keptAlready: KeptPerson[] = lapsed.filter((row) => row.kept && !row.spare)
    .map((row) => ({ venueId: row.venueId, personId: row.id }));
  const duePeople = lapsed.filter((row) => !(row.kept && !row.spare));
  let peopleActedOn = 0;
  let peopleLooked = 0;
  for (const candidate of duePeople) {
    if (!mayGoOn(peopleActedOn, limits.people, peopleLooked)) break;
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
        const one = await findEnquiryRecords(tx, enquiry, { reword: false, writers: records.ids });
        if ((await keptRecord(tx, one)) !== null) continue;
        removed += (await removeEnquiryRecords(tx, one)).enquiries;
      }
      return { ...NONE, keptForBooking: 1, enquiries: removed, kept: { venueId: person.venueId, personId: person.id } };
    });
    if (acted) peopleActedOn += 1;
  }

  const dueEnquiries = await candidates((reader) => reader.select({ id: enquiries.id }).from(enquiries)
    .where(loneEnquiryDue(cutoff))
    .orderBy(asc(sql`greatest(${outerColumn(enquiries.createdAt)}, ${outerColumn(enquiries.updatedAt)})`), asc(enquiries.id)));
  let enquiriesActedOn = 0;
  let enquiriesLooked = 0;
  for (const candidate of dueEnquiries) {
    if (!mayGoOn(enquiriesActedOn, limits.enquiries, enquiriesLooked)) break;
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
    outOfTime,
    kept: [...kept, ...keptAlready],
  };
}
