import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { EnquiryStatus, OpportunityStage, ProposalStatus } from "@omnitwin/types";
import type { Database } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import type { MutationActor } from "../../services/booking-mutations.js";

// ---------------------------------------------------------------------------
// The spine's suites (the links between proposals, deals, enquiries and their
// event): a database of each suite's own, and the rows they are made from.
//
// The platform database on the test cluster is shared and never truncated, so
// a spine suite never applies the spine's migration to it. It uses it only as
// the door to the cluster: openSpineDatabase makes a throwaway database there,
// migrates it with the repository's own migrator and folder, and close() drops
// it. The fixtures insert with plain SQL and return ids.
// ---------------------------------------------------------------------------

const MIGRATIONS = resolve(import.meta.dirname, "../../../drizzle");
const OUTLINE = [{ x: -10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, { x: -10, y: 5 }];

/** Anything a fixture can write through: the suite's pool or one of its clients. */
export interface Queryable {
  query: Pool["query"];
}

export interface SpineDatabase {
  readonly pool: Pool;
  readonly db: Database;
  readonly url: string;
  close(): Promise<void>;
}

/** The platform test cluster's door, as every platform suite guards it. */
export function platformTarget(): string | undefined {
  const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
  if (target !== undefined) {
    const parsed = new URL(target);
    if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
      || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
      throw new Error("The spine's tests require the explicit disposable platform database");
    }
  }
  return target;
}

/** A migrated database of the suite's own on the platform cluster, dropped by close(). */
export async function openSpineDatabase(label: string): Promise<SpineDatabase> {
  const target = platformTarget();
  if (target === undefined) throw new Error("VENVIEWER_PLATFORM_TEST_DATABASE_URL is required");
  const name = `venviewer_spine_${randomBytes(8).toString("hex")}`;
  const url = new URL(target);
  url.pathname = `/${name}`;
  const applicationName = `spine_${label}`.replace(/[^A-Za-z0-9_]+/gu, "_").slice(0, 60);
  const door = new Pool({ connectionString: target, max: 1, application_name: `${applicationName}_door` });
  let pool: Pool | undefined;
  try {
    await door.query(`CREATE DATABASE "${name}"`);
    pool = new Pool({ connectionString: url.toString(), application_name: applicationName, max: 8,
      options: "-c statement_timeout=30000 -c lock_timeout=20000" });
    // Ending a pool does not wait for its connections to close, so the forced
    // drop can cut one still closing; its "terminating connection" (57P01) is
    // expected then, and nothing else is.
    pool.on("error", (error: Error & { readonly code?: string }) => { if (error.code !== "57P01") throw error; });
    const [row] = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows;
    if (row?.name !== name) throw new Error("Connected to the wrong database");
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  } catch (error) {
    await pool?.end();
    await door.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).finally(() => door.end());
    throw error;
  }
  const opened = pool;
  const db: Database = drizzle(opened, { schema });
  let closed = false;
  return {
    pool: opened,
    db,
    url: url.toString(),
    async close() {
      if (closed) return;
      closed = true;
      try {
        await opened.end();
        await door.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await door.end();
      }
    },
  };
}

export interface SpineActor extends MutationActor { readonly platformRole: "none" }

export interface SpineVenue {
  readonly venueId: string;
  readonly rooms: { readonly hall: string; readonly saloon: string; readonly reception: string };
  readonly admin: SpineActor;
}

async function insertedId(client: Queryable, text: string, values: readonly unknown[]): Promise<string> {
  const [row] = (await client.query<{ id: string }>(text, [...values])).rows;
  if (row === undefined) throw new Error("The fixture wrote no row");
  return row.id;
}

/** A venue with three rooms and its coordinator. Only its slug must be unique. */
export async function venue(client: Queryable, label: string): Promise<SpineVenue> {
  const venueId = randomUUID();
  await client.query("INSERT INTO venues (id, name, slug, address) VALUES ($1, $2, $3, 'Disposable fixture')",
    [venueId, `TEST ONLY ${label}`, `event-spine-${venueId}`]);
  const rooms = { hall: randomUUID(), saloon: randomUUID(), reception: randomUUID() };
  const named = [[rooms.hall, "Grand Hall"], [rooms.saloon, "Saloon"], [rooms.reception, "Reception Room"]] as const;
  for (const [index, [id, room]] of named.entries()) {
    await client.query(`INSERT INTO spaces (id, venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline, sort_order)
      VALUES ($1, $2, $3, $4, 20, 10, 6, $5::jsonb, $6)`, [id, venueId, room, `room-${id}`, JSON.stringify(OUTLINE), index]);
  }
  const adminId = randomUUID();
  await client.query("INSERT INTO users (id, email, name, role, venue_id) VALUES ($1, $2, 'Fixture coordinator', 'admin', $3)",
    [adminId, `${adminId}@event-spine.invalid`, venueId]);
  return { venueId, rooms, admin: { id: adminId, role: "admin", venueId, platformRole: "none" } };
}

/** An event with no dates, as a draft. */
export async function event(client: Queryable, venueId: string, name: string): Promise<string> {
  return insertedId(client, "INSERT INTO events (venue_id, name, status) VALUES ($1, $2, 'draft') RETURNING id", [venueId, name]);
}

/** An enquiry filed against the venue's first room. */
export async function enquiry(
  client: Queryable, venueId: string, state: EnquiryStatus = "submitted", eventType: string | null = "wedding",
): Promise<string> {
  const id = randomUUID();
  return insertedId(client, `INSERT INTO enquiries (id, venue_id, space_id, state, name, email, event_type)
    SELECT $1, $2, s.id, $3, 'Fixture enquirer', $4, $5 FROM spaces s WHERE s.venue_id = $2
    ORDER BY s.sort_order, s.id LIMIT 1 RETURNING id`, [id, venueId, state, `${id}@event-spine.invalid`, eventType]);
}

/** A deal, from an enquiry when one is named. */
export async function deal(
  client: Queryable, venueId: string, stage: OpportunityStage = "new", enquiryId: string | null = null,
): Promise<string> {
  const closed = stage === "won" || stage === "lost" || stage === "archived";
  return insertedId(client, `INSERT INTO opportunities (venue_id, title, stage, source_enquiry_id, closed_at)
    VALUES ($1, 'Fixture deal', $2, $3, CASE WHEN $4 THEN now() END) RETURNING id`,
  [venueId, stage, enquiryId, closed]);
}

export interface ProposalLinks {
  readonly opportunityId?: string;
  readonly enquiryId?: string;
  readonly configurationId?: string;
}

/** The statuses that must carry a sent_at (proposals_sent_status_coherent, migration 0026). */
const SENT_STATES = ["sent", "changes_requested", "accepted", "declined", "expired"] as const satisfies readonly ProposalStatus[];

/** A proposal; one that was sent carries the moment it was sent, as its CHECK asks. */
export async function proposal(
  client: Queryable, venueId: string, status: ProposalStatus = "draft", links: ProposalLinks = {},
): Promise<string> {
  const sent = (SENT_STATES as readonly string[]).includes(status);
  return insertedId(client, `INSERT INTO proposals (venue_id, title, status, sent_at, opportunity_id, enquiry_id, configuration_id)
    VALUES ($1, 'Fixture proposal', $2, CASE WHEN $3 THEN now() END, $4, $5, $6) RETURNING id`,
  [venueId, status, sent, links.opportunityId ?? null, links.enquiryId ?? null, links.configurationId ?? null]);
}

/** A client account of the venue. */
export async function clientAccount(client: Queryable, venueId: string): Promise<string> {
  return insertedId(client, "INSERT INTO client_accounts (venue_id, name) VALUES ($1, 'Fixture account') RETURNING id", [venueId]);
}

export interface ReviewRow {
  readonly venue_id: string;
  readonly subject_kind: string;
  readonly subject_id: string;
  readonly reason: string;
  readonly detail: string;
  readonly candidate_event_ids?: readonly string[];
  readonly binding_review_id?: string;
}

/** One question on the list of joins to check, written as given. */
export async function insertReview(client: Queryable, row: ReviewRow): Promise<string> {
  return insertedId(client, `INSERT INTO event_link_reviews
    (venue_id, subject_kind, subject_id, reason, detail, candidate_event_ids, binding_review_id)
    VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7) RETURNING id`, [row.venue_id, row.subject_kind, row.subject_id,
    row.reason, row.detail, row.candidate_event_ids ?? [], row.binding_review_id ?? null]);
}

/** The three tables that point at their event. */
export type LinkedTable = "enquiries" | "opportunities" | "proposals";

/** One row of a linked table, with no event. */
export async function record(client: Queryable, table: LinkedTable, venueId: string): Promise<string> {
  if (table === "enquiries") return enquiry(client, venueId);
  if (table === "opportunities") return deal(client, venueId);
  return proposal(client, venueId);
}

/** Point a row at an event, or empty its link (null). */
export async function link(client: Queryable, table: LinkedTable, id: string, eventId: string | null): Promise<void> {
  const updated = await client.query(`UPDATE ${table} SET event_id = $2 WHERE id = $1`, [id, eventId]);
  if (updated.rowCount !== 1) throw new Error(`No ${table} row ${id}`);
}
