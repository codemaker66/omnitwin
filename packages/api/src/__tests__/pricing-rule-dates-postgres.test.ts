import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { registerErrorNormalizer } from "../middleware/error-normalizer.js";
import { pricingRuleRoutes } from "../routes/pricing-rules.js";

// ---------------------------------------------------------------------------
// A pricing rule's dates are calendar dates (audit pricing-money-4).
//
// validFrom and validTo are stored in PostgreSQL date columns. A date that
// does not exist is refused at the route with a 400 that names the field,
// before anything is written: a month of 00 or 13, a day past the month's
// end, 29 February outside a leap year, and year 0000, which PostgreSQL has
// no day for. Real edge dates are kept exactly as sent.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Pricing rule date tests require the explicit disposable platform database");
  }
}

const IMPOSSIBLE_DATES = [
  "2027-13-01", // no thirteenth month
  "2027-00-10", // no month zero
  "2027-12-32", // past the end of any month
  "2027-04-31", // 31st of a 30-day month
  "2027-06-31",
  "2027-02-29", // 29 February in a common year
  "1900-02-29", // a century year that is not a leap year
  "2027-02-30",
  "0000-01-01", // PostgreSQL has no year zero
] as const;

const REAL_EDGE_DATES = [
  ["2028-02-29", "2028-02-29"], // 29 February in a leap year
  ["2000-02-29", "2000-03-31"], // a century leap year, and a 31-day month's last day
  ["2027-04-30", "2027-12-31"], // a 30-day month's last day, and the year's
  ["0001-01-01", "9999-12-31"], // the first and last days a date column holds
] as const;

describe.skipIf(target === undefined)("pricing rule dates on the migrated disposable database", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  const venueId = randomUUID();
  const adminId = randomUUID();
  const headers = { authorization: `Bearer ${JSON.stringify({ id: adminId, email: `${adminId}@pricing.invalid`,
    role: "admin", platformRole: "none", venueId })}` };

  async function rulesAtVenue(): Promise<readonly (typeof schema.pricingRules.$inferSelect)[]> {
    return db.select().from(schema.pricingRules).where(eq(schema.pricingRules.venueId, venueId));
  }

  function create(dates: { validFrom?: string; validTo?: string }) {
    return server.inject({ method: "POST", url: `/venues/${venueId}/pricing`, headers,
      payload: { name: "TEST ONLY dated rate", type: "flat_rate", amount: 1500, ...dates } });
  }

  function refusedFields(body: string): readonly string[] {
    const parsed = JSON.parse(body) as { details?: readonly { path?: readonly (string | number)[] }[] };
    return (parsed.details ?? []).map((issue) => String(issue.path?.[0]));
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `pricing_rule_dates_${randomUUID()}`, max: 4 });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY pricing dates venue", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.users).values({ id: adminId, name: "TEST ONLY admin", email: `${adminId}@pricing.invalid`, role: "admin", venueId });
    server = Fastify();
    // The production error envelope, so an escaped error answers as it would live.
    registerErrorNormalizer(server);
    await server.register(pricingRuleRoutes, { db, prefix: "/venues/:venueId/pricing" });
    await server.ready();
  }, 60000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  it.each(IMPOSSIBLE_DATES)("refuses %s on a new rule with a 400 naming the field, and writes nothing", async (date) => {
    const before = (await rulesAtVenue()).length;
    for (const field of ["validFrom", "validTo"] as const) {
      const response = await create({ [field]: date });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json<{ code: string }>().code).toBe("VALIDATION_ERROR");
      expect(refusedFields(response.body)).toContain(field);
    }
    expect(await rulesAtVenue()).toHaveLength(before);
  });

  it.each(IMPOSSIBLE_DATES)("refuses %s on a change to a rule, and leaves the rule as it was", async (date) => {
    const made = await create({ validFrom: "2027-01-01", validTo: "2027-12-31" });
    expect(made.statusCode, made.body).toBe(201);
    const ruleId = made.json<{ data: { id: string } }>().data.id;
    for (const field of ["validFrom", "validTo"] as const) {
      const response = await server.inject({ method: "PATCH", url: `/venues/${venueId}/pricing/${ruleId}`, headers,
        payload: { [field]: date } });
      expect(response.statusCode, response.body).toBe(400);
      expect(refusedFields(response.body)).toContain(field);
    }
    const [stored] = await db.select().from(schema.pricingRules).where(eq(schema.pricingRules.id, ruleId));
    expect(stored).toMatchObject({ validFrom: "2027-01-01", validTo: "2027-12-31" });
  });

  it.each(REAL_EDGE_DATES)("keeps the real dates %s to %s exactly as sent", async (validFrom, validTo) => {
    const made = await create({ validFrom, validTo });
    expect(made.statusCode, made.body).toBe(201);
    const ruleId = made.json<{ data: { id: string } }>().data.id;
    const [stored] = await db.select().from(schema.pricingRules).where(eq(schema.pricingRules.id, ruleId));
    expect(stored).toMatchObject({ validFrom, validTo });

    const changed = await server.inject({ method: "PATCH", url: `/venues/${venueId}/pricing/${ruleId}`, headers,
      payload: { validFrom: validTo } });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json<{ data: { validFrom: string } }>().data.validFrom).toBe(validTo);
  });
});
