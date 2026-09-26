import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  RotaPublishResultSchema,
  RotaShiftSchema,
  RotaWeekSchema,
  StaffRecordSchema,
  addRotaDays,
  rotaInstant,
  rotaWeekStartOf,
  type RotaShift,
  type RotaWeek,
} from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { rotaRoutes } from "../routes/rota.js";

// ---------------------------------------------------------------------------
// The staff rota (T-637 slice B) against a real database, with migration
// 0078 applied as written: who may read and manage it, every row held to its
// venue, a stale edit refused rather than overwriting a newer one, publishing
// that tells each person once and records the notice they had, and the two
// legal blocks.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || parsed.port !== "55476"
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Rota tests require their explicit isolated loopback database");
  }
}

const VENUE = "81111111-1111-4111-8111-111111111111";
const OTHER_VENUE = "82222222-2222-4222-8222-222222222222";
const HALL = "83333333-3333-4333-8333-333333333333";
const FOREIGN_ROOM = "84444444-4444-4444-8444-444444444444";
const WEDDING = "85555555-5555-4555-8555-555555555555";
const FOREIGN_EVENT = "86666666-6666-4666-8666-666666666666";

// Accounts, one per role at the venue, and one staff account elsewhere.
const USERS = {
  admin: "87000000-0000-4000-8000-000000000001",
  manager: "87000000-0000-4000-8000-000000000002",
  staff: "87000000-0000-4000-8000-000000000003",
  hallkeeper: "87000000-0000-4000-8000-000000000004",
  sales: "87000000-0000-4000-8000-000000000005",
  planner: "87000000-0000-4000-8000-000000000006",
  caterer: "87000000-0000-4000-8000-000000000007",
  elsewhere: "87000000-0000-4000-8000-000000000008",
  morag: "87000000-0000-4000-8000-000000000009",
} as const;

// People on the rota.
const MORAG = "88000000-0000-4000-8000-000000000001";   // account (hallkeeper), trained, checked
const CALLUM = "88000000-0000-4000-8000-000000000002";  // no account, no right-to-work check
const AILEEN = "88000000-0000-4000-8000-000000000003";  // under 18
const SALES_PERSON = "88000000-0000-4000-8000-000000000004"; // the sales account, on the rota
const THEIRS = "88000000-0000-4000-8000-000000000005";  // another venue's person

const LONDON = "Europe/London";
/** A week a fortnight ahead, so every shift is in the future whenever this runs. */
const WEEK = rotaWeekStartOf(Date.now() + 14 * 86_400_000, LONDON);
const FRIDAY = addRotaDays(WEEK, 4);
const SATURDAY = addRotaDays(WEEK, 5);

function at(date: string, clock: string): string {
  const [hours = 0, minutes = 0] = clock.split(":").map(Number);
  return new Date(rotaInstant(date, hours * 60 + minutes, LONDON)).toISOString();
}

describe.skipIf(testUrl === undefined)("the staff rota on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `rota_${randomUUID().replaceAll("-", "")}`;
  const baseTables: PgTable[] = [schema.venues, schema.spaces, schema.users, schema.events, schema.eventPlanNotifications];

  /** A signed-in account of the fixture: its own id, and its role as the token carries it. */
  function as(account: string, venueId: string | null = VENUE): { authorization: string } {
    const key = Object.keys(USERS).find((candidate): candidate is keyof typeof USERS => candidate === account) ?? "staff";
    const role = key === "elsewhere" ? "staff" : key === "morag" ? "hallkeeper" : key;
    return { authorization: `Bearer ${JSON.stringify({ id: USERS[key], email: `${key}@example.test`, name: `${key} user`, role, venueId })}` };
  }

  async function week(role = "staff", venueId: string | null = VENUE): Promise<{ statusCode: number; body: RotaWeek | null }> {
    const res = await server.inject({ method: "GET", url: `/venues/${VENUE}/rota/week?start=${WEEK}`, headers: as(role, venueId) });
    return { statusCode: res.statusCode, body: res.statusCode === 200 ? RotaWeekSchema.parse((JSON.parse(res.body) as { data: unknown }).data) : null };
  }

  interface Reply { readonly statusCode: number; readonly code?: string; readonly error?: string; readonly data?: unknown; readonly details?: unknown }

  async function call(method: "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, role = "staff", venueId: string | null = VENUE): Promise<Reply> {
    const res = await server.inject({ method, url, headers: as(role, venueId), ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
    if (res.body === "") return { statusCode: res.statusCode };
    const parsed = JSON.parse(res.body) as { code?: string; error?: string; data?: unknown; details?: unknown };
    return { statusCode: res.statusCode, ...parsed };
  }

  async function addShift(body: Record<string, unknown>, role = "staff"): Promise<{ statusCode: number; code?: string; error?: string; shift?: RotaShift }> {
    const res = await call("POST", `/venues/${VENUE}/rota/shifts`, {
      staffMemberId: null, role: "setup", breakMinutes: 0, eventId: null, spaceId: null, note: null, ...body,
    }, role);
    return { statusCode: res.statusCode, code: res.code, error: res.error, shift: res.statusCode === 201 ? RotaShiftSchema.parse(res.data) : undefined };
  }

  async function shiftRow(id: string): Promise<Record<string, unknown>> {
    const { rows } = await pool.query("SELECT * FROM rota_shifts WHERE id = $1", [id]);
    const row = rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) throw new Error(`no shift ${id}`);
    return row;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 4, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of baseTables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => {
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "updated_at") defaultSql = " default now()";
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    // The composite keys 0078 asserts and builds on, as 0046 and 0050 add them.
    await pool.query(`ALTER TABLE "events" ADD CONSTRAINT "events_id_venue_unique" UNIQUE ("id", "venue_id")`);
    await pool.query(`ALTER TABLE "spaces" ADD CONSTRAINT "spaces_id_venue_unique" UNIQUE ("id", "venue_id")`);
    // Migration 0078 exactly as it ships.
    const migration = await readFile(resolve("drizzle", "0078_staff_rota.sql"), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim() !== "") await client.query(statement);
      }
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(rotaRoutes, { db, prefix: "/venues/:venueId/rota" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    // Change records refuse row deletion by design; TRUNCATE fires no row
    // trigger, so each test starts from nothing.
    await pool.query("TRUNCATE rota_shift_changes, rota_shifts, staff_unavailability, staff_members, event_plan_notifications, events, spaces, users, venues");
    await pool.query(`INSERT INTO venues (id, name, slug, address, timezone) VALUES
      ($1, 'Trades Hall Glasgow', 'trades-hall', '85 Glassford Street', 'Europe/London'),
      ($2, 'Elsewhere', 'elsewhere', '1 Road', 'Europe/London')`, [VENUE, OTHER_VENUE]);
    await pool.query(`INSERT INTO spaces (id, venue_id, name, slug, sort_order) VALUES
      ($1, $2, 'Grand Hall', 'grand-hall', 0), ($3, $4, 'Their Hall', 'their-hall', 0)`, [HALL, VENUE, FOREIGN_ROOM, OTHER_VENUE]);
    await pool.query(`INSERT INTO events (id, venue_id, name) VALUES ($1, $2, 'Henderson wedding'), ($3, $4, 'Their gala')`,
      [WEDDING, VENUE, FOREIGN_EVENT, OTHER_VENUE]);
    for (const [key, id] of Object.entries(USERS)) {
      const role = key === "elsewhere" ? "staff" : key === "morag" ? "hallkeeper" : key;
      await pool.query("INSERT INTO users (id, email, name, role, platform_role, venue_id) VALUES ($1, $2, $3, $4, 'none', $5)",
        [id, `${key}@example.test`, key === "morag" ? "Morag Sinclair" : `${key} user`, role, key === "elsewhere" ? OTHER_VENUE : VENUE]);
    }
    await pool.query(`INSERT INTO staff_members (id, venue_id, user_id, display_name, employment_type, skills,
        bar_trained_on, turns_18_on, right_to_work_checked_on) VALUES
      ($1, $6, $8, 'Morag Sinclair', 'employed', '{setup,bar}', '2025-03-01', NULL, '2025-02-01'),
      ($2, $6, NULL, 'Callum Reid', 'casual', '{setup}', NULL, NULL, NULL),
      ($3, $6, NULL, 'Aileen Brodie', 'casual', '{bar}', '2026-01-10', '2030-01-01', '2026-01-02'),
      ($4, $6, $9, 'Priya Raman', 'employed', '{duty_manager}', NULL, NULL, '2024-05-01'),
      ($5, $7, NULL, 'Their person', 'agency', '{}', NULL, NULL, '2024-01-01')`,
      [MORAG, CALLUM, AILEEN, SALES_PERSON, THEIRS, VENUE, OTHER_VENUE, USERS.morag, USERS.sales]);
  }, 60_000);

  afterAll(async () => {
    if (server !== undefined) await server.close();
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  }, 60_000);

  describe("who may read and manage it", () => {
    it("gives the venue's administrators the whole week, the floor the published week, and everyone else their own shifts", async () => {
      const draft = await addShift({ staffMemberId: MORAG, startsAt: at(SATURDAY, "09:00"), endsAt: at(SATURDAY, "13:00") });
      expect(draft.statusCode).toBe(201);

      for (const role of ["admin", "manager", "staff"]) {
        const { statusCode, body } = await week(role);
        expect(statusCode, role).toBe(200);
        expect(body?.access, role).toBe("manage");
        expect(body?.shifts.map((shift) => shift.id), role).toEqual([draft.shift?.id]);
        expect(body?.records.length, role).toBe(4);
      }

      const floor = await week("hallkeeper");
      expect(floor.body?.access).toBe("read");
      // A draft is the manager's until it is published; the floor sees no
      // records, no warnings and no leave.
      expect(floor.body?.shifts).toEqual([]);
      expect(floor.body?.records).toEqual([]);
      expect(floor.body?.people.map((person) => person.displayName)).toEqual(["Aileen Brodie", "Callum Reid", "Morag Sinclair", "Priya Raman"]);

      const sales = await week("sales");
      expect(sales.body?.access).toBe("own");
      expect(sales.body?.people.map((person) => person.id)).toEqual([SALES_PERSON]);

      for (const role of ["planner", "caterer"]) {
        const customer = await week(role);
        expect(customer.statusCode, role).toBe(200);
        expect(customer.body?.people, role).toEqual([]);
        expect(customer.body?.shifts, role).toEqual([]);
      }

      expect((await week("elsewhere", OTHER_VENUE)).statusCode).toBe(403);
      const anonymous = await server.inject({ method: "GET", url: `/venues/${VENUE}/rota/week?start=${WEEK}` });
      expect(anonymous.statusCode).toBe(401);
    });

    it("lets only the venue's administrators change it", async () => {
      for (const role of ["hallkeeper", "sales", "planner"]) {
        expect((await addShift({ startsAt: at(SATURDAY, "09:00"), endsAt: at(SATURDAY, "13:00") }, role)).statusCode, role).toBe(403);
        expect((await call("POST", `/venues/${VENUE}/rota/people`, {
          displayName: "New", email: null, phone: null, employmentType: "casual", skills: [], barTrainedOn: null, turns18On: null,
          rightToWorkCheckedOn: null, rightToWorkExpiresOn: null, workingTimeOptOut: false, userId: null,
        }, role)).statusCode, role).toBe(403);
        expect((await call("POST", `/venues/${VENUE}/rota/publish`, { weekStart: WEEK, shifts: [{ id: MORAG, revision: 1 }] }, role)).statusCode, role).toBe(403);
      }
      for (const role of ["staff", "manager", "admin"]) {
        expect((await addShift({ startsAt: at(SATURDAY, "09:00"), endsAt: at(SATURDAY, "13:00") }, role)).statusCode, role).toBe(201);
      }
    });
  });

  describe("every row held to its venue", () => {
    it("refuses another venue's person, event or room on a shift", async () => {
      const base = { startsAt: at(SATURDAY, "09:00"), endsAt: at(SATURDAY, "13:00") };
      expect((await addShift({ ...base, staffMemberId: THEIRS })).statusCode).toBe(404);
      expect((await addShift({ ...base, eventId: FOREIGN_EVENT })).statusCode).toBe(404);
      expect((await addShift({ ...base, spaceId: FOREIGN_ROOM })).statusCode).toBe(404);
      const ours = await addShift({ ...base, staffMemberId: MORAG, eventId: WEDDING, spaceId: HALL });
      expect(ours.statusCode).toBe(201);
      expect(ours.shift?.eventName).toBe("Henderson wedding");
      expect(ours.shift?.spaceName).toBe("Grand Hall");
    });

    it("answers 404 for a shift reached through another venue", async () => {
      const ours = await addShift({ staffMemberId: MORAG, startsAt: at(SATURDAY, "09:00"), endsAt: at(SATURDAY, "13:00") });
      const id = ours.shift?.id ?? "";
      const foreign = await call("PATCH", `/venues/${OTHER_VENUE}/rota/shifts/${id}`, { breakMinutes: 10, expectedRevision: 1 }, "elsewhere", OTHER_VENUE);
      expect(foreign.statusCode).toBe(404);
      const removal = await call("DELETE", `/venues/${OTHER_VENUE}/rota/shifts/${id}?expectedRevision=1`, undefined, "elsewhere", OTHER_VENUE);
      expect(removal.statusCode).toBe(404);
      expect((await shiftRow(id))["break_minutes"]).toBe(0);
    });

    it("keeps a cross-venue person off a shift even below the API", async () => {
      await expect(pool.query(
        "INSERT INTO rota_shifts (venue_id, staff_member_id, role, starts_at, ends_at) VALUES ($1, $2, 'setup', now() + interval '1 day', now() + interval '1 day 4 hours')",
        [VENUE, THEIRS],
      )).rejects.toMatchObject({ code: "23503" });
    });

    it("links only an account of the venue's own team, once", async () => {
      const person = {
        displayName: "Linked", email: "", phone: null, employmentType: "casual", skills: ["av"], barTrainedOn: null, turns18On: null,
        rightToWorkCheckedOn: "2026-01-01", rightToWorkExpiresOn: null, workingTimeOptOut: false,
      };
      expect((await call("POST", `/venues/${VENUE}/rota/people`, { ...person, userId: USERS.elsewhere })).code).toBe("ACCOUNT_OUTSIDE_TEAM");
      expect((await call("POST", `/venues/${VENUE}/rota/people`, { ...person, userId: USERS.planner })).code).toBe("ACCOUNT_OUTSIDE_TEAM");
      const taken = await call("POST", `/venues/${VENUE}/rota/people`, { ...person, userId: USERS.morag });
      expect(taken.statusCode).toBe(409);
      expect(taken.error).toBe("That account is already linked to Morag Sinclair.");
      const made = await call("POST", `/venues/${VENUE}/rota/people`, { ...person, userId: USERS.manager });
      expect(made.statusCode).toBe(201);
      const record = StaffRecordSchema.parse(made.data);
      expect(record.account).toEqual({ name: "manager user", email: "manager@example.test" });
      expect(record.email).toBeNull();
    });
  });

  describe("stale edits", () => {
    it("refuses an edit made from an old copy, and shows the shift as it stands", async () => {
      const made = await addShift({ staffMemberId: MORAG, startsAt: at(SATURDAY, "09:00"), endsAt: at(SATURDAY, "13:00") });
      const id = made.shift?.id ?? "";
      const first = await call("PATCH", `/venues/${VENUE}/rota/shifts/${id}`, { breakMinutes: 15, expectedRevision: 1 });
      expect(first.statusCode).toBe(200);
      const stale = await call("PATCH", `/venues/${VENUE}/rota/shifts/${id}`, { breakMinutes: 30, expectedRevision: 1 });
      expect(stale.statusCode).toBe(409);
      expect(stale.code).toBe("SHIFT_CHANGED");
      expect(RotaShiftSchema.parse(stale.details).breakMinutes).toBe(15);
      expect((await shiftRow(id))["break_minutes"]).toBe(15);
    });

    it("lets exactly one of two simultaneous edits win", async () => {
      const made = await addShift({ staffMemberId: MORAG, startsAt: at(SATURDAY, "09:00"), endsAt: at(SATURDAY, "13:00") });
      const id = made.shift?.id ?? "";
      const results = await Promise.all([10, 20, 30].map((breakMinutes) =>
        call("PATCH", `/venues/${VENUE}/rota/shifts/${id}`, { breakMinutes, expectedRevision: 1 })));
      expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409, 409]);
      const row = await shiftRow(id);
      expect(row["revision"]).toBe(2);
    });

    it("refuses a stale change to a person's record", async () => {
      const first = await call("PATCH", `/venues/${VENUE}/rota/people/${CALLUM}`, { phone: "0141 552 2418", expectedRevision: 1 });
      expect(first.statusCode).toBe(200);
      const stale = await call("PATCH", `/venues/${VENUE}/rota/people/${CALLUM}`, { phone: "0141 000 0000", expectedRevision: 1 });
      expect(stale.statusCode).toBe(409);
      expect(stale.code).toBe("PERSON_CHANGED");
      expect(StaffRecordSchema.parse(stale.details).phone).toBe("0141 552 2418");
    });
  });

  describe("publishing", () => {
    it("publishes the drafts shown, tells each person with an account once, and records the notice", async () => {
      const morningMorag = await addShift({ staffMemberId: MORAG, startsAt: at(SATURDAY, "09:00"), endsAt: at(SATURDAY, "13:00"), spaceId: HALL });
      const eveningMorag = await addShift({ staffMemberId: MORAG, role: "bar", startsAt: at(FRIDAY, "10:00"), endsAt: at(FRIDAY, "14:00") });
      const aileen = await addShift({ staffMemberId: AILEEN, role: "bar", startsAt: at(SATURDAY, "14:00"), endsAt: at(SATURDAY, "18:00") });
      const need = await addShift({ startsAt: at(SATURDAY, "08:00"), endsAt: at(SATURDAY, "12:00") });
      const shifts = [morningMorag, eveningMorag, aileen, need].map((made) => ({ id: made.shift?.id ?? "", revision: 1 }));

      const result = await call("POST", `/venues/${VENUE}/rota/publish`, { weekStart: WEEK, shifts });
      expect(result.statusCode).toBe(200);
      expect(RotaPublishResultSchema.parse(result.data)).toEqual({ published: 4, told: 1, notTold: 1 });

      const { rows: states } = await pool.query("SELECT status, revision, published_at IS NOT NULL AS stamped FROM rota_shifts ORDER BY starts_at");
      expect(states).toEqual(Array.from({ length: 4 }, () => ({ status: "published", revision: 2, stamped: true })));

      const { rows: changes } = await pool.query(`SELECT c.kind, c.notice_hours,
          floor(extract(epoch FROM s.starts_at - c.changed_at) / 3600)::int AS expected, c.before IS NULL AS fresh
        FROM rota_shift_changes c JOIN rota_shifts s ON s.id = c.shift_id`);
      expect(changes).toHaveLength(4);
      for (const change of changes as { kind: string; notice_hours: number; expected: number; fresh: boolean }[]) {
        expect(change.kind).toBe("published");
        expect(change.fresh).toBe(true);
        expect(change.notice_hours).toBe(change.expected);
        expect(change.notice_hours).toBeGreaterThan(24 * 7);
      }

      const { rows: notes } = await pool.query("SELECT recipient_user_id, venue_id, event_id, title, body, action_path, audience_role, severity FROM event_plan_notifications");
      expect(notes).toHaveLength(1);
      const note = notes[0] as Record<string, string | null>;
      expect(note["recipient_user_id"]).toBe(USERS.morag);
      expect(note["venue_id"]).toBe(VENUE);
      expect(note["event_id"]).toBeNull();
      expect(note["audience_role"]).toBe("hallkeeper");
      expect(note["severity"]).toBe("info");
      expect(note["action_path"]).toBe(`/dashboard?view=rota&week=${WEEK}`);
      expect(note["title"]).toMatch(/^Your shifts for the week of \d{1,2} [A-Z][a-z]+$/u);
      // Friday before Saturday, each in plain words, on the venue's clock.
      expect(note["body"]).toMatch(/^Friday \d{1,2} [A-Z][a-z]+, 10:00 to 14:00, bar shift\. Saturday \d{1,2} [A-Z][a-z]+, 09:00 to 13:00, set-up, Grand Hall\.$/u);

      // Now the floor sees it, and the sales person still sees only their own.
      expect((await week("hallkeeper")).body?.shifts).toHaveLength(4);
      expect((await week("sales")).body?.shifts).toEqual([]);
    });

    it("refuses a week that changed after it was shown, and publishes nothing", async () => {
      const one = await addShift({ staffMemberId: MORAG, startsAt: at(SATURDAY, "09:00"), endsAt: at(SATURDAY, "13:00") });
      const two = await addShift({ staffMemberId: MORAG, startsAt: at(FRIDAY, "09:00"), endsAt: at(FRIDAY, "13:00") });
      await call("PATCH", `/venues/${VENUE}/rota/shifts/${two.shift?.id ?? ""}`, { breakMinutes: 10, expectedRevision: 1 });
      const result = await call("POST", `/venues/${VENUE}/rota/publish`, {
        weekStart: WEEK, shifts: [{ id: one.shift?.id, revision: 1 }, { id: two.shift?.id, revision: 1 }],
      });
      expect(result.statusCode).toBe(409);
      expect(result.code).toBe("WEEK_CHANGED");
      expect(result.details).toEqual({ shiftIds: [two.shift?.id] });
      const { rows } = await pool.query("SELECT count(*)::int AS published FROM rota_shifts WHERE status <> 'draft'");
      expect(rows[0]).toEqual({ published: 0 });
      const { rows: notes } = await pool.query("SELECT count(*)::int AS count FROM event_plan_notifications");
      expect(notes[0]).toEqual({ count: 0 });
    });

    it("tells people when a published shift changes hands or is cancelled, with the notice they had", async () => {
      const made = await addShift({ staffMemberId: MORAG, startsAt: at(SATURDAY, "09:00"), endsAt: at(SATURDAY, "13:00") });
      const id = made.shift?.id ?? "";
      await call("POST", `/venues/${VENUE}/rota/publish`, { weekStart: WEEK, shifts: [{ id, revision: 1 }] });
      await pool.query("DELETE FROM event_plan_notifications");

      // Removing a published shift is refused: it is cancelled instead.
      const removal = await call("DELETE", `/venues/${VENUE}/rota/shifts/${id}?expectedRevision=2`);
      expect(removal.code).toBe("SHIFT_PUBLISHED");

      const moved = await call("PATCH", `/venues/${VENUE}/rota/shifts/${id}`, { startsAt: at(SATURDAY, "10:00"), endsAt: at(SATURDAY, "14:00"), expectedRevision: 2 });
      expect(moved.statusCode).toBe(200);
      const { rows: changed } = await pool.query("SELECT title, body FROM event_plan_notifications");
      expect(changed).toEqual([{
        title: "Your Saturday shift has changed",
        body: expect.stringMatching(/^Now Saturday \d{1,2} [A-Z][a-z]+, 10:00 to 14:00, set-up\. It was Saturday \d{1,2} [A-Z][a-z]+, 09:00 to 13:00, set-up\. Changed by staff user, \d+ hours before it was due to start\.$/u),
      }]);

      const cancelled = await call("POST", `/venues/${VENUE}/rota/shifts/${id}/cancel`, { expectedRevision: 3 });
      expect(cancelled.statusCode).toBe(200);
      expect(RotaShiftSchema.parse(cancelled.data).status).toBe("cancelled");
      const row = await shiftRow(id);
      const expectedNotice = Math.floor((Date.parse(at(SATURDAY, "10:00")) - (row["cancelled_at"] as Date).getTime()) / 3_600_000);
      expect(row["cancellation_notice_hours"]).toBe(expectedNotice);
      const { rows: kinds } = await pool.query("SELECT kind, before IS NULL AS no_before, after IS NULL AS no_after FROM rota_shift_changes ORDER BY changed_at, kind DESC");
      expect(kinds).toEqual([
        { kind: "published", no_before: true, no_after: false },
        { kind: "changed", no_before: false, no_after: false },
        { kind: "cancelled", no_before: false, no_after: true },
      ]);
      const { rows: told } = await pool.query("SELECT title FROM event_plan_notifications ORDER BY created_at");
      expect(told.map((note) => (note as { title: string }).title)).toEqual(["Your Saturday shift has changed", "Your Saturday shift is cancelled"]);

      // The record of what people were told is kept as it was written.
      await expect(pool.query("UPDATE rota_shift_changes SET notice_hours = 0")).rejects.toMatchObject({ code: "23514" });
      await expect(pool.query("DELETE FROM rota_shift_changes")).rejects.toMatchObject({ code: "23514" });
    });

    it("tells both people when a published shift changes hands", async () => {
      const made = await addShift({ staffMemberId: MORAG, startsAt: at(SATURDAY, "09:00"), endsAt: at(SATURDAY, "13:00") });
      const id = made.shift?.id ?? "";
      await call("POST", `/venues/${VENUE}/rota/publish`, { weekStart: WEEK, shifts: [{ id, revision: 1 }] });
      await pool.query("DELETE FROM event_plan_notifications");
      const moved = await call("PATCH", `/venues/${VENUE}/rota/shifts/${id}`, { staffMemberId: SALES_PERSON, expectedRevision: 2 });
      expect(moved.statusCode).toBe(200);
      const { rows } = await pool.query("SELECT recipient_user_id, title FROM event_plan_notifications ORDER BY title");
      expect(rows).toEqual([
        { recipient_user_id: USERS.morag, title: "You are no longer on Saturday's set-up" },
        { recipient_user_id: USERS.sales, title: "You have a new shift on Saturday" },
      ]);
      // The sales person now sees it among their own shifts.
      expect((await week("sales")).body?.shifts.map((shift) => shift.id)).toEqual([id]);
    });
  });

  describe("warnings and the legal blocks", () => {
    it("says a short rest in plain words, and keeps it with a reason until the shift changes", async () => {
      await addShift({ staffMemberId: MORAG, role: "bar", startsAt: at(FRIDAY, "17:00"), endsAt: at(FRIDAY, "23:30"), breakMinutes: 20 });
      const saturday = await addShift({ staffMemberId: MORAG, startsAt: at(SATURDAY, "08:30"), endsAt: at(SATURDAY, "16:00"), breakMinutes: 20 });
      expect(saturday.shift?.issues.map((issue) => [issue.code, issue.message])).toEqual([[
        "short_rest", "Morag Sinclair would have 9 hours between Friday's bar shift and Saturday's set-up; 11 are needed.",
      ]]);
      const id = saturday.shift?.id ?? "";

      expect((await call("POST", `/venues/${VENUE}/rota/shifts/${id}/keep`, { code: "young_small_hours", reason: "No", expectedRevision: 1 })).statusCode).toBe(400);
      expect((await call("POST", `/venues/${VENUE}/rota/shifts/${id}/keep`, { code: "no_break", reason: "Not this one", expectedRevision: 1 })).code).toBe("WARNING_GONE");
      const kept = await call("POST", `/venues/${VENUE}/rota/shifts/${id}/keep`, { code: "short_rest", reason: "Swapped at Morag's request; Monday off", expectedRevision: 1 });
      expect(kept.statusCode).toBe(200);
      const keptIssue = RotaShiftSchema.parse(kept.data).issues[0];
      expect(keptIssue?.kept?.reason).toBe("Swapped at Morag's request; Monday off");
      expect(keptIssue?.kept?.byName).toBe("staff user");

      const moved = await call("PATCH", `/venues/${VENUE}/rota/shifts/${id}`, { startsAt: at(SATURDAY, "09:00"), expectedRevision: 2 });
      expect(RotaShiftSchema.parse(moved.data).issues[0]?.kept).toBeNull();
    });

    it("never lets an under-18 be rostered between midnight and 04:00", async () => {
      const late = await addShift({ staffMemberId: AILEEN, role: "bar", startsAt: at(SATURDAY, "20:00"), endsAt: at(addRotaDays(SATURDAY, 1), "01:00"), breakMinutes: 30 });
      expect(late.statusCode).toBe(422);
      expect(late.code).toBe("ROTA_BLOCKED");
      expect(late.error).toBe("Aileen Brodie is under 18, so cannot work between midnight and 04:00. This shift runs 20:00 to 01:00.");

      // Nor moved there, nor given one that runs there.
      const evening = await addShift({ staffMemberId: AILEEN, role: "bar", startsAt: at(SATURDAY, "18:00"), endsAt: at(SATURDAY, "21:30"), breakMinutes: 0 });
      expect(evening.statusCode).toBe(201);
      const moved = await call("PATCH", `/venues/${VENUE}/rota/shifts/${evening.shift?.id ?? ""}`, { endsAt: at(addRotaDays(SATURDAY, 1), "00:30"), expectedRevision: 1 });
      expect(moved.code).toBe("ROTA_BLOCKED");
      const need = await addShift({ role: "bar", startsAt: at(SATURDAY, "22:00"), endsAt: at(addRotaDays(SATURDAY, 1), "02:00") });
      expect(need.statusCode).toBe(201);
      const given = await call("PATCH", `/venues/${VENUE}/rota/shifts/${need.shift?.id ?? ""}`, { staffMemberId: AILEEN, expectedRevision: 1 });
      expect(given.code).toBe("ROTA_BLOCKED");
      // An adult may take it.
      expect((await call("PATCH", `/venues/${VENUE}/rota/shifts/${need.shift?.id ?? ""}`, { staffMemberId: MORAG, expectedRevision: 1 })).statusCode).toBe(200);
    });

    it("plans a shift for someone without a right-to-work check, but will not publish it until the check is recorded", async () => {
      const callum = await addShift({ staffMemberId: CALLUM, startsAt: at(SATURDAY, "09:00"), endsAt: at(SATURDAY, "13:00") });
      expect(callum.statusCode).toBe(201);
      expect(callum.shift?.issues.map((issue) => [issue.code, issue.severity])).toEqual([["right_to_work_missing", "block"]]);
      const id = callum.shift?.id ?? "";

      const refused = await call("POST", `/venues/${VENUE}/rota/publish`, { weekStart: WEEK, shifts: [{ id, revision: 1 }] });
      expect(refused.statusCode).toBe(422);
      expect(refused.code).toBe("ROTA_BLOCKED");
      expect(refused.error).toBe("Callum Reid has no right-to-work check recorded, so this shift cannot be published until one is.");
      expect((await shiftRow(id))["status"]).toBe("draft");

      expect((await call("PATCH", `/venues/${VENUE}/rota/people/${CALLUM}`, { rightToWorkCheckedOn: "2026-09-01", expectedRevision: 1 })).statusCode).toBe(200);
      const published = await call("POST", `/venues/${VENUE}/rota/publish`, { weekStart: WEEK, shifts: [{ id, revision: 1 }] });
      expect(published.statusCode).toBe(200);
      expect(RotaPublishResultSchema.parse(published.data)).toEqual({ published: 1, told: 0, notTold: 1 });
    });

    it("reads the week and its times on the venue's own clock", async () => {
      await pool.query("UPDATE venues SET timezone = 'America/New_York' WHERE id = $1", [VENUE]);
      const { body } = await week();
      expect(body?.timeZone).toBe("America/New_York");
      expect(body?.from).toBe(new Date(rotaInstant(WEEK, 0, "America/New_York")).toISOString());
      await pool.query("UPDATE venues SET timezone = 'Nowhere/Atlantis' WHERE id = $1", [VENUE]);
      expect((await week()).body?.timeZone).toBe(LONDON);
    });

    it("warns when a shift falls on someone's leave", async () => {
      const leave = await call("POST", `/venues/${VENUE}/rota/unavailability`, {
        staffMemberId: MORAG, reason: "leave", note: null, startsAt: at(SATURDAY, "00:00"), endsAt: at(addRotaDays(SATURDAY, 1), "00:00"),
      });
      expect(leave.statusCode).toBe(201);
      const onLeave = await addShift({ staffMemberId: MORAG, startsAt: at(SATURDAY, "09:00"), endsAt: at(SATURDAY, "13:00") });
      expect(onLeave.shift?.issues.map((issue) => issue.code)).toEqual(["unavailable"]);
      expect((await call("POST", `/venues/${VENUE}/rota/unavailability`, {
        staffMemberId: THEIRS, reason: "leave", note: null, startsAt: at(SATURDAY, "00:00"), endsAt: at(addRotaDays(SATURDAY, 1), "00:00"),
      })).statusCode).toBe(404);
    });
  });
});
