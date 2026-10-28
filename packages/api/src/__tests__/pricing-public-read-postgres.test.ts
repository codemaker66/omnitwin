import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRADES_HALL_ENQUIRY_VENUE_SLUG } from "@omnitwin/types";
import { validateEnv } from "../env.js";
import { extractRoutes } from "../test-support/route-tree.js";

// ---------------------------------------------------------------------------
// A price is the venue's own (Blake, 17 October 2026; PR #117): the price
// list, a single rate, its history, the estimate, the Pricing desk and an
// enquiry's quote are read by the venue's commercial team alone, and a
// visitor is asked to enquire, never shown a price. The agreed rule is that
// no public route lets a dated or venue-internal rate out.
//
// pricing-rules-read-guard.test.ts pins the gates with a mocked database.
// This suite proves the rule at the boundary that owns it: the whole API as
// production assembles it (buildServer), on a migrated database holding a
// dated rate (as a Pricing desk suggestion saves one), a standing rate with
// no dates, a switched-off rate and a deleted one, each carrying a marker.
// Signed out, every price read answers 401; signed in from outside the
// venue's commercial team, 403; and every GET route in the API, asked with
// the fixture's ids in its parameters, and the public MCP's tools, answer
// without one marker. The venue's own sales reading the list is the control:
// the markers are there to be found.
//
// Opt-in, disposable loopback PostgreSQL only; never reads DATABASE_URL/.env:
//   VENVIEWER_PRICING_GUARD_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/venviewer_pricing_guard_test
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const testUrl = process.env["VENVIEWER_PRICING_GUARD_TEST_DATABASE_URL"];

function assertTestTarget(raw: string): void {
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_pricing_guard_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Pricing guard tests require the explicit loopback venviewer_pricing_guard_test database");
  }
}

describe("pricing guard PostgreSQL target guard", () => {
  it.each([
    "postgresql://user@production.example/venviewer_pricing_guard_test",
    "postgresql://postgres@127.0.0.1/production",
    "postgresql://postgres@127.0.0.1/venviewer_pricing_guard_test?host=production.example",
  ])("rejects an unsafe target: %s", (url) => {
    expect(() => { assertTestTarget(url); }).toThrow();
  });
});

/** GET routes that hold their answer open (an event stream) rather than end it. */
const STREAMING = new Set(["GET /mcp"]);

describe.skipIf(testUrl === undefined)("no public read lets a price out (whole API, migrated PostgreSQL)", () => {
  const run = randomUUID().slice(0, 8);
  const marker = `PRICEGUARD${run}`;
  const venue = randomUUID();
  const otherVenue = randomUUID();
  const hall = randomUUID();
  const enquiry = randomUUID();
  const rules = { dated: randomUUID(), standing: randomUUID(), off: randomUUID(), deleted: randomUUID() } as const;
  /** Amounts no other fixture holds, each as a body might write it. */
  const AMOUNTS = [/(?<![\d.])3,?157\.43(?!\d)/u, /(?<![\d.])2,?813\.29(?!\d)/u, /(?<![0-9a-f])315743(?![0-9a-f])/iu, /(?<![0-9a-f])281329(?![0-9a-f])/iu];
  const savedTwinSlugs = process.env["TWIN_PUBLIC_VENUE_SLUGS"];

  let pool: Pool;
  let server: FastifyInstance;

  function as(role: string, venueId: string | null, platformRole = "none"): Record<string, string> {
    return { authorization: `Bearer ${JSON.stringify({ id: randomUUID(), email: `${role}-${run}@example.test`, role, platformRole, venueId })}` };
  }

  /** What in a body would be a rate: its marker, its id, or its amount. An
   *  id the request itself carried (a 404 names the path it was asked) is
   *  not the rate; its name and amount would still be found. */
  function leaks(body: string, askedUrl = ""): string[] {
    const found: string[] = [];
    if (body.includes(marker)) found.push("a rate's name");
    for (const [name, id] of Object.entries(rules)) if (body.includes(id) && !askedUrl.includes(id)) found.push(`the ${name} rate's id`);
    for (const amount of AMOUNTS) if (amount.test(body)) found.push(`an amount (${amount.source})`);
    return found;
  }

  beforeAll(async () => {
    if (testUrl === undefined) throw new Error("Explicit test URL required");
    assertTestTarget(testUrl);
    process.env["TWIN_PUBLIC_VENUE_SLUGS"] = TRADES_HALL_ENQUIRY_VENUE_SLUG;
    pool = new Pool({ connectionString: testUrl, application_name: `pricing_guard_${run}`, max: 8 });
    const target = await pool.query<{ database: string }>("SELECT current_database() AS database");
    expect(target.rows[0]?.database).toBe("venviewer_pricing_guard_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });

    // The public routes resolve Trades Hall by its database slug, so the
    // fixture venue takes it; a rerun moves the last run's venue aside first.
    await pool.query("UPDATE venues SET slug = slug || '-old-' || left(id::text, 8) WHERE slug = $1", [TRADES_HALL_ENQUIRY_VENUE_SLUG]);
    await pool.query(
      `INSERT INTO venues (id, name, slug, address, timezone) VALUES
         ($1, 'TEST ONLY Trades Hall', $2, 'Disposable fixture', 'Europe/London'),
         ($3, 'TEST ONLY elsewhere', $4, 'Disposable fixture', 'Europe/London')`,
      [venue, TRADES_HALL_ENQUIRY_VENUE_SLUG, otherVenue, `priceguard-other-${run}`],
    );
    await pool.query(
      `INSERT INTO spaces (id, venue_id, name, slug, sort_order, width_m, length_m, height_m, floor_plan_outline)
       VALUES ($1, $2, 'Grand Hall', 'grand-hall', 0, '21.00', '10.50', '7.00', '[{"x":0,"y":0},{"x":21,"y":0},{"x":21,"y":10.5},{"x":0,"y":10.5}]')`,
      [hall, venue],
    );
    const rate = (id: string, name: string, amount: string, extra: { validFrom?: string; validTo?: string; isActive?: boolean; deleted?: boolean } = {}) => pool.query(
      `INSERT INTO pricing_rules (id, venue_id, space_id, name, type, amount, currency, valid_from, valid_to, is_active, applies_from, applies_until, deleted_at)
       VALUES ($1, $2, $3, $4, 'flat_rate', $5, 'GBP', $6, $7, $8, '19:00', '00:30', $9)`,
      [id, venue, hall, name, amount, extra.validFrom ?? null, extra.validTo ?? null, extra.isActive ?? true, extra.deleted === true ? new Date() : null],
    );
    // As the Pricing desk saves a suggestion: one raised Saturday.
    await rate(rules.dated, `Grand Hall evening, Saturday 12 June 2027 ${marker}`, "3157.43", { validFrom: "2027-06-12", validTo: "2027-06-12" });
    await rate(rules.standing, `Grand Hall evening ${marker}`, "2813.29");
    await rate(rules.off, `Grand Hall evening, retired ${marker}`, "3157.43", { isActive: false });
    await rate(rules.deleted, `Grand Hall evening, deleted ${marker}`, "2813.29", { deleted: true });
    await pool.query(
      `INSERT INTO enquiries (id, venue_id, space_id, state, name, email, preferred_date, estimated_guests, source)
       VALUES ($1, $2, $3, 'submitted', 'Fixture guest', 'guest@example.test', '2027-06-12', 120, 'website')`,
      [enquiry, venue, hall],
    );

    const { buildServer } = await import("../index.js");
    server = await buildServer(validateEnv({
      NODE_ENV: "test",
      DATABASE_URL: testUrl,
      JWT_SECRET: "test-jwt-secret-that-is-at-least-32-characters-long",
    }));
    await server.ready();
  }, 300_000);

  afterAll(async () => {
    if (savedTwinSlugs === undefined) delete process.env["TWIN_PUBLIC_VENUE_SLUGS"];
    else process.env["TWIN_PUBLIC_VENUE_SLUGS"] = savedTwinSlugs;
    await server?.close();
    await pool?.end();
  }, 60_000);

  /** Every route that reads a rate, with the fixture's ids. */
  const priceReads = (): readonly { readonly method: "GET" | "POST"; readonly url: string; readonly payload?: Record<string, unknown> }[] => [
    { method: "GET", url: `/venues/${venue}/pricing` },
    { method: "GET", url: `/venues/${venue}/pricing/${rules.dated}` },
    { method: "GET", url: `/venues/${venue}/pricing/${rules.standing}` },
    { method: "GET", url: `/venues/${venue}/pricing/${rules.dated}/history` },
    { method: "POST", url: `/venues/${venue}/pricing/estimate`, payload: { spaceId: hall, eventDate: "2027-06-12", startTime: "19:00", endTime: "23:00", guestCount: 120 } },
    { method: "GET", url: `/venues/${venue}/pricing-desk` },
    { method: "GET", url: `/venues/${venue}/pricing-desk/advice` },
    { method: "GET", url: `/venues/${venue}/proposal-templates` },
    { method: "GET", url: `/venues/${venue}/competitor-watch` },
    { method: "GET", url: `/enquiries/${enquiry}/quote` },
    { method: "GET", url: "/quotes" },
  ];

  function ask(read: ReturnType<typeof priceReads>[number], headers?: Record<string, string>): Promise<LightMyRequestResponse> {
    return server.inject({ method: read.method, url: read.url, ...(read.payload === undefined ? {} : { payload: read.payload }), ...(headers === undefined ? {} : { headers }) });
  }

  it("lets the venue's own sales read both rates: the markers are there to be found", async () => {
    const res = await ask({ method: "GET", url: `/venues/${venue}/pricing` }, as("sales", venue));
    expect(res.statusCode).toBe(200);
    expect(leaks(res.body)).toEqual(expect.arrayContaining(["a rate's name", "the dated rate's id", "the standing rate's id"]));
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("asks a signed-out reader who they are on every price read, and says nothing of a rate", async () => {
    for (const read of priceReads()) {
      const res = await ask(read);
      expect(res.statusCode, `${read.method} ${read.url}`).toBe(401);
      expect(leaks(res.body), `${read.method} ${read.url}`).toEqual([]);
    }
  });

  it("refuses everyone outside the venue's commercial team, and says nothing of a rate", async () => {
    const outsiders = [
      as("client", null), as("planner", null), as("client", venue), as("hallkeeper", venue), as("caterer", venue),
      as("staff", otherVenue), as("manager", otherVenue), as("sales", otherVenue),
    ];
    for (const headers of outsiders) {
      for (const read of priceReads()) {
        const res = await ask(read, headers);
        // A list scoped to the reader (quotes) answers 200 with none of this venue's.
        expect([200, 403, 404], `${read.method} ${read.url}`).toContain(res.statusCode);
        expect(leaks(res.body), `${read.method} ${read.url} as ${headers["authorization"] ?? ""}`).toEqual([]);
      }
    }
  }, 120_000);

  it("lets no GET route in the API answer a signed-out reader with a rate, whatever ids it is given", async () => {
    const routes = [...extractRoutes(server.printRoutes({ commonPrefix: false }))]
      .filter((route) => route.startsWith("GET ") && !STREAMING.has(route));
    expect(routes.length).toBeGreaterThan(100);
    const candidates = [venue, hall, enquiry, rules.dated, rules.standing, TRADES_HALL_ENQUIRY_VENUE_SLUG, "grand-hall"];
    const found: string[] = [];
    const limited: string[] = [];
    const answered = new Map<string, number>();
    let asked = 0;
    for (const route of routes) {
      const path = route.slice(4);
      // One parameter can print under two names (":id|:venueId").
      const param = /:[A-Za-z0-9_]+(?:\|:[A-Za-z0-9_]+)*|\*/gu;
      const fills = path.match(param) === null ? [path] : candidates.map((value) => path.replace(param, value));
      for (const url of fills) {
        // Each request from its own address: the shared limiter would
        // otherwise answer most of the sweep with 429 and prove nothing.
        const res = await server.inject({ method: "GET", url, remoteAddress: `10.${String((asked >> 16) & 255)}.${String((asked >> 8) & 255)}.${String(asked & 255)}` });
        asked += 1;
        answered.set(url, res.statusCode);
        if (res.statusCode === 429) limited.push(url);
        const leaked = leaks(res.body, url);
        if (leaked.length > 0) found.push(`GET ${url} (${String(res.statusCode)}): ${leaked.join(", ")}`);
      }
    }
    expect(asked).toBeGreaterThan(routes.length);
    expect(limited).toEqual([]);
    // The sweep reached the price list itself, and was asked who it is.
    expect(answered.get(`/venues/${venue}/pricing`)).toBe(401);
    expect(found).toEqual([]);
  }, 240_000);

  it("lets the public MCP's tools name no rate", async () => {
    const mcp = (body: object): Promise<LightMyRequestResponse> => server.inject({
      method: "POST", url: "/mcp",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      payload: body,
    });
    const initialize = await mcp({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "price-guard", version: "1" } },
    });
    expect(initialize.statusCode).toBe(200);
    const calls = [
      { name: "get_venue", arguments: { venue: TRADES_HALL_ENQUIRY_VENUE_SLUG } },
      { name: "how_to_enquire", arguments: { venue: TRADES_HALL_ENQUIRY_VENUE_SLUG } },
    ];
    for (const [index, params] of calls.entries()) {
      const res = await mcp({ jsonrpc: "2.0", id: index + 2, method: "tools/call", params });
      expect(res.statusCode, params.name).toBe(200);
      // A real answer about the venue, not a refusal.
      expect(res.body, params.name).toContain("Trades Hall");
      expect(res.body, params.name).not.toContain("\"isError\":true");
      expect(leaks(res.body), params.name).toEqual([]);
    }
    const listed = await mcp({ jsonrpc: "2.0", id: 9, method: "tools/list" });
    expect(leaks(listed.body)).toEqual([]);
  });
});
