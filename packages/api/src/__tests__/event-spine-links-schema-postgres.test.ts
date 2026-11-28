import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  clientAccount as clientAccountIn,
  deal as dealIn,
  event as eventIn,
  insertReview as insertReviewIn,
  link as linkIn,
  openSpineDatabase,
  platformTarget,
  proposal as proposalIn,
  record as recordIn,
  venue as venueIn,
  type LinkedTable,
  type ReviewRow,
  type SpineDatabase,
} from "./helpers/event-spine-fixtures.js";

// ---------------------------------------------------------------------------
// The spine's links in the database (migration *_event_spine_links, first
// half): proposals, deals and enquiries point at their event the way a
// booking does, pinned to their venue by (event_id, venue_id); a link may be
// moved, never emptied; one open deal per event; an event's client account
// is its own venue's; and the list of joins to check keeps one open question
// per record and reason. Then the file itself: run again over a database that
// already has it, it copies October's two kinds of question without their
// text, leaves its notes of a derived status where they are, and changes
// nothing else.
//
// The suite runs on a throwaway database of its own (openSpineDatabase); the
// shared platform database is only the door to the cluster.
// ---------------------------------------------------------------------------

const target = platformTarget();
const MIGRATIONS = resolve(import.meta.dirname, "../../drizzle");
const JournalSchema = z.object({ entries: z.array(z.object({ tag: z.string() }).passthrough()) }).passthrough();

interface CopiedReviewRow {
  readonly subject_kind: string;
  readonly subject_id: string;
  readonly reason: string;
  readonly candidate_event_ids: string[];
  readonly detail: string;
  readonly binding_review_id: string | null;
  readonly created_at: Date;
  readonly resolved_at: Date | null;
}

describe.skipIf(target === undefined)("the spine: the rules the database holds", () => {
  let spine: SpineDatabase;
  let pool: Pool;

  beforeAll(async () => {
    spine = await openSpineDatabase("links_schema");
    pool = spine.pool;
  }, 180_000);
  afterAll(async () => { await spine?.close(); });

  const venue = (label: string) => venueIn(pool, label);
  const event = (venueId: string, name: string) => eventIn(pool, venueId, name);
  const deal = (venueId: string, stage?: Parameters<typeof dealIn>[2]) => dealIn(pool, venueId, stage);
  const proposal = (venueId: string, status?: Parameters<typeof proposalIn>[2]) => proposalIn(pool, venueId, status);
  const clientAccount = (venueId: string) => clientAccountIn(pool, venueId);
  const insertReview = (row: ReviewRow) => insertReviewIn(pool, row);
  const record = (table: LinkedTable, venueId: string) => recordIn(pool, table, venueId);
  const link = (table: LinkedTable, id: string, eventId: string | null) => linkIn(pool, table, id, eventId);

  it.each(["enquiries", "opportunities", "proposals"] as const)("refuses a link from %s to another venue's event", async (table) => {
    const here = await venue("links here"), there = await venue("links there");
    const theirs = await event(there.venueId, "Their event");
    await expect(link(table, await record(table, here.venueId), theirs)).rejects.toThrow(new RegExp(`${table}_event_venue_fk`));
  });
  it.each(["enquiries", "opportunities", "proposals"] as const)("lets a link on %s be moved, and refuses emptying it", async (table) => {
    const v = await venue("kept link");
    const id = await record(table, v.venueId);
    await link(table, id, await event(v.venueId, "First"));
    await link(table, id, await event(v.venueId, "Second"));
    await expect(link(table, id, null)).rejects.toThrow(/An event link cannot be removed, only moved/);
  });
  it("refuses a second open deal on one event, and allows a lost one beside it", async () => {
    const v = await venue("one open deal");
    const e = await event(v.venueId, "Dinner");
    await link("opportunities", await deal(v.venueId, "new"), e);
    await link("opportunities", await deal(v.venueId, "lost"), e);
    await expect(link("opportunities", await deal(v.venueId, "qualified"), e)).rejects.toThrow(/opportunities_one_open_per_event/);
  });
  it("refuses an event that names another venue's client account", async () => {
    const here = await venue("accounts here"), there = await venue("accounts there");
    const account = await clientAccount(there.venueId);
    await expect(pool.query("UPDATE events SET client_account_id = $1 WHERE id = $2", [account, await event(here.venueId, "Ours")]))
      .rejects.toThrow(/events_client_account_venue_fk/);
  });
  it("refuses deleting an event a link points at", async () => {
    const v = await venue("restrict");
    const e = await event(v.venueId, "Held");
    await link("proposals", await proposal(v.venueId, "sent"), e);
    await expect(pool.query("DELETE FROM events WHERE id = $1", [e])).rejects.toThrow(/proposals_event_venue_fk/);
  });
  it("keeps one open question for each record and reason", async () => {
    const v = await venue("one question");
    const row = { venue_id: v.venueId, subject_kind: "proposal", subject_id: randomUUID(), reason: "reaches_many_events", detail: "It reaches 2 events." };
    await insertReview(row);
    await expect(insertReview(row)).rejects.toThrow(/event_link_reviews_open_unique/);
  });

  it("lets the undo empty a link, and only the undo", async () => {
    const v = await venue("undo");
    const id = await record("proposals", v.venueId);
    await link("proposals", id, await event(v.venueId, "Joined by mistake"));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('venviewer.undo_event_links', 'on', true)");
      await linkIn(client, "proposals", id, null);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    expect((await pool.query("SELECT event_id FROM proposals WHERE id = $1", [id])).rows).toEqual([{ event_id: null }]);
  });

  it("removes an event's client account with the account, keeping the event at its venue", async () => {
    const v = await venue("account removed");
    const account = await clientAccount(v.venueId);
    const e = await event(v.venueId, "Kept");
    await pool.query("UPDATE events SET client_account_id = $1 WHERE id = $2", [account, e]);
    await pool.query("DELETE FROM client_accounts WHERE id = $1", [account]);
    expect((await pool.query("SELECT venue_id, client_account_id FROM events WHERE id = $1", [e])).rows)
      .toEqual([{ venue_id: v.venueId, client_account_id: null }]);
  });

  it("copies October's two kinds of question without their text, leaves its status notes, and changes nothing else when run again", async () => {
    const v = await venue("october");
    const e = await event(v.venueId, "Mair wedding");
    const bookingId = randomUUID();
    await pool.query(`INSERT INTO bookings (id, venue_id, space_id, event_id, kind, title, starts_at, ends_at)
      VALUES ($1, $2, $3, $4, 'prospect', 'Mair wedding', now() + interval '400 days', now() + interval '400 days 4 hours')`,
    [bookingId, v.venueId, v.rooms.hall, e]);
    const october = (await pool.query<{ id: string; reason: string }>(`INSERT INTO event_binding_reviews
      (venue_id, event_id, booking_id, reason, detail, previous_status, created_at) VALUES
      ($1, $2, $3, 'enquiry_events_differ', 'Joined its enquiry''s event "Mair wedding".', NULL, '2026-10-20T09:00:00Z'),
      ($1, $2, $3, 'possibly_same_event', 'Given a new event. "Mair wedding" is near the same time.', NULL, '2026-10-20T09:00:01Z'),
      ($1, $2, NULL, 'event_status_derived', 'Its status now follows its bookings in the Diary: confirmed became draft.', 'confirmed', '2026-10-20T09:00:02Z')
      RETURNING id, reason`, [v.venueId, e, bookingId])).rows;

    const statements = await migrationStatements();
    const replay = async (): Promise<void> => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const statement of statements) await client.query(statement);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
    const copies = async () => (await pool.query<CopiedReviewRow>(`SELECT subject_kind, subject_id, reason, candidate_event_ids, detail,
      binding_review_id, created_at, resolved_at FROM event_link_reviews WHERE venue_id = $1 ORDER BY created_at`, [v.venueId])).rows;

    await replay();
    const byReason = new Map(october.map((row) => [row.reason, row.id]));
    expect(await copies()).toEqual([
      { subject_kind: "booking", subject_id: bookingId, reason: "enquiry_events_differ", candidate_event_ids: [e],
        detail: expect.stringMatching(/^Carried over from October's list: /u), binding_review_id: byReason.get("enquiry_events_differ"),
        created_at: new Date("2026-10-20T09:00:00Z"), resolved_at: null },
      { subject_kind: "booking", subject_id: bookingId, reason: "possibly_same_event", candidate_event_ids: [e],
        detail: expect.stringMatching(/^Carried over from October's list: /u), binding_review_id: byReason.get("possibly_same_event"),
        created_at: new Date("2026-10-20T09:00:01Z"), resolved_at: null },
    ]);
    // No name crosses: the screen reads October's text through binding_review_id.
    for (const row of await copies()) expect(row.detail).not.toContain("Mair");
    // The note of a derived status is not a question: it stays in October's table, and only there.
    expect((await pool.query("SELECT id FROM event_binding_reviews WHERE venue_id = $1 AND reason = 'event_status_derived'", [v.venueId])).rows)
      .toEqual([{ id: byReason.get("event_status_derived") }]);
    expect((await pool.query("SELECT count(*)::int AS count FROM event_link_reviews WHERE binding_review_id = $1",
      [byReason.get("event_status_derived")])).rows).toEqual([{ count: 0 }]);

    const once = await shape();
    const copied = await copies();
    await replay();
    expect(await shape()).toEqual(once);
    expect(await copies()).toEqual(copied);
  });

  /** The spine migration's statements, found by its tag so a renumbering does not break the test. */
  async function migrationStatements(): Promise<string[]> {
    const journal = JournalSchema.parse(JSON.parse(await readFile(join(MIGRATIONS, "meta/_journal.json"), "utf8")));
    const tags = journal.entries.map((entry) => entry.tag).filter((tag) => tag.endsWith("_event_spine_links"));
    expect(tags).toHaveLength(1);
    return (await readFile(join(MIGRATIONS, `${tags[0] ?? ""}.sql`), "utf8")).split("--> statement-breakpoint");
  }

  /** What the file puts in place, and every row it writes. */
  async function shape(): Promise<Record<string, unknown[]>> {
    const tables = ["enquiries", "opportunities", "proposals", "events", "event_link_joins", "event_link_reviews"];
    return {
      constraints: (await pool.query(`SELECT conrelid::regclass::text AS on_table, conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint WHERE conrelid::regclass::text = ANY($1) ORDER BY 1, 2`, [tables])).rows,
      indexes: (await pool.query(`SELECT tablename, indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY 1, 2`, [tables])).rows,
      triggers: (await pool.query(`SELECT tgrelid::regclass::text AS on_table, tgname, pg_get_triggerdef(oid) AS definition
        FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text = ANY($1) ORDER BY 1, 2`, [tables])).rows,
      columns: (await pool.query(`SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY 1, 2`, [tables])).rows,
      reviews: (await pool.query("SELECT count(*)::int AS count FROM event_link_reviews")).rows,
      joins: (await pool.query("SELECT count(*)::int AS count FROM event_link_joins")).rows,
    };
  }
});
