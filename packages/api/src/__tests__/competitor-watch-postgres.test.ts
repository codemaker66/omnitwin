import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CompetitorWatchSchema,
  MarketContextSchema,
  PricingAdviceSchema,
  SUGGESTED_COMPETITOR_SET,
  type CompetitorWatch,
  type PricingAdvice,
} from "@omnitwin/types";
import * as schema from "../db/schema.js";
import type { Database } from "../db/client.js";
import { competitorWatchRoutes } from "../routes/competitor-watch.js";
import { pricingDeskRoutes } from "../routes/pricing-desk.js";
import { pricingRuleRoutes } from "../routes/pricing-rules.js";
import { opportunityRoutes } from "../routes/opportunities.js";
import { adminRoutes } from "../routes/admin.js";
import { resolveUploadScope } from "../routes/uploads.js";
import type { JwtUser } from "../middleware/auth.js";
import { runPageChecks } from "../services/competitor-watch-data.js";
import { pageTextHash, type FetchAnswer, type PageFetcher } from "../services/page-check.js";
import { migrationText } from "./migration-text.js";

// ---------------------------------------------------------------------------
// The competitor watch on isolated PostgreSQL, with migration 0097's own SQL
// (its composite keys and its append-only trigger), so the database is shown
// to hold what the code promises:
//
//   - only the people who set prices keep the watch; the commercial team
//     reads the set's names to say who won a lost deal;
//   - one venue never reads or writes another's watch, down to the keys;
//   - captures are append-only, refused from listing sites, dated and judged
//     Current, Check due, Stale, Source gone or Unverified;
//   - the suggestion maths gives the same answer with and without captures;
//   - "who won" rides the existing Mark lost reason, in one transaction;
//   - the page check runs only where a person allowed it, at most weekly,
//     and flags a change for a person. The network is a fake.
//
// Opt-in, isolated PostgreSQL only: a loopback database named
// venviewer_route_atomicity_test. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Competitor watch tests require their explicit isolated loopback database");
  }
}

const VENUE = "61616161-6161-4161-8161-616161616161";
const OTHER_VENUE = "61616161-6161-4161-8161-616161616999";
const HALL = "62626262-6262-4262-8262-626262626201";
const OTHER_ROOM = "62626262-6262-4262-8262-626262626299";
const EVENING = "63636363-6363-4363-8363-636363636301";
const ADMIN = "64646464-6464-4464-8464-646464646401";
const MANAGER = "64646464-6464-4464-8464-646464646402";
const STAFF = "64646464-6464-4464-8464-646464646403";
const SALES = "64646464-6464-4464-8464-646464646404";
const HALLKEEPER = "64646464-6464-4464-8464-646464646405";
const OTHER_MANAGER = "64646464-6464-4464-8464-646464646499";
const DEAL = "65656565-6565-4565-8565-656565656501";
const OTHER_DEAL = "65656565-6565-4565-8565-656565656599";

const DAY = 86_400_000;
const CRON_TOKEN = "competitor-watch-cron-token-for-tests-0123456789";

function headers(role: string, id: string, venueId: string = VENUE): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ id, email: `${role}@example.test`, role, platformRole: "none", venueId })}` };
}
const asManager = headers("manager", MANAGER);
const asAdmin = headers("admin", ADMIN);
const asStaff = headers("staff", STAFF);
const asSales = headers("sales", SALES);
const asHallkeeper = headers("hallkeeper", HALLKEEPER);
const asOtherManager = headers("manager", OTHER_MANAGER, OTHER_VENUE);

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
const THIS_YEAR = new Date().getUTCFullYear();
const NEXT_YEAR = THIS_YEAR + 1;

/** The first Saturday at least eight months ahead, and every Saturday of
 *  the same month one and two years before it (the pricing desk's own). */
function saturdays(): { readonly target: string; readonly past: readonly string[] } {
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
  return { target: isoDate(ms), past };
}

/** The network, as a table of answers; every request is recorded. */
const network: { answers: Record<string, FetchAnswer>; asked: string[] } = { answers: {}, asked: [] };
const fakeFetcher: PageFetcher = {
  get(url: URL): Promise<FetchAnswer> {
    network.asked.push(url.href);
    return Promise.resolve(network.answers[url.href] ?? { kind: "response", status: 404, body: "", location: null });
  },
};
const PACKAGES = (price: string): string => `<html><body><main><h1>Wedding packages</h1><p>Grand Central Package ${price} per person</p></main></body></html>`;

describe.skipIf(testUrl === undefined)("the competitor watch on isolated PostgreSQL", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  const fixtureSchema = `competitor_watch_${randomUUID().replaceAll("-", "")}`;
  const baseTables: PgTable[] = [
    schema.venues, schema.spaces, schema.users, schema.files, schema.pricingRules, schema.generalAuditLog,
    schema.bookings, schema.bookingStatusHistory, schema.enquiries, schema.opportunities, schema.opportunityStatusHistory,
    schema.quotes, schema.quoteLineItems, schema.activities, schema.followUpTasks, schema.proposals, schema.contacts,
    schema.clientAccounts,
  ];
  const watchTables = ["competitor_losses", "competitor_page_checks", "competitor_price_captures", "competitor_venues"];
  const dates = saturdays();

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
    // The watch's tables come from the migration itself, keys and trigger included.
    for (const statement of (await migrationText("_competitor_watch")).split("--> statement-breakpoint")) {
      if (statement.trim() !== "") await pool.query(statement);
    }
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(competitorWatchRoutes, { db, fetcher: fakeFetcher, prefix: "/venues/:venueId/competitor-watch" });
    await server.register(pricingRuleRoutes, { db, prefix: "/venues/:venueId/pricing" });
    await server.register(pricingDeskRoutes, { db, prefix: "/venues/:venueId/pricing-desk" });
    await server.register(opportunityRoutes, { db, prefix: "/opportunities" });
    await server.register(adminRoutes, { db, pageFetcher: fakeFetcher, prefix: "/admin" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    network.answers = {};
    network.asked = [];
    const names = [...baseTables.map((table) => getTableConfig(table).name), ...watchTables];
    await pool.query(`TRUNCATE ${names.map((name) => `"${name}"`).join(", ")} CASCADE`);
    await pool.query(`INSERT INTO venues (id, name, slug, timezone) VALUES
      ($1, 'Trades Hall', 'trades-hall-glasgow', 'Europe/London'), ($2, 'Other venue', 'other-venue', 'Europe/London')`, [VENUE, OTHER_VENUE]);
    await pool.query(`INSERT INTO spaces (id, venue_id, name, slug, sort_order) VALUES
      ($1, $3, 'Grand Hall', 'grand-hall', 0), ($2, $4, 'Other room', 'other-room', 0)`, [HALL, OTHER_ROOM, VENUE, OTHER_VENUE]);
    await pool.query(`INSERT INTO users (id, email, name, role, platform_role, venue_id) VALUES
      ($1, 'admin@example.test', 'Moira Stewart', 'admin', 'none', $7),
      ($2, 'manager@example.test', 'Callum Reid', 'manager', 'none', $7),
      ($3, 'staff@example.test', 'Ailsa Grant', 'staff', 'none', $7),
      ($4, 'sales@example.test', 'Rory Bain', 'sales', 'none', $7),
      ($5, 'hallkeeper@example.test', 'Iain Shaw', 'hallkeeper', 'none', $7),
      ($6, 'other@example.test', 'Other Person', 'manager', 'none', $8)`,
    [ADMIN, MANAGER, STAFF, SALES, HALLKEEPER, OTHER_MANAGER, VENUE, OTHER_VENUE]);
    await pool.query(`INSERT INTO pricing_rules (id, venue_id, space_id, name, type, amount, currency, is_active, applies_from, applies_until, created_at)
      VALUES ($1, $2, $3, 'Grand Hall — Evening', 'flat_rate', '2800.00', 'GBP', true, '19:00', '00:30', $4)`,
    [EVENING, VENUE, HALL, new Date("2026-01-01T09:00:00Z")]);
    await pool.query(`INSERT INTO opportunities (id, venue_id, title, stage, estimated_value_minor, currency, next_action, created_at, updated_at)
      VALUES ($1, $3, 'The Hartley wedding', 'proposal_sent', 1200000, 'GBP', 'Follow up', now(), now()),
             ($2, $4, 'Other venue deal', 'proposal_sent', 100000, 'GBP', 'Follow up', now(), now())`,
    [DEAL, OTHER_DEAL, VENUE, OTHER_VENUE]);
  });

  afterAll(async () => {
    await server?.close();
    await pool?.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
    await pool?.end();
  });

  async function watch(as = asManager, venueId = VENUE): Promise<CompetitorWatch> {
    const res = await server.inject({ method: "GET", url: `/venues/${venueId}/competitor-watch`, headers: as });
    expect(res.statusCode).toBe(200);
    return CompetitorWatchSchema.parse(res.json<{ data: unknown }>().data);
  }

  async function startSet(): Promise<CompetitorWatch> {
    const res = await server.inject({ method: "POST", url: `/venues/${VENUE}/competitor-watch/suggested`, headers: asManager });
    expect(res.statusCode).toBe(201);
    return CompetitorWatchSchema.parse(res.json<{ data: { watch: unknown } }>().data.watch);
  }

  function idOf(set: CompetitorWatch, name: string): string {
    const found = set.competitors.find((competitor) => competitor.name === name);
    if (found === undefined) throw new Error(`${name} is not in the set`);
    return found.id;
  }

  const VOCO = "voco Grand Central";
  const VOCO_PAGE = "https://grandcentral.vocohotels.com/wedding-packages/";

  function capture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      sourceUrl: VOCO_PAGE, sourceKind: "own_page", seenOn: isoDate(Date.now() - DAY), packageName: "Grand Central Package",
      amountMinor: 13000, priceBasis: "per_head", guests: 150, priceYear: NEXT_YEAR, includes: ["room_hire", "catering"],
      includesNote: "Wedding breakfast and evening reception", vat: "not_stated", evidenceFileId: null, note: null, supersedesId: null,
      ...overrides,
    };
  }

  async function record(competitorId: string, overrides: Record<string, unknown> = {}, as = asManager): Promise<{ status: number; id: string | null; body: Record<string, unknown> }> {
    const res = await server.inject({ method: "POST", url: `/venues/${VENUE}/competitor-watch/${competitorId}/captures`, headers: as, payload: capture(overrides) });
    const body = res.json<Record<string, unknown>>();
    const data = body["data"] as { id?: string } | undefined;
    return { status: res.statusCode, id: data?.id ?? null, body };
  }

  // -------------------------------------------------------------------------

  it("is kept by those who set prices; the commercial team reads only the names", async () => {
    const refused = await server.inject({ method: "GET", url: `/venues/${VENUE}/competitor-watch`, headers: asStaff });
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ error: string }>().error).toBe("The competitor watch is kept by an administrator or a manager at the venue, beside the price list. Ask them.");
    expect((await server.inject({ method: "GET", url: `/venues/${VENUE}/competitor-watch`, headers: asSales })).statusCode).toBe(403);
    expect((await server.inject({ method: "POST", url: `/venues/${VENUE}/competitor-watch/suggested`, headers: asStaff })).statusCode).toBe(403);
    expect((await watch(asAdmin)).competitors).toEqual([]);

    await startSet();
    const names = await server.inject({ method: "GET", url: `/venues/${VENUE}/competitor-watch/names`, headers: asSales });
    expect(names.statusCode).toBe(200);
    expect(names.json<{ data: { name: string }[] }>().data.map((entry) => entry.name)).toHaveLength(10);
    expect((await server.inject({ method: "GET", url: `/venues/${VENUE}/competitor-watch/names`, headers: asHallkeeper })).statusCode).toBe(403);
  });

  it("starts from the suggested set in one step, each with its reason and a review six months out", async () => {
    const before = await watch();
    expect(before.suggestedSetOffered).toBe(true);
    const set = await startSet();
    expect(set.suggestedSetOffered).toBe(false);
    expect(set.competitors.map((competitor) => competitor.name)).toEqual([
      "1599 at the Royal College", "Citation, Wilson Street", "The Corinthian Club", "The Exchange, Royal Exchange Square",
      "The Merchants House of Glasgow", "voco Grand Central",
      "Glasgow Art Club", "Kelvingrove Art Gallery and Museum", "Kimpton Blythswood Square", "University of Glasgow, Bute Hall",
    ]);
    for (const suggested of SUGGESTED_COMPETITOR_SET) {
      const loaded = set.competitors.find((competitor) => competitor.name === suggested.name);
      expect(loaded?.reason).toBe(suggested.reason);
      expect(loaded?.tier).toBe(suggested.tier);
      expect(loaded?.addedByName).toBe("Callum Reid");
      expect(loaded?.reviewDue).toBe(false);
      expect(loaded?.pageCheck.allowedAt).toBeNull();
    }
    const due = new Date(`${set.today}T00:00:00Z`);
    due.setUTCDate(1);
    due.setUTCMonth(due.getUTCMonth() + 6);
    expect(set.competitors[0]?.reviewDueOn.slice(0, 7)).toBe(due.toISOString().slice(0, 7));

    const again = await server.inject({ method: "POST", url: `/venues/${VENUE}/competitor-watch/suggested`, headers: asManager });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ code: string }>().code).toBe("SET_STARTED");
    // The set is Glasgow's: another venue starts its own.
    const elsewhere = await server.inject({ method: "POST", url: `/venues/${OTHER_VENUE}/competitor-watch/suggested`, headers: asOtherManager });
    expect(elsewhere.statusCode).toBe(409);
    expect(elsewhere.json<{ error: string }>().error).toContain("Add the venues you compare yourselves with");
  });

  it("lets the office change, review and remove a venue, keeping its records", async () => {
    const set = await startSet();
    const voco = idOf(set, VOCO);
    expect((await record(voco)).status).toBe(201);
    const changed = await server.inject({
      method: "PATCH", url: `/venues/${VENUE}/competitor-watch/${voco}`, headers: asManager,
      payload: { tier: "secondary", reason: "Large hotel weddings, 150 and more." },
    });
    expect(changed.statusCode).toBe(200);
    const listing = await server.inject({
      method: "PATCH", url: `/venues/${VENUE}/competitor-watch/${voco}`, headers: asManager,
      payload: { pricePageUrl: "https://www.bridebook.com/uk/wedding-venues/voco" },
    });
    expect(listing.statusCode).toBe(422);
    expect(listing.json<{ error: string }>().error).toContain("bridebook.com, a site that lists many venues");
    const duplicate = await server.inject({
      method: "PATCH", url: `/venues/${VENUE}/competitor-watch/${voco}`, headers: asManager, payload: { name: "Glasgow Art Club" },
    });
    expect(duplicate.statusCode).toBe(409);
    const blank = await server.inject({ method: "PATCH", url: `/venues/${VENUE}/competitor-watch/${voco}`, headers: asManager, payload: { reason: "  " } });
    expect(blank.statusCode).toBe(400);

    await pool.query("UPDATE competitor_venues SET review_due_on = current_date - 1 WHERE id = $1", [voco]);
    expect((await watch()).competitors.find((competitor) => competitor.id === voco)?.reviewDue).toBe(true);
    const reviewed = await server.inject({ method: "POST", url: `/venues/${VENUE}/competitor-watch/${voco}/reviewed`, headers: asAdmin });
    const afterReview = CompetitorWatchSchema.parse(reviewed.json<{ data: { watch: unknown } }>().data.watch).competitors.find((competitor) => competitor.id === voco);
    expect(afterReview?.reviewDue).toBe(false);
    expect(afterReview?.reviewedByName).toBe("Moira Stewart");

    const removed = await server.inject({ method: "DELETE", url: `/venues/${VENUE}/competitor-watch/${voco}`, headers: asManager });
    expect(removed.statusCode).toBe(200);
    expect((await watch()).competitors.some((competitor) => competitor.id === voco)).toBe(false);
    const kept = await pool.query("SELECT removed_by FROM competitor_venues WHERE id = $1", [voco]);
    expect(kept.rows).toEqual([{ removed_by: MANAGER }]);
    expect((await pool.query("SELECT 1 FROM competitor_price_captures WHERE competitor_id = $1", [voco])).rowCount).toBe(1);
  });

  it("holds the set to twelve", async () => {
    for (let index = 1; index <= 12; index += 1) {
      const res = await server.inject({
        method: "POST", url: `/venues/${OTHER_VENUE}/competitor-watch`, headers: asOtherManager,
        payload: { name: `Venue ${String(index)}`, website: null, pricePageUrl: null, tier: "primary", reason: "Same buyer." },
      });
      expect(res.statusCode).toBe(201);
    }
    const thirteenth = await server.inject({
      method: "POST", url: `/venues/${OTHER_VENUE}/competitor-watch`, headers: asOtherManager,
      payload: { name: "Venue 13", website: null, pricePageUrl: null, tier: "secondary", reason: "Same buyer." },
    });
    expect(thirteenth.statusCode).toBe(409);
    expect(thirteenth.json<{ error: string }>().error).toBe("The set holds 12 venues, its limit. Remove one before adding another.");
  });

  it("records a figure only from the venue's own page or brochure, with a plain reason otherwise", async () => {
    const voco = idOf(await startSet(), VOCO);
    const listing = await record(voco, { sourceUrl: "https://www.tagvenue.com/venues/glasgow/voco" });
    expect(listing.status).toBe(422);
    expect(listing.body["error"]).toBe("That address is on tagvenue.com, a site that lists many venues. Record the figure from the venue's own page or brochure, and use the listing only to find it.");
    const elsewhere = await record(voco, { sourceUrl: "https://files.example.org/voco.pdf" });
    expect(elsewhere.status).toBe(422);
    expect((await record(voco, { sourceUrl: "https://files.example.org/voco.pdf", sourceKind: "brochure" })).status).toBe(201);
    const later = await record(voco, { seenOn: isoDate(Date.now() + 3 * DAY) });
    expect(later.status).toBe(422);
    expect(later.body["error"]).toBe("The date seen cannot be after today.");
    expect((await record(voco, {}, asStaff)).status).toBe(403);
    expect((await pool.query("SELECT 1 FROM competitor_price_captures")).rowCount).toBe(1);
  });

  it("keeps a screenshot only when it was stored for that competitor, by those who keep the watch", async () => {
    const set = await startSet();
    const voco = idOf(set, VOCO);
    const corinthian = idOf(set, "The Corinthian Club");
    const person = (role: string, venueId: string): JwtUser => ({ id: MANAGER, email: "x@example.test", name: "X", role, platformRole: "none", venueId });
    expect(await resolveUploadScope(db, person("manager", VENUE), "competitor_watch", voco)).toEqual({
      venueId: VENUE, keyPrefix: `private/venues/${VENUE}/competitor-watch/${voco}`, visibility: "private",
    });
    expect(await resolveUploadScope(db, person("staff", VENUE), "competitor_watch", voco)).toBeNull();
    expect(await resolveUploadScope(db, person("manager", OTHER_VENUE), "competitor_watch", voco)).toBeNull();
    expect(await resolveUploadScope(db, person("manager", VENUE), "competitor_watch", randomUUID())).toBeNull();
    expect(await resolveUploadScope(db, person("manager", VENUE), "competitor_watch", voco, "public")).toBeNull();

    const file = await pool.query<{ id: string }>(
      `INSERT INTO files (file_key, filename, content_type, context, context_id, visibility, uploaded_by)
       VALUES ('private/venues/x/competitor-watch/y/z.png', 'voco.png', 'image/png', 'competitor_watch', $1, 'private', $2) RETURNING id`,
      [corinthian, MANAGER],
    );
    const wrong = await record(voco, { evidenceFileId: file.rows[0]?.id });
    expect(wrong.status).toBe(422);
    expect(wrong.body["code"]).toBe("EVIDENCE_NOT_FOUND");
    const right = await record(corinthian, { sourceUrl: "https://thecorinthianclub.co.uk/private-hire/weddings", evidenceFileId: file.rows[0]?.id });
    expect(right.status).toBe(201);
  });

  it("keeps every figure: replaced, never edited or deleted, and marked when its source goes", async () => {
    const voco = idOf(await startSet(), VOCO);
    const first = await record(voco);
    const second = await record(voco, { amountMinor: 13500, supersedesId: first.id });
    expect(second.status).toBe(201);
    const clash = await record(voco, { amountMinor: 14000, supersedesId: first.id });
    expect(clash.status).toBe(409);
    expect(clash.body["code"]).toBe("ALREADY_REPLACED");

    const competitor = (await watch()).competitors.find((entry) => entry.id === voco);
    expect(competitor?.captures.map((entry) => [entry.amountMinor, entry.supersededById, entry.capturedByName])).toEqual([
      [13500, null, "Callum Reid"],
      [13000, second.id, "Callum Reid"],
    ]);

    await expect(pool.query("UPDATE competitor_price_captures SET amount_minor = 9900 WHERE id = $1", [first.id])).rejects.toThrow(/append-only/u);
    await expect(pool.query("DELETE FROM competitor_price_captures WHERE id = $1", [first.id])).rejects.toThrow(/append-only/u);

    const gone = await server.inject({ method: "POST", url: `/venues/${VENUE}/competitor-watch/${voco}/captures/${String(second.id)}/source-gone`, headers: asManager });
    expect(gone.statusCode).toBe(200);
    const marked = CompetitorWatchSchema.parse(gone.json<{ data: { watch: unknown } }>().data.watch).competitors.find((entry) => entry.id === voco)?.captures[0];
    expect(marked?.freshness).toBe("source_gone");
    expect(marked?.sourceGoneByName).toBe("Callum Reid");
    const twice = await server.inject({ method: "POST", url: `/venues/${VENUE}/competitor-watch/${voco}/captures/${String(second.id)}/source-gone`, headers: asManager });
    expect(twice.statusCode).toBe(409);
    await expect(pool.query("UPDATE competitor_price_captures SET source_gone_at = NULL WHERE id = $1", [second.id])).rejects.toThrow(/append-only/u);
  });

  it("dates each figure: Current, Check due, Stale and Unverified", async () => {
    const voco = idOf(await startSet(), VOCO);
    await record(voco, { packageName: "Current" });
    await record(voco, { packageName: "Due a check", seenOn: isoDate(Date.now() - 100 * DAY) });
    await record(voco, { packageName: "Stale", seenOn: isoDate(Date.now() - 200 * DAY) });
    await record(voco, { packageName: "Year passed", priceYear: THIS_YEAR - 1 });
    await record(voco, { packageName: "No year", priceYear: null });
    const captures = (await watch()).competitors.find((entry) => entry.id === voco)?.captures ?? [];
    const by = Object.fromEntries(captures.map((entry) => [entry.packageName, entry.freshness]));
    expect(by).toEqual({ "Current": "current", "Due a check": "check_due", "Stale": "stale", "Year passed": "stale", "No year": "unverified" });
  });

  it("never lets one venue see or write another's watch", async () => {
    const voco = idOf(await startSet(), VOCO);
    await record(voco);
    expect((await server.inject({ method: "GET", url: `/venues/${VENUE}/competitor-watch`, headers: asOtherManager })).statusCode).toBe(403);
    expect((await watch(asOtherManager, OTHER_VENUE)).competitors).toEqual([]);
    // Through its own venue's path, the other venue's competitor is not there.
    const crossed = await server.inject({
      method: "POST", url: `/venues/${OTHER_VENUE}/competitor-watch/${voco}/captures`, headers: asOtherManager, payload: capture(),
    });
    expect(crossed.statusCode).toBe(404);
    const renamed = await server.inject({ method: "PATCH", url: `/venues/${OTHER_VENUE}/competitor-watch/${voco}`, headers: asOtherManager, payload: { name: "Mine now" } });
    expect(renamed.statusCode).toBe(404);
    const context = await server.inject({ method: "GET", url: `/venues/${OTHER_VENUE}/competitor-watch/context?year=${String(NEXT_YEAR)}`, headers: asOtherManager });
    expect(MarketContextSchema.parse(context.json<{ data: unknown }>().data).lines).toEqual([]);
    // And the keys hold it below the API: no row may join a venue to another's competitor.
    await expect(pool.query(
      `INSERT INTO competitor_price_captures (venue_id, competitor_id, source_url, source_kind, seen_on, captured_by, package_name, amount_minor, price_basis, vat)
       VALUES ($1, $2, $3, 'own_page', current_date, $4, 'X', 100, 'fixed', 'not_stated')`,
      [OTHER_VENUE, voco, VOCO_PAGE, OTHER_MANAGER],
    )).rejects.toThrow(/foreign key/u);
  });

  it("shows beside a suggestion only Current figures for its year, in the set's order, never by price", async () => {
    const set = await startSet();
    const voco = idOf(set, VOCO);
    const corinthian = idOf(set, "The Corinthian Club");
    const artClub = idOf(set, "Glasgow Art Club");
    await record(voco, { amountMinor: 13000 });
    await record(corinthian, { sourceUrl: "https://thecorinthianclub.co.uk/private-hire/weddings", amountMinor: 900000, priceBasis: "fixed", guests: 100, packageName: "Classic" });
    await record(artClub, { sourceUrl: "https://www.glasgowartclub.co.uk/hire", amountMinor: 5000, packageName: "Dinner" });
    await record(voco, { packageName: "Old", seenOn: isoDate(Date.now() - 120 * DAY) });
    await record(voco, { packageName: "Other year", priceYear: NEXT_YEAR + 1 });
    await record(voco, { packageName: "No year", priceYear: null });

    const res = await server.inject({ method: "GET", url: `/venues/${VENUE}/competitor-watch/context?year=${String(NEXT_YEAR)}`, headers: asManager });
    expect(res.statusCode).toBe(200);
    const context = MarketContextSchema.parse(res.json<{ data: unknown }>().data);
    expect(context.lines.map((line) => [line.competitorName, line.packageName, line.amountMinor])).toEqual([
      ["The Corinthian Club", "Classic", 900000],
      ["voco Grand Central", "Grand Central Package", 13000],
      ["Glasgow Art Club", "Dinner", 5000],
    ]);
    expect(context.lines[0]).toMatchObject({ priceBasis: "fixed", guests: 100, capturedByName: "Callum Reid", sourceKind: "own_page" });
    expect(context.checkDue).toBe(1);
    expect(context.more).toBe(0);
    expect(Object.keys(res.json<{ data: Record<string, unknown> }>().data).sort()).toEqual(["checkDue", "lines", "more", "today", "year"]);
    expect((await server.inject({ method: "GET", url: `/venues/${VENUE}/competitor-watch/context?year=${String(NEXT_YEAR)}`, headers: asStaff })).statusCode).toBe(403);
  });

  it("gives the same suggestions with and without competitors' figures", async () => {
    const booking = async (date: string, kind: "hold" | "ink", createdAt: Date): Promise<void> => {
      const start = new Date(`${date}T19:00:00Z`);
      await pool.query(`INSERT INTO bookings (venue_id, space_id, kind, status, title, starts_at, ends_at, joint_flag, rank, created_at)
        VALUES ($1, $2, $3, 'active', 'Evening', $4, $5, false, $6, $7)`,
      [VENUE, HALL, kind, start, new Date(start.getTime() + 4 * 3_600_000), kind === "hold" ? 1 : null, createdAt]);
    };
    for (const date of dates.past) await booking(date, "ink", new Date(new Date(`${date}T19:00:00Z`).getTime() - 400 * DAY));
    await booking(dates.target, "hold", new Date(Date.now() - 10 * DAY));
    await booking(dates.target, "hold", new Date(Date.now() - 5 * DAY));

    const advice = async (): Promise<PricingAdvice> => {
      const res = await server.inject({ method: "GET", url: `/venues/${VENUE}/pricing-desk/advice`, headers: asManager });
      expect(res.statusCode).toBe(200);
      return PricingAdviceSchema.parse(res.json<{ data: unknown }>().data);
    };
    const without = await advice();
    expect(without.items.some((item) => item.kind === "raise")).toBe(true);

    // Figures far below and far above the venue's rate, for the target's
    // year and this one, a lost deal and a page change.
    const set = await startSet();
    const targetYear = Number(dates.target.slice(0, 4));
    for (const year of new Set([targetYear, THIS_YEAR, NEXT_YEAR])) {
      await record(idOf(set, VOCO), { priceYear: year, amountMinor: 1_000, priceBasis: "fixed", guests: 10, packageName: `Low ${String(year)}` });
      await record(idOf(set, "The Corinthian Club"), {
        sourceUrl: "https://thecorinthianclub.co.uk/private-hire/weddings", priceYear: year, amountMinor: 9_000_000, priceBasis: "fixed", packageName: `High ${String(year)}`,
      });
    }
    await pool.query("UPDATE competitor_venues SET page_changed_at = now() WHERE venue_id = $1", [VENUE]);
    const lost = await server.inject({
      method: "PATCH", url: `/opportunities/${DEAL}`, headers: asManager,
      payload: { stage: "lost", note: "Over budget", lostTo: { competitorId: idOf(set, VOCO), otherName: null, clientFigureMinor: 500_000, clientFigureBasis: "fixed" } },
    });
    expect(lost.statusCode).toBe(200);

    const withCaptures = await advice();
    expect({ ...withCaptures, computedAt: "" }).toEqual({ ...without, computedAt: "" });
  });

  it("records who won a lost deal with its reason, in one move, and keeps the client's figure off the watch", async () => {
    const set = await startSet();
    const voco = idOf(set, VOCO);
    const wrongStage = await server.inject({
      method: "PATCH", url: `/opportunities/${DEAL}`, headers: asSales,
      payload: { stage: "won", note: "Signed", lostTo: { competitorId: voco, otherName: null, clientFigureMinor: null, clientFigureBasis: null } },
    });
    expect(wrongStage.statusCode).toBe(422);
    const othersCompetitor = await server.inject({
      method: "PATCH", url: `/opportunities/${OTHER_DEAL}`, headers: asOtherManager,
      payload: { stage: "lost", note: "Chose another venue", lostTo: { competitorId: voco, otherName: null, clientFigureMinor: null, clientFigureBasis: null } },
    });
    expect(othersCompetitor.statusCode).toBe(422);
    expect((await pool.query("SELECT stage FROM opportunities WHERE id = $1", [OTHER_DEAL])).rows).toEqual([{ stage: "proposal_sent" }]);

    const lost = await server.inject({
      method: "PATCH", url: `/opportunities/${DEAL}`, headers: asSales,
      payload: { stage: "lost", note: "Chose another venue", lostTo: { competitorId: voco, otherName: null, clientFigureMinor: 1_150_000, clientFigureBasis: "fixed" } },
    });
    expect(lost.statusCode).toBe(200);
    const detail = await server.inject({ method: "GET", url: `/opportunities/${DEAL}`, headers: asSales });
    const history = detail.json<{ data: { history: { toStage: string; note: string; lostTo: Record<string, unknown> | null }[] } }>().data.history;
    expect(history[0]).toMatchObject({
      toStage: "lost", note: "Chose another venue",
      lostTo: { name: VOCO, competitorId: voco, clientFigureMinor: 1_150_000, clientFigureBasis: "fixed", currency: "GBP" },
    });

    const watched = (await watch()).competitors.find((entry) => entry.id === voco);
    expect(watched?.losses.count).toBe(1);
    expect(watched?.losses.recent[0]).toMatchObject({ dealTitle: "The Hartley wedding", reason: "Chose another venue" });
    const raw = JSON.stringify(await watch());
    expect(raw).not.toContain("1150000");
    expect(raw).not.toContain("clientFigure");

    const other = await server.inject({
      method: "PATCH", url: `/opportunities/${OTHER_DEAL}`, headers: asOtherManager,
      payload: { stage: "lost", note: "Chose another venue", lostTo: { competitorId: null, otherName: "Òran Mór", clientFigureMinor: null, clientFigureBasis: null } },
    });
    expect(other.statusCode).toBe(200);
    expect((await pool.query("SELECT venue_id, other_name FROM competitor_losses WHERE opportunity_id = $1", [OTHER_DEAL])).rows)
      .toEqual([{ venue_id: OTHER_VENUE, other_name: "Òran Mór" }]);
  });

  it("checks a page only once a person has allowed it, at most weekly, and flags a change for a person", async () => {
    const set = await startSet();
    const voco = idOf(set, VOCO);
    const merchants = idOf(set, "The Merchants House of Glasgow");
    const robots = "https://grandcentral.vocohotels.com/robots.txt";
    network.answers = {
      [robots]: { kind: "response", status: 200, body: "User-agent: *\nAllow: /", location: null },
      [VOCO_PAGE]: { kind: "response", status: 200, body: PACKAGES("£130"), location: null },
    };

    const unticked = await server.inject({ method: "PUT", url: `/venues/${VENUE}/competitor-watch/${voco}/page-check`, headers: asManager, payload: { termsRead: true } });
    expect(unticked.statusCode).toBe(400);
    const noPage = await server.inject({ method: "PUT", url: `/venues/${VENUE}/competitor-watch/${idOf(set, "1599 at the Royal College")}/page-check`, headers: asManager, payload: { termsRead: true, robotsRead: true } });
    expect(noPage.statusCode).toBe(409);

    // Nothing allowed yet: nothing is read.
    const idle = await server.inject({ method: "POST", url: `/venues/${VENUE}/competitor-watch/page-checks`, headers: asManager });
    expect(idle.statusCode).toBe(200);
    expect(network.asked).toEqual([]);

    const allowed = await server.inject({ method: "PUT", url: `/venues/${VENUE}/competitor-watch/${voco}/page-check`, headers: asManager, payload: { termsRead: true, robotsRead: true } });
    expect(allowed.statusCode).toBe(200);
    const run = await server.inject({ method: "POST", url: `/venues/${VENUE}/competitor-watch/page-checks`, headers: asManager });
    const ran = run.json<{ data: { run: { results: { competitorId: string; outcome: string }[] }; watch: unknown } }>().data;
    expect(ran.run.results.find((result) => result.competitorId === voco)?.outcome).toBe("first_seen");
    expect(ran.run.results.find((result) => result.competitorId === merchants)?.outcome).toBe("not_allowed");
    expect(network.asked).toEqual([robots, VOCO_PAGE]);
    const after = CompetitorWatchSchema.parse(ran.watch).competitors.find((entry) => entry.id === voco);
    expect(after?.pageCheck).toMatchObject({ allowedByName: "Callum Reid", outcome: "first_seen", httpStatus: 200, changedAt: null });

    // At most weekly: an immediate second press reads nothing.
    network.asked = [];
    const soon = await server.inject({ method: "POST", url: `/venues/${VENUE}/competitor-watch/page-checks`, headers: asManager });
    expect(soon.json<{ data: { run: { results: { competitorId: string; outcome: string }[] } } }>().data.run.results.find((result) => result.competitorId === voco)?.outcome).toBe("not_due");
    expect(network.asked).toEqual([]);

    // A figure seen before the page changed is due a check; the change waits for a person.
    expect((await record(voco, { seenOn: isoDate(Date.now() - 2 * DAY) })).status).toBe(201);
    network.answers[VOCO_PAGE] = { kind: "response", status: 200, body: PACKAGES("£135"), location: null };
    const week = await runPageChecks(db, { venueId: null, now: new Date(Date.now() + 8 * DAY), fetcher: fakeFetcher, runBy: "schedule", triggeredBy: null });
    expect(week.results).toEqual([{ competitorId: voco, outcome: "changed", nextCheckAfter: expect.any(String) as string }]);
    const flagged = (await watch()).competitors.find((entry) => entry.id === voco);
    expect(flagged?.pageCheck.changedAt).not.toBeNull();
    expect(flagged?.captures[0]?.freshness).toBe("check_due");
    const log = await pool.query<{ content_hash: string; robots: string; run_by: string }>(
      "SELECT content_hash, robots, run_by FROM competitor_page_checks WHERE competitor_id = $1 ORDER BY checked_at", [voco],
    );
    expect(log.rows).toEqual([
      { content_hash: pageTextHash(PACKAGES("£130")), robots: "allowed", run_by: "person" },
      { content_hash: pageTextHash(PACKAGES("£135")), robots: "allowed", run_by: "schedule" },
    ]);

    // A false alarm is dismissed by a person, and the figure is current again.
    // (The pass ran a week ahead of the clock; the change is brought back to
    // just now so the dismissal follows it, as it would.)
    await pool.query("UPDATE competitor_venues SET page_changed_at = now() - interval '1 minute' WHERE id = $1", [voco]);
    const dismissed = await server.inject({ method: "POST", url: `/venues/${VENUE}/competitor-watch/${voco}/page-change/dismissal`, headers: asManager });
    const clear = CompetitorWatchSchema.parse(dismissed.json<{ data: { watch: unknown } }>().data.watch).competitors.find((entry) => entry.id === voco);
    expect(clear?.pageCheck.changedAt).toBeNull();
    expect(clear?.captures[0]?.freshness).toBe("current");

    // A site that refuses is left alone for four weeks.
    network.answers[VOCO_PAGE] = { kind: "response", status: 429, body: "", location: null };
    const refusedAt = new Date(Date.now() + 16 * DAY);
    const refused = await runPageChecks(db, { venueId: VENUE, now: refusedAt, fetcher: fakeFetcher, runBy: "person", triggeredBy: MANAGER });
    const next = refused.results.find((result) => result.competitorId === voco);
    expect(next?.outcome).toBe("refused");
    expect(new Date(next?.nextCheckAfter ?? 0).getTime()).toBe(refusedAt.getTime() + 28 * DAY);
  }, 30_000);

  it("changing the page's address turns the check off until a person allows it again", async () => {
    const voco = idOf(await startSet(), VOCO);
    await server.inject({ method: "PUT", url: `/venues/${VENUE}/competitor-watch/${voco}/page-check`, headers: asManager, payload: { termsRead: true, robotsRead: true } });
    const moved = await server.inject({
      method: "PATCH", url: `/venues/${VENUE}/competitor-watch/${voco}`, headers: asManager,
      payload: { pricePageUrl: "https://grandcentral.vocohotels.com/weddings/" },
    });
    expect(moved.json<{ data: { checkReset: boolean } }>().data.checkReset).toBe(true);
    expect((await watch()).competitors.find((entry) => entry.id === voco)?.pageCheck.allowedAt).toBeNull();
  });

  it("never sets an old page's answer on an address changed while it was read", async () => {
    const voco = idOf(await startSet(), VOCO);
    await server.inject({ method: "PUT", url: `/venues/${VENUE}/competitor-watch/${voco}/page-check`, headers: asManager, payload: { termsRead: true, robotsRead: true } });
    const newPage = "https://grandcentral.vocohotels.com/weddings/";
    // The office changes the address while the old page is being read.
    const racing: PageFetcher = {
      async get(url: URL): Promise<FetchAnswer> {
        if (url.href === VOCO_PAGE) {
          const moved = await server.inject({
            method: "PATCH", url: `/venues/${VENUE}/competitor-watch/${voco}`, headers: asManager, payload: { pricePageUrl: newPage },
          });
          expect(moved.statusCode).toBe(200);
          return { kind: "response", status: 200, body: PACKAGES("£130"), location: null };
        }
        return { kind: "response", status: 200, body: "User-agent: *\nAllow: /", location: null };
      },
    };
    const run = await runPageChecks(db, { venueId: VENUE, now: new Date(), fetcher: racing, runBy: "person", triggeredBy: MANAGER });
    expect(run.results.find((result) => result.competitorId === voco)?.outcome).toBe("first_seen");

    const [row] = (await pool.query<Record<string, unknown>>(
      "SELECT price_page_url, checks_allowed_at, page_hash, page_checked_at, page_check_outcome FROM competitor_venues WHERE id = $1", [voco],
    )).rows;
    expect(row).toEqual({ price_page_url: newPage, checks_allowed_at: null, page_hash: null, page_checked_at: null, page_check_outcome: null });
    // The read itself is still logged, against the address it read.
    expect((await pool.query("SELECT url, content_hash FROM competitor_page_checks WHERE competitor_id = $1", [voco])).rows)
      .toEqual([{ url: VOCO_PAGE, content_hash: pageTextHash(PACKAGES("£130")) }]);
  });

  it("runs the unattended pass only for its own token", async () => {
    const voco = idOf(await startSet(), VOCO);
    await server.inject({ method: "PUT", url: `/venues/${VENUE}/competitor-watch/${voco}/page-check`, headers: asManager, payload: { termsRead: true, robotsRead: true } });
    network.answers = {
      "https://grandcentral.vocohotels.com/robots.txt": { kind: "response", status: 404, body: "", location: null },
      [VOCO_PAGE]: { kind: "response", status: 200, body: PACKAGES("£130"), location: null },
    };
    process.env["COMPETITOR_WATCH_CRON_TOKEN"] = CRON_TOKEN;
    process.env["DIARY_CRON_TOKEN"] = `${CRON_TOKEN}-diary`;
    try {
      const wrongToken = await server.inject({ method: "POST", url: "/admin/competitor-watch/page-checks", headers: { authorization: `Bearer ${CRON_TOKEN}-diary` } });
      expect(wrongToken.statusCode).not.toBe(200);
      expect(network.asked).toEqual([]);
      const venueAdmin = await server.inject({ method: "POST", url: "/admin/competitor-watch/page-checks", headers: asAdmin });
      expect(venueAdmin.statusCode).toBe(403);
      const res = await server.inject({ method: "POST", url: "/admin/competitor-watch/page-checks", headers: { authorization: `Bearer ${CRON_TOKEN}` } });
      expect(res.statusCode).toBe(200);
      const data = res.json<{ data: Record<string, unknown> }>().data;
      expect(data).toEqual({ checkedAt: expect.any(String) as string, pages: 1, outcomes: { first_seen: 1 } });
      expect(JSON.stringify(data)).not.toContain(voco);
    } finally {
      delete process.env["COMPETITOR_WATCH_CRON_TOKEN"];
      delete process.env["DIARY_CRON_TOKEN"];
    }
  });
});
