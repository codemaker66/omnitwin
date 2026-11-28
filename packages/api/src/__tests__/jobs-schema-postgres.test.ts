import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailSends, jobs } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { jobsTestUrl, openJobsDatabase, resetJobs } from "./helpers/jobs-db.js";

// T-702, the job list's table: the rules the database itself enforces, proved
// on real rows. A job's scope and venue agree, its kind and key are unique, a
// running row always has a claim and nothing else does, a payload stays small,
// the state is one of five. A send's status is one of nine, and a send that
// names an event or enquiry names it under the same venue. Each of a send's
// links is indexed where it is set, and the migration takes every other lock
// its keys need before it touches email_sends.
//
// Never loads .env and never falls back to DATABASE_URL: the target is the
// explicit throwaway database (helpers/jobs-db.ts). The database is not wiped
// between runs, so every fixture row carries random ids and keys.

describe.skipIf(jobsTestUrl === undefined)("jobs: the rules in the database", () => {
  let pool: Pool;
  let db: Database;

  let venueId: string;
  let venueB: string;
  let userId: string;
  let eventOfVenueA: string;
  let enquiryOfVenueA: string;

  beforeAll(async () => {
    ({ pool, db } = await openJobsDatabase(`jobs_schema_${randomUUID()}`));
    venueId = randomUUID();
    venueB = randomUUID();
    userId = randomUUID();
    eventOfVenueA = randomUUID();
    enquiryOfVenueA = randomUUID();
    const spaceId = randomUUID();
    await pool.query(
      "INSERT INTO venues (id, name, slug, address) VALUES ($1, 'TEST ONLY jobs venue A', $2, 'Test street'), ($3, 'TEST ONLY jobs venue B', $4, 'Test street')",
      [venueId, `jobs-a-${venueId.slice(0, 8)}`, venueB, `jobs-b-${venueB.slice(0, 8)}`],
    );
    await pool.query(
      "INSERT INTO users (id, email, name, role, venue_id, platform_role) VALUES ($1, $2, 'TEST ONLY jobs staff', 'staff', $3, 'none')",
      [userId, `jobs-staff-${userId}@example.org`, venueId],
    );
    await pool.query("INSERT INTO events (id, venue_id, name) VALUES ($1, $2, 'TEST ONLY jobs event')", [eventOfVenueA, venueId]);
    await pool.query(
      `INSERT INTO spaces (id, venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline)
       VALUES ($1, $2, 'TEST ONLY jobs room', 'jobs-room', 10, 20, 8, '[{"x":0,"y":0},{"x":10,"y":0},{"x":10,"y":20},{"x":0,"y":20}]')`,
      [spaceId, venueId],
    );
    await pool.query(
      "INSERT INTO enquiries (id, venue_id, space_id, name, email) VALUES ($1, $2, $3, 'TEST ONLY jobs enquirer', $4)",
      [enquiryOfVenueA, venueId, spaceId, `jobs-enquirer-${enquiryOfVenueA}@example.org`],
    );
  }, 180_000);

  beforeEach(async () => {
    await resetJobs(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  /** Plain SQL with a default for every column not given; an explicit null stays null. */
  async function insertRow(table: "jobs" | "email_sends", row: Readonly<Record<string, unknown>>): Promise<string> {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, index) => `$${String(index + 1)}`);
    const text = `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`;
    const result = await pool.query<{ id: string }>(text, columns.map((column) => row[column]));
    const [created] = result.rows;
    if (created === undefined) throw new Error("The insert returned no row");
    return created.id;
  }

  function insertJob(overrides: Readonly<Record<string, unknown>> = {}): Promise<string> {
    return insertRow("jobs", {
      kind: `test.kind.${randomUUID()}`,
      key: randomUUID(),
      scope: "platform",
      venue_id: null,
      payload: {},
      max_attempts: 6,
      ...overrides,
    });
  }

  function insertSend(overrides: Readonly<Record<string, unknown>> = {}): Promise<string> {
    return insertRow("email_sends", {
      idempotency_key: `jobs-schema-test-${randomUUID()}`,
      recipient: "someone@example.org",
      subject: "TEST ONLY subject",
      status: "pending",
      ...overrides,
    });
  }

  it("refuses a venue's job with no venue", async () => {
    await expect(insertJob({ scope: "venue", venue_id: null })).rejects.toThrow(/jobs_scope_venue/);
  });

  it("refuses a platform job that names a venue", async () => {
    await expect(insertJob({ scope: "platform", venue_id: venueId })).rejects.toThrow(/jobs_scope_venue/);
  });

  it("refuses the same kind and key twice", async () => {
    await insertJob({ kind: "t", key: "k" });
    await expect(insertJob({ kind: "t", key: "k" })).rejects.toThrow(/jobs_kind_key_unique/);
  });

  it("refuses a running row with no claim, and a claim on a row that is not running", async () => {
    await expect(insertJob({ state: "running" })).rejects.toThrow(/jobs_claim/);
    await expect(insertJob({ state: "queued", claim_token: randomUUID() })).rejects.toThrow(/jobs_claim/);
  });

  it("refuses a payload over 2,048 bytes", async () => {
    await expect(insertJob({ payload: { pad: "x".repeat(2100) } })).rejects.toThrow(/jobs_payload_small/);
  });

  it("refuses a state outside the five", async () => {
    await expect(insertJob({ state: "paused" })).rejects.toThrow(/jobs_state/);
  });

  it("refuses a send status outside the nine", async () => {
    await expect(insertSend({ status: "maybe" })).rejects.toThrow(/email_sends_status/);
  });

  it("accepts today's five send statuses and the four new ones", async () => {
    for (const status of ["pending", "sent", "failed", "suppressed", "dev_mode", "queued", "not_sent", "bounced", "complained"]) {
      await expect(insertSend({ status })).resolves.toBeDefined();
    }
  });

  it("refuses a send that names another venue's event, or an event with no venue", async () => {
    await expect(insertSend({ venue_id: venueB, event_id: eventOfVenueA })).rejects.toThrow(/email_sends_event_venue_fk/);
    await expect(insertSend({ venue_id: null, event_id: eventOfVenueA })).rejects.toThrow(/email_sends_link_needs_venue/);
  });

  it("refuses a send that names another venue's enquiry, or an enquiry with no venue", async () => {
    await expect(insertSend({ venue_id: venueB, enquiry_id: enquiryOfVenueA })).rejects.toThrow(/email_sends_enquiry_venue_fk/);
    await expect(insertSend({ venue_id: null, enquiry_id: enquiryOfVenueA })).rejects.toThrow(/email_sends_link_needs_venue/);
    // The control: the enquiry under its own venue is accepted, so the refusals above are the rule's and not the fixture's.
    await expect(insertSend({ venue_id: venueId, enquiry_id: enquiryOfVenueA })).resolves.toBeDefined();
  });

  it("indexes a send's venue, event and enquiry only where each is set", async () => {
    const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'email_sends' AND indexname = ANY($1::text[]) ORDER BY indexname`,
      [["email_sends_enquiry_idx", "email_sends_event_idx", "email_sends_venue_created_idx"]],
    );
    expect(rows).toEqual([
      {
        indexname: "email_sends_enquiry_idx",
        indexdef: "CREATE INDEX email_sends_enquiry_idx ON public.email_sends USING btree (enquiry_id) WHERE (enquiry_id IS NOT NULL)",
      },
      {
        indexname: "email_sends_event_idx",
        indexdef: "CREATE INDEX email_sends_event_idx ON public.email_sends USING btree (event_id) WHERE (event_id IS NOT NULL)",
      },
      {
        indexname: "email_sends_venue_created_idx",
        indexdef: "CREATE INDEX email_sends_venue_created_idx ON public.email_sends USING btree (venue_id, created_at) WHERE (venue_id IS NOT NULL)",
      },
    ]);
  });

  it("the migration locks every table a key on email_sends names before it touches email_sends", () => {
    // Read from the file as it is applied, found by its tag, so a renumbering at the merge keeps the test.
    const folder = resolve(import.meta.dirname, "../../drizzle");
    const file = readdirSync(folder).find((name) => name.endsWith("_job_list.sql"));
    if (file === undefined) throw new Error("The job list's migration is missing");
    const statements = readFileSync(resolve(folder, file), "utf8")
      .split("--> statement-breakpoint")
      .map((chunk) => chunk.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n").trim());
    const firstOnSends = statements.findIndex((statement) => statement.includes('"email_sends"'));
    expect(firstOnSends).toBeGreaterThan(0);
    // Every table a statement on email_sends refers to.
    const referenced = new Set(statements
      .filter((statement) => statement.includes('"email_sends"'))
      .flatMap((statement) => [...statement.matchAll(/REFERENCES "([a-z_]+)"/gu)].map((match) => match[1])));
    expect([...referenced].sort()).toEqual(["enquiries", "events", "venues"]);
    // Every table locked by a statement before the first one on email_sends.
    const lockedFirst = new Set(statements.slice(0, firstOnSends).flatMap((statement) => {
      const lock = /^LOCK TABLE (.+) IN SHARE ROW EXCLUSIVE MODE;$/u.exec(statement);
      return lock?.[1] === undefined ? [] : lock[1].split(",").map((name) => name.trim().replaceAll('"', ""));
    }));
    expect([...lockedFirst].sort()).toEqual(expect.arrayContaining([...referenced].sort()));
  });

  it("the Drizzle tables agree with the migration: every column is written and read back", async () => {
    const everyJobColumn = {
      id: randomUUID(),
      kind: `test.kind.${randomUUID()}`,
      version: 3,
      key: `every-column-${randomUUID()}`,
      scope: "venue",
      venueId,
      payload: { eventId: randomUUID() },
      runAt: new Date("2030-01-02T03:04:05.678Z"),
      state: "running",
      attempts: 2,
      maxAttempts: 8,
      lostClaims: 1,
      lastError: "the last attempt failed",
      claimToken: randomUUID(),
      claimedBy: "worker-test",
      claimExpiresAt: new Date("2030-01-02T03:09:05.678Z"),
      resolvedBy: userId,
      resolvedAt: new Date("2030-01-02T04:00:00.000Z"),
      resolution: "looked at and left",
      createdAt: new Date("2030-01-01T00:00:00.000Z"),
      updatedAt: new Date("2030-01-02T03:04:05.000Z"),
      finishedAt: new Date("2030-01-02T05:00:00.000Z"),
    } as const;
    const [job] = await db.insert(jobs).values(everyJobColumn).returning();
    expect(job).toMatchObject(everyJobColumn);

    const everySendColumn = {
      id: randomUUID(),
      idempotencyKey: `jobs-schema-every-${randomUUID()}`,
      recipient: "someone@example.org",
      subject: "TEST ONLY every column",
      status: "queued",
      providerMessageId: "provider-test-id",
      lastError: "an earlier try failed",
      attemptCount: 2,
      sentAt: new Date("2030-01-02T03:04:05.000Z"),
      createdAt: new Date("2030-01-01T00:00:00.000Z"),
      updatedAt: new Date("2030-01-02T03:04:05.000Z"),
      venueId,
      eventId: eventOfVenueA,
      enquiryId: enquiryOfVenueA,
      fromHeader: "Test venue <hello@example.org>",
      replyTo: "reply@example.org",
      html: "<p>TEST ONLY body</p>",
      firstTriedAt: new Date("2030-01-01T00:00:10.000Z"),
      deliveredAt: new Date("2030-01-02T03:05:00.000Z"),
      expiresAt: new Date("2030-01-03T00:00:00.000Z"),
      attemptEpoch: 4,
    } as const;
    const [send] = await db.insert(emailSends).values(everySendColumn).returning();
    expect(send).toMatchObject(everySendColumn);
  });
});
