import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SENT_PROPOSAL_STATUSES } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { ensureEnquiryEvent } from "../services/enquiry-event.js";
import { readEnquiryReach } from "../services/event-binding.js";
import { eventForNewDeal } from "../services/event-links.js";
import { openSpineDatabase, platformTarget, venue as venueIn, type SpineDatabase, type SpineVenue } from "./helpers/event-spine-fixtures.js";

// ---------------------------------------------------------------------------
// The rule this suite enforces: a live writer may abstain where the join
// acts, but never makes, joins or picks anything the join would not.
//
// Two writers give an enquiry its event while a request is served:
// ensureEnquiryEvent (an act that works the enquiry) and eventForNewDeal (a
// deal made from it). The nightly join of old records
// (spine_join_old_records) decides the same records from the same rows. A
// writer that joined, made or picked where the join would do otherwise would
// disagree with it for good, so the join is the outside reference, and each
// case runs, on the same starting rows (a savepoint puts them back between):
//   - the join alone;
//   - the writer alone, which must arrive where the join alone does;
//   - except on the one row where a writer abstains (writerAbstains, below):
//     there the writer must write nothing, and the join run after it must
//     arrive where the join alone does.
// (Elsewhere the join run after the writer can add nothing: the join never
// touches a record that has its link, and where the writer writes nothing
// the rows are the join's own. It is run there only to show, when the two
// differ, what the next nightly run would leave.) Each case also runs the
// join's own reading of what a proposal with no event reaches (the
// proposals_reach text inside the stored function) beside the writers'
// reading of it (readEnquiryReach), on the same rows.
//
// The cases are generated from the dimensions the join's SQL tells apart, and
// each is named by them, so a failure reads as a row of the join's table: the
// writer; the enquiry (open, closed, a draft, a request, linked); what of its
// own already sits in an event (held dates, deals, proposals); what its floor
// plan reaches; what its proposals with no event reach; and a record of its
// own the join gives an event and carries the enquiry onto. Every set of
// those is generated against every other, and every path that can make a set
// (or turn a proposal away, so that it reaches nothing) is generated against
// every set of the others. E1 and E2 are live events of the venue; "the
// deleted event" is one of its events that was deleted.
//
// Each case runs in one transaction that is rolled back, so the cases never
// see each other's rows. The suite runs on a throwaway database of its own
// (openSpineDatabase); the shared platform database is only the door to the
// cluster.
// ---------------------------------------------------------------------------

const target = platformTarget();
const LABEL = "reach_parity";

type Live = "E1" | "E2";
type Reached = readonly Live[];

/** How held dates, deals or proposals already in an event put the enquiry in it. */
const HELD_PATHS = ["booking", "deal", "proposal"] as const;
type HeldPath = (typeof HELD_PATHS)[number];

/** How one proposal of the enquiry with no event reaches one event. */
const ONE_PATHS = ["its deal's event", "its deposit request", "its own plan"] as const;
type OnePath = (typeof ONE_PATHS)[number];

/** How proposals with no event reach both events: two proposals by one path, or one whose plan reaches both. */
const BOTH_PATHS = [
  ...ONE_PATHS,
  "a plan reaching both, sent",
  "a plan reaching both, with an agreement",
  "a plan reaching both, with a deposit request naming none",
  "a plan reaching both, a draft",
] as const;
type BothPath = (typeof BOTH_PATHS)[number];

/** A proposal with no event that reaches nothing, each turned away by one filter of the reading. */
const NOTHING_PATHS = [
  "none",
  "a plan reaching both, not sent",
  "a deleted proposal's deposit request",
  "a withdrawn deposit request",
  "a deal in a deleted event",
] as const;
type NothingPath = (typeof NOTHING_PATHS)[number];

type ProposalsReach =
  | { readonly kind: "nothing"; readonly events: readonly []; readonly path: NothingPath }
  | { readonly kind: "one"; readonly events: readonly [Live]; readonly path: OnePath }
  | { readonly kind: "both"; readonly events: readonly [Live, Live]; readonly path: BothPath };

interface Reach {
  /** Held dates, deals and proposals already in an event, and the path that puts them there. */
  readonly held: { readonly events: Reached; readonly path: HeldPath };
  /** The events the enquiry's floor plan is linked to. */
  readonly plan: Reached;
  /** What its proposals with no event reach. */
  readonly proposals: ProposalsReach;
}

/** A record of the enquiry's own that the join gives an event and carries the enquiry onto. */
const CARRIERS = [
  "none",
  "an open deal with no event",
  "a draft proposal reaching nothing",
  "an open deal whose own proposal reaches E2",
] as const;
type Carrier = (typeof CARRIERS)[number];

type Writer = "ensureEnquiryEvent" | "eventForNewDeal";
type EnquiryKind = "open" | "closed" | "draft" | "request" | "linked to E1" | "linked to the deleted event" | "no";

interface Case {
  readonly writer: Writer;
  readonly enquiry: EnquiryKind;
  readonly carrier: Carrier;
  readonly reach: Reach;
}

const SETS: readonly Reached[] = [[], ["E1"], ["E2"], ["E1", "E2"]];
const HELD_SETS: readonly Reached[] = [[], ["E1"], ["E1", "E2"]];
const NO_REACH: Reach = { held: { events: [], path: "booking" }, plan: [], proposals: { kind: "nothing", events: [], path: "none" } };

/** A set of events the proposals reach, each through its own deposit request. */
function byDepositRequest(events: Reached): ProposalsReach {
  const [first, second] = events;
  if (first === undefined) return { kind: "nothing", events: [], path: "none" };
  if (second === undefined) return { kind: "one", events: [first], path: "its deposit request" };
  return { kind: "both", events: [first, second], path: "its deposit request" };
}

const PROPOSAL_PATHS: readonly ProposalsReach[] = [
  ...NOTHING_PATHS.map((path): ProposalsReach => ({ kind: "nothing", events: [], path })),
  ...ONE_PATHS.flatMap((path): ProposalsReach[] => [{ kind: "one", events: ["E1"], path }, { kind: "one", events: ["E2"], path }]),
  ...BOTH_PATHS.map((path): ProposalsReach => ({ kind: "both", events: ["E1", "E2"], path })),
];

/** Every (held, plan, proposals) set the join tells apart, each made by one path. */
function* everySet(): Generator<Reach> {
  for (const held of HELD_SETS) {
    for (const plan of SETS) {
      for (const proposals of SETS) yield { held: { events: held, path: "booking" }, plan, proposals: byDepositRequest(proposals) };
    }
  }
}

/** Every path of the proposals' reach against every held set and plan; every path of the held set against every set. */
function* everyPath(): Generator<Reach> {
  for (const held of HELD_SETS) {
    for (const plan of SETS) for (const proposals of PROPOSAL_PATHS) yield { held: { events: held, path: "booking" }, plan, proposals };
  }
  for (const path of HELD_PATHS.filter((p) => p !== "booking")) {
    for (const held of HELD_SETS.filter((set) => set.length > 0)) {
      for (const plan of SETS) {
        for (const proposals of SETS) yield { held: { events: held, path }, plan, proposals: byDepositRequest(proposals) };
      }
    }
  }
}

function setName(events: Reached): string {
  return events.length === 0 ? "nothing" : events.join("+");
}

function caseName(k: Case): string {
  const { held, plan, proposals } = k.reach;
  const heldPart = held.events.length === 0 ? "holds nothing" : `holds ${setName(held.events)} by ${held.path}`;
  const proposalPart = proposals.kind === "nothing"
    ? `proposals reach nothing${proposals.path === "none" ? "" : ` (${proposals.path})`}`
    : `proposals reach ${setName(proposals.events)} by ${proposals.path}`;
  return `${k.writer} | ${k.enquiry} enquiry | ${heldPart} | plan ${setName(plan)} | ${proposalPart} | carrier ${k.carrier}`;
}

function generate(): readonly Case[] {
  const cases = new Map<string, Case>();
  const add = (k: Case): void => { cases.set(caseName(k), k); };
  // The enquiry's writer: every path, then every set against each state and carrier, then the gates.
  for (const reach of everyPath()) add({ writer: "ensureEnquiryEvent", enquiry: "open", carrier: "none", reach });
  for (const carrier of CARRIERS) {
    for (const enquiry of ["open", "closed"] as const) {
      for (const reach of everySet()) add({ writer: "ensureEnquiryEvent", enquiry, carrier, reach });
    }
  }
  for (const enquiry of ["draft", "request", "linked to E1"] as const) {
    for (const reach of everySet()) add({ writer: "ensureEnquiryEvent", enquiry, carrier: "none", reach });
  }
  // The deal's writer reads the same reach through the same decision (eventReached on readEnquiryReach), so it
  // meets every set against each state and gate. The new deal is itself the record the join would carry its
  // enquiry on, so it meets no other carrier.
  for (const enquiry of ["open", "closed", "draft", "request", "linked to E1", "linked to the deleted event"] as const) {
    for (const reach of everySet()) add({ writer: "eventForNewDeal", enquiry, carrier: "none", reach });
  }
  add({ writer: "eventForNewDeal", enquiry: "no", carrier: "none", reach: NO_REACH });
  return [...cases.values()];
}

/**
 * The one row where a writer abstains while the join acts: a closed enquiry
 * that reaches nothing itself, with a deal or a proposal of its own that the
 * join gives an event and carries the enquiry onto. A closed enquiry gets no
 * event from its own writer, so there the writer writes nothing, and the join
 * run after it still arrives where the join alone does.
 */
function writerAbstains(k: Case): boolean {
  const { held, plan, proposals } = k.reach;
  return k.writer === "ensureEnquiryEvent" && k.enquiry === "closed" && k.carrier !== "none"
    && held.events.length === 0 && plan.length === 0 && proposals.kind === "nothing";
}

/** What a case's starting rows name. */
interface Seeded {
  readonly enquiryId: string | null;
  readonly configurationId: string | null;
}

interface Fixed {
  readonly venue: SpineVenue;
  readonly events: Readonly<Record<Live | "deleted", string>>;
  readonly plans: Readonly<Record<Live | "both", string>>;
  readonly reachText: string;
}

interface Run {
  readonly joinAlone: string;
  readonly writerAlone: string;
  /** The join run after the writer: where the writer abstains, or differs from the join alone; otherwise not run. */
  readonly joinAfterWriter: string;
  readonly proposals: { readonly join: readonly string[]; readonly writers: readonly string[] };
}

/** One row written through the case's connection, and its id. */
async function one(c: PoolClient, text: string, values: readonly unknown[]): Promise<string> {
  const [row] = (await c.query<{ id: string }>(text, [...values])).rows;
  if (row === undefined) throw new Error("The fixture wrote no row");
  return row.id;
}

/** Names an event as the cases name it: E1, E2, the deleted event, or a new one in order of appearance. */
function namer(fixed: Fixed): (eventId: string) => string {
  const made: string[] = [];
  return (eventId) => {
    if (eventId === fixed.events.E1) return "E1";
    if (eventId === fixed.events.E2) return "E2";
    if (eventId === fixed.events.deleted) return "the deleted event";
    if (!made.includes(eventId)) made.push(eventId);
    return `new event ${String(made.indexOf(eventId) + 1)}`;
  };
}

describe.skipIf(target === undefined)("the spine's live writers decide what an enquiry reaches as the join of old records does", () => {
  let spine: SpineDatabase;
  let pool: Pool;
  let fixed: Fixed;

  beforeAll(async () => {
    spine = await openSpineDatabase(LABEL);
    pool = spine.pool;
    const v = await venueIn(pool, "reach parity");
    const c = await pool.connect();
    try {
      const event = (name: string, deleted: boolean): Promise<string> => one(c,
        "INSERT INTO events (venue_id, name, status, deleted_at) VALUES ($1, $2, 'draft', CASE WHEN $3 THEN now() END) RETURNING id",
        [v.venueId, name, deleted]);
      const events = { E1: await event("E1", false), E2: await event("E2", false), deleted: await event("Deleted", true) };
      const plan = async (eventIds: readonly string[]): Promise<string> => {
        const planId = await one(c, `INSERT INTO configurations (space_id, venue_id, name, layout_style)
          VALUES ($1, $2, 'Fixture plan', 'dinner-rounds') RETURNING id`, [v.rooms.hall, v.venueId]);
        for (const eventId of eventIds) {
          await c.query("INSERT INTO event_configuration_links (event_id, configuration_id, link_type) VALUES ($1, $2, 'source_configuration')",
            [eventId, planId]);
        }
        return planId;
      };
      const plans = { E1: await plan([events.E1]), E2: await plan([events.E2]), both: await plan([events.E1, events.E2]) };
      // The join's own reading of what a proposal with no event reaches, as the database stores the function.
      const [stored] = (await c.query<{ source: string }>(
        "SELECT prosrc AS source FROM pg_proc WHERE proname = 'spine_join_old_records'")).rows;
      const reachText = /proposals_reach CONSTANT text := \$reach\$([\s\S]+?)\$reach\$;/u.exec(stored?.source ?? "")?.[1];
      if (reachText === undefined) throw new Error("The join's reading of what a proposal reaches is not in the stored function");
      fixed = { venue: v, events, plans, reachText };
    } finally {
      c.release();
    }
  }, 180_000);
  // Ending the pool and the forced drop of the migrated throwaway database can pass the 10 s default hook budget.
  afterAll(async () => { await spine?.close(); }, 120_000);

  // -- The starting rows -----------------------------------------------------

  async function seed(c: PoolClient, k: Case): Promise<Seeded> {
    const v = fixed.venue;
    const venueId = v.venueId;
    const eventOf = (live: Live): string => fixed.events[live];
    // A closed deal carries the moment it closed, and a sent proposal the moment it was sent, as their checks ask.
    const deal = (stage: "new" | "qualified" | "lost", enquiryId: string | null, eventId: string | null): Promise<string> => one(c,
      `INSERT INTO opportunities (venue_id, title, stage, source_enquiry_id, event_id, closed_at)
        VALUES ($1, 'Fixture deal', $2, $3, $4, CASE WHEN $5 THEN now() END) RETURNING id`,
      [venueId, stage, enquiryId, eventId, stage === "lost"]);
    const proposal = (status: "draft" | "sent" | "declined", links: {
      readonly enquiryId?: string; readonly dealId?: string; readonly planId?: string; readonly eventId?: string; readonly deleted?: boolean;
    }): Promise<string> => one(c,
      `INSERT INTO proposals (venue_id, title, status, sent_at, opportunity_id, enquiry_id, configuration_id, event_id, deleted_at)
        VALUES ($1, 'Fixture proposal', $2, CASE WHEN $3 THEN now() END, $4, $5, $6, $7, CASE WHEN $8 THEN now() END) RETURNING id`,
      [venueId, status, status !== "draft", links.dealId ?? null, links.enquiryId ?? null, links.planId ?? null, links.eventId ?? null,
        links.deleted ?? false]);
    const depositRequest = (proposalId: string, eventId: string | null, withdrawn = false): Promise<string> => one(c,
      `INSERT INTO proposal_deposit_requests (venue_id, proposal_id, event_id, proposal_version, proposal_version_hash, basis,
          quote_total_minor, amount_minor, currency, cancelled_at)
        VALUES ($1, $2, $3, 1, $4, 'amount', 100000, 25000, 'GBP', CASE WHEN $5 THEN now() END) RETURNING id`,
      [venueId, proposalId, eventId, "a".repeat(64), withdrawn]);
    const agreement = (proposalId: string): Promise<string> => one(c,
      `INSERT INTO proposal_contract_versions (venue_id, proposal_id, version, proposal_version, proposal_version_hash, document, document_hash)
        VALUES ($1, $2, 1, 1, $3, '{}'::jsonb, $4) RETURNING id`, [venueId, proposalId, "a".repeat(64), "b".repeat(64)]);

    if (k.enquiry === "no") return { enquiryId: null, configurationId: null };

    const { held, plan, proposals } = k.reach;
    const [onlyPlan] = plan;
    const planId = plan.length === 2 ? fixed.plans.both : onlyPlan === undefined ? null : fixed.plans[onlyPlan];
    const enquiryId = randomUUID();
    const state = k.enquiry === "closed" ? "withdrawn" : k.enquiry === "draft" ? "draft" : "submitted";
    const link = k.enquiry === "linked to E1" ? fixed.events.E1 : k.enquiry === "linked to the deleted event" ? fixed.events.deleted : null;
    // The enquiry's writer is called by an act that works the enquiry, so that enquiry starts with a reply recorded.
    const replied = k.writer === "ensureEnquiryEvent" && state !== "draft";
    await c.query(`INSERT INTO enquiries (id, venue_id, space_id, state, name, email, event_type, configuration_id, event_id,
        first_response_at, first_response_channel, first_response_recorded_at)
      VALUES ($1, $2, $3, $4, 'Fixture enquirer', $5, $6, $7, $8,
        CASE WHEN $9 THEN now() END, CASE WHEN $9 THEN 'email' END, CASE WHEN $9 THEN now() END)`,
    [enquiryId, venueId, v.rooms.hall, state, `${enquiryId}@event-spine.invalid`, k.enquiry === "request" ? "venue-access" : "wedding",
      planId, link, replied]);

    const rooms: Readonly<Record<Live, string>> = { E1: v.rooms.saloon, E2: v.rooms.reception };
    for (const live of held.events) {
      if (held.path === "booking") {
        await c.query(`INSERT INTO bookings (venue_id, space_id, kind, title, starts_at, ends_at, event_id, enquiry_id, created_by)
          VALUES ($1, $2, 'prospect', 'Interest only', '2031-08-09T12:00:00Z', '2031-08-09T14:00:00Z', $3, $4, $5)`,
        [venueId, rooms[live], eventOf(live), enquiryId, v.admin.id]);
      } else if (held.path === "deal") {
        // A lost deal: it puts the enquiry in its event and leaves the event free for a new open deal.
        await deal("lost", enquiryId, eventOf(live));
      } else {
        await proposal("sent", { enquiryId, eventId: eventOf(live) });
      }
    }

    const reaching = async (live: Live, path: OnePath): Promise<void> => {
      if (path === "its deal's event") await proposal("sent", { enquiryId, dealId: await deal("lost", null, eventOf(live)) });
      else if (path === "its deposit request") await depositRequest(await proposal("sent", { enquiryId }), eventOf(live));
      // Not sent, so its plan counts only because the plan is linked to exactly one event.
      else await proposal("declined", { enquiryId, planId: fixed.plans[live] });
    };
    if (proposals.kind === "one") {
      await reaching(proposals.events[0], proposals.path);
    } else if (proposals.kind === "both") {
      const path = proposals.path;
      if (path === "its deal's event" || path === "its deposit request" || path === "its own plan") {
        await reaching("E1", path);
        await reaching("E2", path);
      } else if (path === "a plan reaching both, sent") {
        await proposal("sent", { enquiryId, planId: fixed.plans.both });
      } else if (path === "a plan reaching both, with an agreement") {
        await agreement(await proposal("declined", { enquiryId, planId: fixed.plans.both }));
      } else if (path === "a plan reaching both, with a deposit request naming none") {
        await depositRequest(await proposal("declined", { enquiryId, planId: fixed.plans.both }), null);
      } else {
        await proposal("draft", { enquiryId, planId: fixed.plans.both });
      }
    } else {
      const path = proposals.path;
      if (path === "a plan reaching both, not sent") {
        await proposal("declined", { enquiryId, planId: fixed.plans.both });
      } else if (path === "a deleted proposal's deposit request") {
        await depositRequest(await proposal("sent", { enquiryId, deleted: true }), fixed.events.E2);
      } else if (path === "a withdrawn deposit request") {
        await depositRequest(await proposal("declined", { enquiryId }), fixed.events.E2, true);
      } else if (path === "a deal in a deleted event") {
        await proposal("declined", { enquiryId, dealId: await deal("lost", null, fixed.events.deleted) });
      }
    }

    if (k.carrier === "an open deal with no event") {
      await deal("qualified", enquiryId, null);
    } else if (k.carrier === "a draft proposal reaching nothing") {
      await proposal("draft", { enquiryId });
    } else if (k.carrier === "an open deal whose own proposal reaches E2") {
      await depositRequest(await proposal("sent", { dealId: await deal("qualified", enquiryId, null) }), fixed.events.E2);
    }
    return { enquiryId, configurationId: planId };
  }

  /** The deal the deal's writer makes, as the deal routes insert it: new, from the enquiry, with the event chosen for it. */
  function insertDeal(c: PoolClient, seeded: Seeded, eventId: string | null): Promise<string> {
    return one(c, `INSERT INTO opportunities (venue_id, title, stage, source_enquiry_id, event_id, owner_user_id)
      VALUES ($1, 'Fixture deal', 'new', $2, $3, $4) RETURNING id`, [fixed.venue.venueId, seeded.enquiryId, eventId, fixed.venue.admin.id]);
  }

  // -- Where records stand ---------------------------------------------------

  async function standing(
    c: PoolClient, table: "enquiries" | "opportunities", kind: "enquiry" | "opportunity", id: string, name: (eventId: string) => string,
  ): Promise<string> {
    const [row] = (await c.query<{ event_id: string | null; listed: boolean }>(
      `SELECT r.event_id, EXISTS (SELECT 1 FROM event_link_reviews l WHERE l.subject_kind = $2 AND l.subject_id = r.id
          AND l.resolved_at IS NULL AND l.binding_review_id IS NULL) AS listed
        FROM ${table} r WHERE r.id = $1`, [id, kind])).rows;
    if (row === undefined) throw new Error(`No ${kind} ${id}`);
    return row.event_id !== null ? name(row.event_id) : row.listed ? "listed" : "no event";
  }

  /** Where the case's enquiry and deal stand: their events by name, "listed", or "no event". */
  async function where(c: PoolClient, seeded: Seeded, dealId: string | null): Promise<string> {
    const name = namer(fixed);
    const parts: string[] = [];
    if (seeded.enquiryId !== null) parts.push(`enquiry: ${await standing(c, "enquiries", "enquiry", seeded.enquiryId, name)}`);
    if (dealId !== null) parts.push(`deal: ${await standing(c, "opportunities", "opportunity", dealId, name)}`);
    return parts.join("; ");
  }

  async function join(c: PoolClient): Promise<void> {
    await c.query("SELECT * FROM spine_join_old_records()");
  }

  /** The writer, on the case's rows: where it leaves them, and the deal it made (for the deal's writer). */
  async function write(c: PoolClient, k: Case, seeded: Seeded): Promise<{ readonly standing: string; readonly dealId: string | null }> {
    const conn: Database = drizzle(c, { schema });
    if (k.writer === "ensureEnquiryEvent") {
      if (seeded.enquiryId === null) throw new Error("The enquiry's writer needs an enquiry");
      const outcome = await ensureEnquiryEvent(conn, seeded.enquiryId, fixed.venue.admin.id);
      // Refused because its records reach several events: nothing is written, and the enquiry is for the join's list.
      if (!outcome.ok && outcome.code === "ENQUIRY_REACHES_SEVERAL_EVENTS") return { standing: "enquiry: listed", dealId: null };
      return { standing: await where(c, seeded, null), dealId: null };
    }
    const outcome = await eventForNewDeal(conn, {
      venueId: fixed.venue.venueId, sourceEnquiryId: seeded.enquiryId, title: "Fixture deal", eventType: null, createdBy: fixed.venue.admin.id,
    });
    if (!outcome.ok) return { standing: `refused: ${outcome.code}`, dealId: null };
    const dealId = await insertDeal(c, seeded, outcome.eventId);
    // Made with no event while its enquiry's records reach several: the join lists the enquiry and the deal waits.
    if (outcome.eventId === null) return { standing: "enquiry: listed; deal: no event", dealId };
    return { standing: await where(c, seeded, dealId), dealId };
  }

  /** What the join's own reading, and the writers' reading, say the enquiry's proposals with no event reach. */
  async function proposalsReached(c: PoolClient, seeded: Seeded): Promise<Run["proposals"]> {
    if (seeded.enquiryId === null) return { join: [], writers: [] };
    const name = namer(fixed);
    const [row] = (await c.query<{ reached: string[] }>(`SELECT r::text[] AS reached FROM (${fixed.reachText}) AS t(r)`,
      [fixed.venue.venueId, seeded.enquiryId, null, [...SENT_PROPOSAL_STATUSES]])).rows;
    if (row === undefined) throw new Error("The join's reading answered nothing");
    const conn: Database = drizzle(c, { schema });
    const reach = await readEnquiryReach(conn, { id: seeded.enquiryId, venueId: fixed.venue.venueId, configurationId: seeded.configurationId });
    return { join: row.reached.map(name).sort(), writers: reach.proposals.map(name).sort() };
  }

  async function run(k: Case): Promise<Run> {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const seeded = await seed(c, k);
      await c.query("SAVEPOINT starting_rows");
      // The join alone. The deal the writer would make stands among the rows it reads, with no event.
      const unjoinedDeal = k.writer === "eventForNewDeal" ? await insertDeal(c, seeded, null) : null;
      await join(c);
      const joinAlone = await where(c, seeded, unjoinedDeal);
      await c.query("ROLLBACK TO SAVEPOINT starting_rows");
      const proposals = await proposalsReached(c, seeded);
      // The writer alone, on the same rows; then, where it abstains or differs, the join after it.
      const written = await write(c, k, seeded);
      if (!writerAbstains(k) && written.standing === joinAlone) {
        return { joinAlone, writerAlone: written.standing, joinAfterWriter: "not run", proposals };
      }
      await join(c);
      return { joinAlone, writerAlone: written.standing, joinAfterWriter: await where(c, seeded, written.dealId), proposals };
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }

  const cases = generate();

  it("generates every combination of the join's dimensions, each once", () => {
    // ensureEnquiryEvent: 18 proposal paths x 3 held sets x 4 plans, and 2 more held paths x 2 held sets x 4 plans x
    // 4 proposal sets (280); 48 sets x 2 states x 4 carriers (384, of which the 48 open with no carrier are among
    // the paths); 48 sets x 3 gates (144). eventForNewDeal: 48 sets x 6 enquiries, and a deal with no enquiry.
    expect(cases.filter((k) => k.writer === "ensureEnquiryEvent")).toHaveLength(280 + 384 - 48 + 144);
    expect(cases.filter((k) => k.writer === "eventForNewDeal")).toHaveLength(48 * 6 + 1);
    expect(cases.filter(writerAbstains)).toHaveLength(3);
    expect(new Set(cases.map(caseName)).size).toBe(cases.length);
  });

  for (const k of cases) {
    it(caseName(k), async () => {
      const result = await run(k);
      expect(result.proposals.writers, "what its proposals with no event reach").toEqual(result.proposals.join);
      if (writerAbstains(k)) {
        expect(result.writerAlone, "the writer alone, which abstains").toBe("enquiry: no event");
        expect(result.joinAfterWriter, "the join, run after the writer").toBe(result.joinAlone);
      } else {
        expect(result.writerAlone, `the writer alone (the join run after it: ${result.joinAfterWriter})`).toBe(result.joinAlone);
      }
    });
  }
});
