import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0100 (the enquiry funnel) on a production-shaped database.
//
// Every migration before 0100 is applied, rows are written the way the
// releases before it wrote them, and 0100 is then applied exactly as it ships,
// in one transaction as the migrator runs it. What must hold:
//   - the first reply is filled only from replies Venviewer itself sent — a
//     decision and a proposal sent for the enquiry or its deal's enquiry, at
//     the same venue — earliest first, never before the enquiry arrived, and
//     recorded when it was sent;
//   - a link opened before counting began is left unknown, never given a
//     guessed first visit; a link never opened counts from zero;
//   - every existing booking and enquiry stays valid under the new checks;
//   - the release before it keeps writing what it wrote, unrefused;
//   - running the file again changes nothing.
//
// Opt-in, disposable loopback PostgreSQL only; never reads DATABASE_URL/.env:
//   VENVIEWER_ENQUIRY_FUNNEL_MIGRATION_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/venviewer_enquiry_funnel_migration_test
// The database is emptied before each run: it is this test's alone.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_ENQUIRY_FUNNEL_MIGRATION_TEST_DATABASE_URL"];
const MIGRATION = "0100_enquiry_funnel";

function assertTestTarget(raw: string): void {
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_enquiry_funnel_migration_test" || url.search !== "" || url.hash !== "") {
    throw new Error("The 0100 migration test requires the explicit loopback venviewer_enquiry_funnel_migration_test database");
  }
}

describe("0100 migration PostgreSQL target guard", () => {
  it.each([
    "postgresql://user@production.example/venviewer_enquiry_funnel_migration_test",
    "postgresql://postgres@127.0.0.1/venviewer_enquiry_funnel_test",
    "postgresql://postgres@127.0.0.1/venviewer_enquiry_funnel_migration_test?host=production.example",
  ])("rejects an unsafe target: %s", (url) => {
    expect(() => { assertTestTarget(url); }).toThrow();
  });
});

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

async function applyMigrationFile(pool: Pool, file: string): Promise<void> {
  const migration = await readFile(resolve("drizzle", file), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describe.skipIf(testUrl === undefined)("migration 0100 on a production-shaped PostgreSQL", () => {
  let pool: Pool;
  let folder: string | undefined;
  const venue = randomUUID();
  const otherVenue = randomUUID();
  const hall = randomUUID();
  const theirHall = randomUUID();
  const staff = randomUUID();
  const sales = randomUUID();
  const arrived = new Date("2026-10-01T09:00:00.000Z");
  const later = (minutes: number): Date => new Date(arrived.getTime() + minutes * 60_000);
  const ids = {
    decided: randomUUID(),
    sentThenDeclined: randomUUID(),
    viaDeal: randomUUID(),
    decidedBeforeArrival: randomUUID(),
    reviewedOnly: randomUUID(),
    theirs: randomUUID(),
    proposalDirect: randomUUID(),
    proposalViaDeal: randomUUID(),
    proposalStray: randomUUID(),
    deal: randomUUID(),
    tokenOpened: randomUUID(),
    tokenUnopened: randomUUID(),
    lostBooking: randomUUID(),
  };

  beforeAll(async () => {
    if (testUrl === undefined) throw new Error("Explicit test URL required");
    assertTestTarget(testUrl);
    pool = new Pool({ connectionString: testUrl, application_name: `migration_0100_${randomUUID().slice(0, 8)}`, max: 3 });
    const target = await pool.query<{ database: string }>("SELECT current_database() AS database");
    expect(target.rows[0]?.database).toBe("venviewer_enquiry_funnel_migration_test");
    // This database is the test's alone: start from nothing every run.
    await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    await pool.query("CREATE SCHEMA public");

    // Every migration before 0100, from a copy of the folder whose journal
    // stops just short of it.
    folder = await mkdtemp(join(tmpdir(), "venviewer-before-0100-"));
    await mkdir(join(folder, "meta"));
    const journal = JSON.parse(await readFile(resolve("drizzle/meta/_journal.json"), "utf8")) as { entries: JournalEntry[] } & Record<string, unknown>;
    const cut = journal.entries.findIndex((entry) => entry.tag === MIGRATION);
    expect(cut).toBeGreaterThan(0);
    const before = journal.entries.slice(0, cut);
    await writeFile(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: before }));
    const files = (await readdir(resolve("drizzle"))).filter((file) => before.some((entry) => `${entry.tag}.sql` === file));
    await Promise.all(files.map((file) => copyFile(resolve("drizzle", file), join(folder ?? "", file))));
    await migrate(drizzle(pool), { migrationsFolder: folder });

    // The rows the releases before 0100 wrote.
    const outline = JSON.stringify([{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }]);
    await pool.query(
      "INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Trades Hall', 'trades-hall-glasgow', 'Fixture'), ($2, 'Elsewhere', 'elsewhere', 'Fixture')",
      [venue, otherVenue],
    );
    await pool.query(
      `INSERT INTO spaces (id, venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline) VALUES
       ($1, $2, 'Grand Hall', 'grand-hall', 21, 10.5, 7, $5), ($3, $4, 'Their Hall', 'grand-hall', 21, 10.5, 7, $5)`,
      [hall, venue, theirHall, otherVenue, outline],
    );
    await pool.query(
      "INSERT INTO users (id, email, name, role, venue_id) VALUES ($1, 'staff@example.test', 'Staff', 'staff', $3), ($2, 'sales@example.test', 'Sales', 'sales', $3)",
      [staff, sales, venue],
    );
    const enquiry = async (id: string, venueId: string, spaceId: string): Promise<void> => {
      await pool.query(
        "INSERT INTO enquiries (id, venue_id, space_id, name, email, state, created_at, updated_at, source) VALUES ($1, $2, $3, 'Guest', 'guest@example.test', 'submitted', $4, $4, 'website')",
        [id, venueId, spaceId, arrived],
      );
    };
    for (const id of [ids.decided, ids.sentThenDeclined, ids.viaDeal, ids.decidedBeforeArrival, ids.reviewedOnly]) await enquiry(id, venue, hall);
    await enquiry(ids.theirs, otherVenue, theirHall);
    const history = async (enquiryId: string, from: string, to: string, at: Date, by: string | null): Promise<void> => {
      await pool.query(
        "INSERT INTO enquiry_status_history (enquiry_id, from_status, to_status, changed_by, created_at) VALUES ($1, $2, $3, $4, $5)",
        [enquiryId, from, to, by, at],
      );
    };
    // Decided two hours in: the decision is its first reply.
    await history(ids.decided, "submitted", "under_review", later(30), staff);
    await history(ids.decided, "under_review", "approved", later(120), staff);
    // A proposal at 45 minutes, declined at 3 hours: the proposal was first.
    await history(ids.sentThenDeclined, "under_review", "rejected", later(180), sales);
    // A decision dated before the enquiry arrived (a clock fault): not a reply to it.
    await history(ids.decidedBeforeArrival, "under_review", "approved", later(-10), staff);
    // Reviewed only: no reply.
    await history(ids.reviewedOnly, "submitted", "under_review", later(15), staff);

    await pool.query("INSERT INTO opportunities (id, venue_id, title, source_enquiry_id) VALUES ($1, $2, 'Deal', $3)", [ids.deal, venue, ids.viaDeal]);
    const proposal = async (id: string, enquiryId: string | null, opportunityId: string | null): Promise<void> => {
      await pool.query(
        "INSERT INTO proposals (id, venue_id, enquiry_id, opportunity_id, title, status, current_version, sent_at, sent_version) VALUES ($1, $2, $3, $4, 'Proposal', 'sent', 1, $5, 1)",
        [id, venue, enquiryId, opportunityId, later(45)],
      );
    };
    await proposal(ids.proposalDirect, ids.sentThenDeclined, null);
    await proposal(ids.proposalViaDeal, null, ids.deal);
    // This venue's proposal naming another venue's enquiry.
    await proposal(ids.proposalStray, ids.theirs, null);
    const sentAt = async (proposalId: string, at: Date, by: string): Promise<void> => {
      await pool.query(
        "INSERT INTO proposal_status_history (proposal_id, from_status, to_status, changed_by, created_at) VALUES ($1, 'draft', 'sent', $2, $3)",
        [proposalId, by, at],
      );
    };
    await sentAt(ids.proposalDirect, later(45), sales);
    await sentAt(ids.proposalViaDeal, later(200), staff);
    await sentAt(ids.proposalStray, later(50), staff);

    await pool.query(
      `INSERT INTO proposal_share_tokens (id, proposal_id, token_hash, token_prefix, last_viewed_at) VALUES
       ($1, $3, repeat('a', 64), 'opened', $4), ($2, $3, repeat('b', 64), 'unopen', NULL)`,
      [ids.tokenOpened, ids.tokenUnopened, ids.proposalDirect, later(400)],
    );
    await pool.query(
      `INSERT INTO bookings (id, venue_id, space_id, kind, status, title, starts_at, ends_at) VALUES
       ($1, $2, $3, 'prospect', 'lost', 'Lost before reasons', $4, $5)`,
      [ids.lostBooking, venue, hall, later(60 * 24 * 30), later(60 * 24 * 30 + 240)],
    );

    await applyMigrationFile(pool, `${MIGRATION}.sql`);
  }, 300_000);

  afterAll(async () => {
    if (folder !== undefined) await rm(folder, { recursive: true, force: true });
    await pool?.end();
  }, 60_000);

  async function stamp(id: string): Promise<Record<string, unknown>> {
    const { rows } = await pool.query<Record<string, unknown>>(
      "SELECT first_response_at AS at, first_response_by AS by, first_response_channel AS channel, first_response_recorded_at AS recorded FROM enquiries WHERE id = $1",
      [id],
    );
    return rows[0] ?? {};
  }

  it("fills the first reply only from replies Venviewer sent, earliest first, recorded when sent", async () => {
    expect(await stamp(ids.decided)).toEqual({ at: later(120), by: staff, channel: "decision", recorded: later(120) });
    expect(await stamp(ids.sentThenDeclined)).toEqual({ at: later(45), by: sales, channel: "proposal", recorded: later(45) });
    expect(await stamp(ids.viaDeal)).toEqual({ at: later(200), by: staff, channel: "proposal", recorded: later(200) });
  });

  it("gives no reply to an enquiry only reviewed, one decided before it arrived, or another venue's", async () => {
    for (const id of [ids.reviewedOnly, ids.decidedBeforeArrival, ids.theirs]) {
      expect(await stamp(id)).toEqual({ at: null, by: null, channel: null, recorded: null });
    }
  });

  it("leaves a link opened before counting unknown and starts an unopened one at zero", async () => {
    const { rows } = await pool.query<{ id: string; view_count: number | null; first_viewed_at: Date | null }>(
      "SELECT id, view_count, first_viewed_at FROM proposal_share_tokens WHERE id = ANY($1::uuid[]) ORDER BY token_prefix",
      [[ids.tokenOpened, ids.tokenUnopened]],
    );
    expect(rows).toEqual([
      { id: ids.tokenOpened, view_count: null, first_viewed_at: null },
      { id: ids.tokenUnopened, view_count: 0, first_viewed_at: null },
    ]);
  });

  it("keeps every existing row valid and adds nothing to it", async () => {
    const { rows } = await pool.query<{ lost_reason: string | null; kind: string }>("SELECT lost_reason, kind FROM bookings WHERE id = $1", [ids.lostBooking]);
    expect(rows).toEqual([{ lost_reason: null, kind: "prospect" }]);
    const attribution = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM enquiries WHERE acquisition_channel IS NOT NULL OR referrer_host IS NOT NULL OR utm_source IS NOT NULL",
    );
    expect(attribution.rows[0]).toEqual({ n: 0 });
    const engagement = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM venue_engagement_events");
    expect(engagement.rows[0]).toEqual({ n: 0 });
  });

  it("changes nothing when run again", async () => {
    const snapshot = async (): Promise<string> => {
      const enquiries = await pool.query("SELECT id, first_response_at, first_response_channel, first_response_recorded_at FROM enquiries ORDER BY id");
      const tokens = await pool.query("SELECT id, view_count, first_viewed_at FROM proposal_share_tokens ORDER BY id");
      const constraints = await pool.query(
        `SELECT conrelid::regclass::text AS on_table, conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conname LIKE ANY (ARRAY['enquiries_%', 'bookings_%', 'proposal_share_tokens_%', 'proposals_id_venue_unique', 'venue_engagement_events_%'])
         ORDER BY conrelid::regclass::text, conname`,
      );
      return JSON.stringify([enquiries.rows, tokens.rows, constraints.rows]);
    };
    const first = await snapshot();
    await applyMigrationFile(pool, `${MIGRATION}.sql`);
    expect(await snapshot()).toBe(first);
    const kindChecks = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'bookings_kind_check'");
    expect(kindChecks.rows[0]).toEqual({ n: 1 });
  }, 120_000);
  it("lets the release before it keep writing what it wrote", async () => {
    const enquiryId = randomUUID();
    await pool.query(
      "INSERT INTO enquiries (id, venue_id, space_id, name, email, state, source) VALUES ($1, $2, $3, 'Guest', 'g@example.test', 'submitted', 'email')",
      [enquiryId, venue, hall],
    );
    await pool.query("INSERT INTO enquiry_status_history (enquiry_id, from_status, to_status, changed_by) VALUES ($1, 'submitted', 'under_review', $2)", [enquiryId, staff]);
    // Its proposal view: last_viewed_at only, the count left as it was.
    await pool.query("UPDATE proposal_share_tokens SET last_viewed_at = now() WHERE id = $1", [ids.tokenUnopened]);
    // Its lost step: the status only.
    const booking = randomUUID();
    await pool.query(
      "INSERT INTO bookings (id, venue_id, space_id, kind, status, title, starts_at, ends_at) VALUES ($1, $2, $3, 'prospect', 'active', 'Maybe', $4, $5)",
      [booking, venue, hall, later(60 * 24 * 40), later(60 * 24 * 40 + 120)],
    );
    await pool.query("UPDATE bookings SET status = 'lost' WHERE id = $1", [booking]);
    const { rows } = await pool.query<{ view_count: number | null }>("SELECT view_count FROM proposal_share_tokens WHERE id = $1", [ids.tokenUnopened]);
    // Zero beside a last view: the next release reads it as uncounted, and
    // the file run again writes it as such, unknown rather than guessed.
    expect(rows).toEqual([{ view_count: 0 }]);
    await applyMigrationFile(pool, `${MIGRATION}.sql`);
    const again = await pool.query<{ view_count: number | null; first_viewed_at: Date | null }>(
      "SELECT view_count, first_viewed_at FROM proposal_share_tokens WHERE id = $1", [ids.tokenUnopened],
    );
    expect(again.rows).toEqual([{ view_count: null, first_viewed_at: null }]);
    // Its enquiry and lost booking stand as it wrote them.
    const lost = await pool.query("SELECT status, lost_reason FROM bookings WHERE id = $1", [booking]);
    expect(lost.rows).toEqual([{ status: "lost", lost_reason: null }]);
  }, 120_000);

});
