import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PricingAdviceSchema, type PricingAdvice } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { pricingDeskRoutes } from "../routes/pricing-desk.js";
import { pricingRuleRoutes } from "../routes/pricing-rules.js";

// ---------------------------------------------------------------------------
// The Pricing desk on isolated PostgreSQL: the list with who changed each
// rate, suggestions from the venue's own record (never another venue's, never
// seed fixtures), dismissals that hold, a rate saved from a suggestion, and
// that rate charged instead of the everyday one on its date.
//
// Opt-in, isolated PostgreSQL only: a loopback database named
// venviewer_route_atomicity_test (CI serves it on 55476; a local private
// cluster may use its own port). Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Pricing desk tests require their explicit isolated loopback database");
  }
}

const VENUE = "47474747-4747-4747-8747-474747474747";
const OTHER_VENUE = "47474747-4747-4747-8747-474747474999";
const HALL = "48484848-4848-4848-8848-484848484801";
const OTHER_ROOM = "48484848-4848-4848-8848-484848484899";
const EVENING = "49494949-4949-4949-8949-494949494901";
const PAUSED = "49494949-4949-4949-8949-494949494902";
const RETIRED = "49494949-4949-4949-8949-494949494903";
const OTHER_RULE = "49494949-4949-4949-8949-494949494999";
const ADMIN = "50505050-5050-4050-8050-505050505001";
const MANAGER = "50505050-5050-4050-8050-505050505002";
const STAFF = "50505050-5050-4050-8050-505050505003";
const OTHER_MANAGER = "50505050-5050-4050-8050-505050505099";

const DAY = 86_400_000;

function headers(role: string, id: string, venueId: string = VENUE): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ id, email: `${role}@example.test`, role, platformRole: "none", venueId })}` };
}
const asManager = headers("manager", MANAGER);
const asSales = headers("sales", "50505050-5050-4050-8050-505050505004");

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The first Saturday at least eight months ahead, and every Saturday of
 *  the same month one and two years before it. */
function saturdays(): { readonly target: string; readonly next: string; readonly past: readonly string[] } {
  let ms = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) + 240 * DAY;
  while (new Date(ms).getUTCDay() !== 6) ms += DAY;
  const target = new Date(ms);
  const past: string[] = [];
  for (const back of [2, 1]) {
    const year = target.getUTCFullYear() - back;
    for (let day = 1; day <= 31; day += 1) {
      const date = new Date(Date.UTC(year, target.getUTCMonth(), day));
      if (date.getUTCMonth() !== target.getUTCMonth()) break;
      if (date.getUTCDay() === 6) past.push(isoDate(date.getTime()));
    }
  }
  return { target: isoDate(ms), next: isoDate(ms + 7 * DAY), past };
}

describe.skipIf(testUrl === undefined)("the Pricing desk on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `pricing_desk_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.venues, schema.spaces, schema.users, schema.pricingRules, schema.generalAuditLog, schema.bookings,
    schema.bookingStatusHistory, schema.enquiries, schema.opportunities, schema.quotes, schema.quoteLineItems,
  ];
  const dates = saturdays();

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 4, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => {
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "updated_at") defaultSql = " default now()";
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(pricingRuleRoutes, { db, prefix: "/venues/:venueId/pricing" });
    await server.register(pricingDeskRoutes, { db, prefix: "/venues/:venueId/pricing-desk" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${tables.map((table) => `"${getTableConfig(table).name}"`).join(", ")}`);
    await pool.query(`INSERT INTO venues (id, name, slug, timezone) VALUES
      ($1, 'Trades Hall', 'trades-hall', 'Europe/London'), ($2, 'Other venue', 'other-venue', 'Europe/London')`, [VENUE, OTHER_VENUE]);
    await pool.query(`INSERT INTO spaces (id, venue_id, name, slug, sort_order) VALUES
      ($1, $3, 'Grand Hall', 'grand-hall', 0), ($2, $4, 'Other room', 'other-room', 0)`, [HALL, OTHER_ROOM, VENUE, OTHER_VENUE]);
    await pool.query(`INSERT INTO users (id, email, name, role, platform_role, venue_id) VALUES
      ($1, 'admin@example.test', 'Moira Stewart', 'admin', 'none', $5),
      ($2, 'manager@example.test', 'Callum Reid', 'manager', 'none', $5),
      ($3, 'staff@example.test', 'Ailsa Grant', 'staff', 'none', $5),
      ($4, 'other@example.test', 'Other Person', 'manager', 'none', $6)`, [ADMIN, MANAGER, STAFF, OTHER_MANAGER, VENUE, OTHER_VENUE]);
    const rule = `INSERT INTO pricing_rules (id, venue_id, space_id, name, type, amount, currency, is_active, applies_from, applies_until, deleted_at, created_at)
      VALUES ($1, $2, $3, $4, 'flat_rate', $5, 'GBP', $6, '19:00', '00:30', $7, $8)`;
    await pool.query(rule, [EVENING, VENUE, HALL, "Grand Hall — Evening", "2800.00", true, null, new Date("2026-01-01T09:00:00Z")]);
    await pool.query(rule, [PAUSED, VENUE, HALL, "Grand Hall — Late licence", "400.00", false, null, new Date("2026-01-02T09:00:00Z")]);
    await pool.query(rule, [RETIRED, VENUE, HALL, "Grand Hall — Old evening", "2500.00", false, new Date("2026-03-01T09:00:00Z"), new Date("2025-01-01T09:00:00Z")]);
    await pool.query(rule, [OTHER_RULE, OTHER_VENUE, OTHER_ROOM, "Other room — Evening", "900.00", true, null, new Date("2026-01-01T09:00:00Z")]);
  });

  afterAll(async () => {
    await server?.close();
    await pool?.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
    await pool?.end();
  });

  /** An evening in the Grand Hall, 19:00 to 23:00 UTC (always the evening in Glasgow). */
  async function booking(date: string, kind: "hold" | "ink", options: { readonly fixture?: string; readonly venueId?: string; readonly spaceId?: string; readonly createdAt?: Date } = {}): Promise<void> {
    const start = new Date(`${date}T19:00:00Z`);
    await pool.query(`INSERT INTO bookings (venue_id, space_id, kind, status, title, starts_at, ends_at, joint_flag, rank, fixture_source, created_at)
      VALUES ($1, $2, $3, 'active', 'Evening', $4, $5, false, $6, $7, $8)`, [
      options.venueId ?? VENUE, options.spaceId ?? HALL, kind, start, new Date(start.getTime() + 4 * 3_600_000),
      kind === "hold" ? 1 : null, options.fixture ?? null, options.createdAt ?? new Date(start.getTime() - 400 * DAY),
    ]);
  }

  /** Every past Saturday of the target's month sold, and a 2nd option on the target. */
  async function hotSeason(): Promise<void> {
    for (const date of dates.past) await booking(date, "ink");
    await booking(dates.target, "hold", { createdAt: new Date(Date.now() - 10 * DAY) });
    await booking(dates.target, "hold", { createdAt: new Date(Date.now() - 5 * DAY) });
  }

  async function advice(): Promise<PricingAdvice> {
    const res = await server.inject({ method: "GET", url: `/venues/${VENUE}/pricing-desk/advice`, headers: asManager });
    expect(res.statusCode).toBe(200);
    const parsed = PricingAdviceSchema.safeParse(res.json<{ data: unknown }>().data);
    if (!parsed.success) throw new Error(parsed.error.message);
    return parsed.data;
  }

  it("lists the venue's rates, in use and paused, with who changed each and when", async () => {
    const changed = await server.inject({ method: "PATCH", url: `/venues/${VENUE}/pricing/${EVENING}`, headers: asManager, payload: { amount: 2900 } });
    expect(changed.statusCode).toBe(200);
    const res = await server.inject({ method: "GET", url: `/venues/${VENUE}/pricing-desk`, headers: asSales });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    const desk = res.json<{ data: {
      rules: { id: string; amount: string; history: { by: string | null; summary: string; action: string }[] }[];
      retired: { id: string }[]; rooms: { name: string }[]; setters: string[]; canSetPrices: boolean;
    } }>().data;
    expect(desk.rules.map((rule) => rule.id)).toEqual([EVENING, PAUSED]);
    expect(desk.rules[0]?.amount).toBe("2900.00");
    expect(desk.rules[0]?.history).toEqual([{ action: "updated", at: expect.any(String) as string, by: "Callum Reid", summary: "Changed \"Grand Hall — Evening\": amount." }]);
    expect(desk.rules[1]?.history).toEqual([]);
    expect(desk.retired.map((rule) => rule.id)).toEqual([RETIRED]);
    expect(desk.rooms.map((room) => room.name)).toEqual(["Grand Hall"]);
    // The way forward for anyone who cannot set a price: who can, by name.
    expect(desk.setters).toEqual(["Callum Reid", "Moira Stewart"]);
    expect(desk.canSetPrices).toBe(false);

    const asManagerDesk = await server.inject({ method: "GET", url: `/venues/${VENUE}/pricing-desk`, headers: asManager });
    expect(asManagerDesk.json<{ data: { canSetPrices: boolean } }>().data.canSetPrices).toBe(true);
  });

  it("never shows another venue's rates or people", async () => {
    const res = await server.inject({ method: "GET", url: `/venues/${OTHER_VENUE}/pricing-desk`, headers: headers("manager", OTHER_MANAGER, OTHER_VENUE) });
    const desk = res.json<{ data: { rules: { id: string }[]; setters: string[] } }>().data;
    expect(desk.rules.map((rule) => rule.id)).toEqual([OTHER_RULE]);
    expect(desk.setters).toEqual(["Other Person"]);
    const crossed = await server.inject({ method: "GET", url: `/venues/${VENUE}/pricing-desk`, headers: headers("manager", OTHER_MANAGER, OTHER_VENUE) });
    expect(crossed.statusCode).toBe(403);
  });

  it("suggests a higher rate for a hot date from the venue's own record, and changes nothing", async () => {
    await hotSeason();
    const before = await pool.query<{ amount: string }>("SELECT amount FROM pricing_rules WHERE id = $1", [EVENING]);
    const found = await advice();
    const item = found.items.find((entry) => entry.date === dates.target);
    expect(item?.kind).toBe("raise");
    expect(item?.ruleId).toBe(EVENING);
    expect(item?.lowMinor ?? 0).toBeGreaterThan(280_000);
    expect(item?.reasons.some((reason) => reason.text.startsWith("A 2nd option is pencilled"))).toBe(true);
    expect(found.recordsBegin).toBe(dates.past[0]);
    // Advice only: the rate is as it was.
    const after = await pool.query<{ amount: string }>("SELECT amount FROM pricing_rules WHERE id = $1", [EVENING]);
    expect(after.rows).toEqual(before.rows);
  });

  it("ignores seed fixtures and other venues' bookings", async () => {
    await hotSeason();
    // One real hold the week after, and a fixture hold beside it that would
    // make it a 2nd option if it were counted.
    await booking(dates.next, "hold");
    await booking(dates.next, "hold", { fixture: "seed" });
    await booking(dates.next, "hold", { venueId: OTHER_VENUE, spaceId: OTHER_ROOM });
    const found = await advice();
    expect(found.items.filter((entry) => entry.date === dates.next)).toEqual([]);
  });

  it("keeps a dismissal until it is brought back", async () => {
    await hotSeason();
    const key = `${EVENING}:${dates.target}:raise`;
    const dismissed = await server.inject({ method: "POST", url: `/venues/${VENUE}/pricing-desk/advice/dismissals`, headers: asManager, payload: { key } });
    expect(dismissed.statusCode).toBe(201);
    const without = await advice();
    expect(without.items.some((entry) => entry.key === key)).toBe(false);
    expect(without.dismissed).toBe(1);
    const audit = await pool.query<{ actor_user_id: string; summary: string }>(
      "SELECT actor_user_id, summary FROM general_audit_log WHERE target_type = 'pricing_advice'",
    );
    expect(audit.rows).toEqual([{ actor_user_id: MANAGER, summary: `Dismissed a suggestion for "Grand Hall — Evening" on ${dates.target}.` }]);

    const back = await server.inject({ method: "DELETE", url: `/venues/${VENUE}/pricing-desk/advice/dismissals/${key}`, headers: asManager });
    expect(back.statusCode).toBe(200);
    expect((await advice()).items.some((entry) => entry.key === key)).toBe(true);
  });

  it("will not dismiss a suggestion for another venue's rate", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE}/pricing-desk/advice/dismissals`, headers: asManager,
      payload: { key: `${OTHER_RULE}:${dates.target}:raise` },
    });
    expect(res.statusCode).toBe(404);
    expect((await pool.query("SELECT 1 FROM general_audit_log")).rowCount).toBe(0);
  });

  it("saves a rate for the date from a suggestion, records that it followed one, and charges it instead of the everyday rate", async () => {
    const key = `${EVENING}:${dates.target}:raise`;
    const created = await server.inject({
      method: "POST", url: `/venues/${VENUE}/pricing`, headers: asManager,
      payload: {
        name: `Grand Hall — Evening, ${dates.target}`, type: "flat_rate", amount: 3150, spaceId: HALL,
        appliesFrom: "19:00", appliesUntil: "00:30", validFrom: dates.target, validTo: dates.target, adviceKey: key,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ data: { id: string } }>().data.id;
    const audit = await pool.query<{ summary: string; metadata: Record<string, unknown> }>(
      "SELECT summary, metadata FROM general_audit_log WHERE target_type = 'pricing_rule' AND target_id = $1", [id],
    );
    expect(audit.rows[0]?.summary).toBe(`Added "Grand Hall — Evening, ${dates.target}", from a suggestion.`);
    expect(audit.rows[0]?.metadata).toMatchObject({ followedAdvice: key });

    const estimate = (date: string) => server.inject({
      method: "POST", url: `/venues/${VENUE}/pricing/estimate`,
      payload: { spaceId: HALL, eventDate: date, startTime: "19:00", endTime: "23:00", guestCount: 120 },
    });
    expect((await estimate(dates.target)).json<{ data: { total: number } }>().data.total).toBe(3150);
    expect((await estimate(dates.next)).json<{ data: { total: number } }>().data.total).toBe(2800);
  });

  it("refuses a saved rate whose dates would run backwards", async () => {
    const dated = await server.inject({
      method: "PATCH", url: `/venues/${VENUE}/pricing/${EVENING}`, headers: asManager, payload: { validTo: "2027-01-31" },
    });
    expect(dated.statusCode).toBe(200);
    const backwards = await server.inject({
      method: "PATCH", url: `/venues/${VENUE}/pricing/${EVENING}`, headers: asManager, payload: { validFrom: "2027-02-01" },
    });
    expect(backwards.statusCode).toBe(400);
    const stored = await pool.query<{ valid_from: string | null }>("SELECT valid_from::text FROM pricing_rules WHERE id = $1", [EVENING]);
    expect(stored.rows[0]?.valid_from).toBeNull();
  });
});
