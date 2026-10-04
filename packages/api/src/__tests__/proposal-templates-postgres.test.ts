import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProposalEventSchema, ProposalTemplateSchema, type ProposalEvent, type ProposalTemplate } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { proposalTemplateRoutes } from "../routes/proposal-templates.js";
import { proposalRoutes } from "../routes/proposals.js";

// ---------------------------------------------------------------------------
// Proposal templates by room and occasion (T-635, roadmap X1; Tier B #16),
// against a real database: who may read and keep them, a template held to
// its own venue's rooms and price list, one live template per name whatever
// its case, a replace made from a stale copy refused rather than written
// over, a removal that can be undone unless the name is taken since, and the
// event a proposal is for, read before any version exists without writing.
//
// The templates table is made by the real migration 0085, so its checks,
// its live-name index and the room's composite key are the production ones.
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
    throw new Error("Proposal template route tests require their explicit isolated loopback database");
  }
}

const MIGRATION = fileURLToPath(new URL("../../drizzle/0085_proposal_templates.sql", import.meta.url));

const VENUE = "81111111-1111-4111-8111-111111111111";
const OTHER_VENUE = "82222222-2222-4222-8222-222222222222";
const HALL = "83333333-3333-4333-8333-333333333333";
const SALOON = "84444444-4444-4444-8444-444444444444";
const FOREIGN_ROOM = "85555555-5555-4555-8555-555555555555";
const REMOVED_ROOM = "86666666-6666-4666-8666-666666666666";

// The price list: a room's hire for each of two rooms, two venue-wide
// entries, and entries the venue cannot use: another venue's, a removed one
// and one switched off.
const HALL_HIRE = "87777777-7777-4777-8777-000000000001";
const SALOON_HIRE = "87777777-7777-4777-8777-000000000002";
const DINNER = "87777777-7777-4777-8777-000000000003";
const LATE_BAR = "87777777-7777-4777-8777-000000000004";
const FOREIGN_ENTRY = "87777777-7777-4777-8777-000000000005";
const REMOVED_ENTRY = "87777777-7777-4777-8777-000000000006";
const INACTIVE_ENTRY = "87777777-7777-4777-8777-000000000007";

interface Person { readonly id: string; readonly name: string; readonly role: string; readonly venueId: string | null; readonly platformRole: string }
const person = (n: number, name: string, role: string, venueId: string | null = VENUE, platformRole = "none"): Person =>
  ({ id: `88888888-8888-4888-8888-${String(n).padStart(12, "0")}`, name, role, venueId, platformRole });

const STAFF = person(1, "Anna Reid", "staff");
const SALES = person(2, "Duncan Kerr", "sales");
const MANAGER = person(3, "Morag Bell", "manager");
const ADMIN = person(4, "Iain Fraser", "admin");
const PLATFORM_ADMIN = person(5, "Platform Operator", "client", null, "admin");
const HALLKEEPER = person(6, "Hamish Grant", "hallkeeper");
const PLANNER = person(7, "Fiona Lyle", "planner");
const CLIENT = person(8, "Elaine Crawford", "client");
const OTHER_ADMIN = person(9, "Callum Ross", "admin", OTHER_VENUE);
const PEOPLE = [STAFF, SALES, MANAGER, ADMIN, PLATFORM_ADMIN, HALLKEEPER, PLANNER, CLIENT, OTHER_ADMIN];

function as(who: Person): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({
    id: who.id, email: `${who.role}@example.test`, name: who.name, role: who.role, platformRole: who.platformRole, venueId: who.venueId,
  })}` };
}

type Line = Record<string, unknown>;
const listed = (pricingRuleId: string, name: string, ruleType: string, quantity: number | null = null): Line =>
  ({ kind: "price_list", pricingRuleId, name, ruleType, quantity });
const typed = (description: string, quantity = 1): Line => ({ kind: "typed", description, quantity });

function templateBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Grand Hall wedding",
    spaceId: HALL,
    occasion: "wedding",
    message: "Thank you for thinking of the Grand Hall for your wedding.",
    lines: [
      listed(HALL_HIRE, "Grand Hall — Evening Event", "flat_rate", 1),
      listed(DINNER, "Dinner", "per_head"),
      listed(LATE_BAR, "Late bar", "per_hour", 5),
      typed("Piper"),
    ],
    ...overrides,
  };
}

interface Answer {
  readonly statusCode: number;
  readonly code: string | undefined;
  readonly body: Record<string, unknown>;
  /** The template answered in `data`, or in `details` on a 409. */
  readonly template: ProposalTemplate | undefined;
}

describe.skipIf(testUrl === undefined)("proposal templates on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `proposal_template_routes_${randomUUID().replaceAll("-", "")}`;
  // Built from the Drizzle schema, loose, for the rows the routes read.
  const looseTables: PgTable[] = [schema.venues, schema.users, schema.spaces, schema.pricingRules,
    schema.proposals, schema.enquiries, schema.opportunities, schema.configurations];

  async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, who: Person | null, payload?: Record<string, unknown>): Promise<Answer> {
    const res = await server.inject({
      method, url, ...(who === null ? {} : { headers: as(who) }), ...(payload === undefined ? {} : { payload }),
    });
    const body = res.body === "" ? {} : JSON.parse(res.body) as Record<string, unknown>;
    const carried = res.statusCode === 409 ? body["details"] : body["data"];
    const template = carried === undefined || Array.isArray(carried) ? undefined : ProposalTemplateSchema.parse(carried);
    return { statusCode: res.statusCode, code: body["code"] as string | undefined, body, template };
  }

  const at = (venueId = VENUE, id?: string, restore = false): string =>
    `/venues/${venueId}/proposal-templates${id === undefined ? "" : `/${id}`}${restore ? "/restore" : ""}`;

  const create = (body: Record<string, unknown> = templateBody(), who: Person = STAFF, venueId = VENUE): Promise<Answer> =>
    call("POST", at(venueId), who, body);
  const replace = (id: string, body: Record<string, unknown>, who: Person = STAFF, venueId = VENUE): Promise<Answer> =>
    call("PATCH", at(venueId, id), who, body);
  const remove = (id: string, who: Person = STAFF, venueId = VENUE): Promise<Answer> => call("DELETE", at(venueId, id), who);
  const restore = (id: string, who: Person = STAFF, venueId = VENUE): Promise<Answer> => call("POST", at(venueId, id, true), who);

  async function list(who: Person = STAFF, venueId = VENUE): Promise<ProposalTemplate[]> {
    const res = await server.inject({ method: "GET", url: at(venueId), headers: as(who) });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { data: unknown[] }).data.map((row) => ProposalTemplateSchema.parse(row));
  }

  async function made(body: Record<string, unknown> = templateBody(), who: Person = STAFF, venueId = VENUE): Promise<ProposalTemplate> {
    const answer = await create(body, who, venueId);
    expect(answer.statusCode, JSON.stringify(answer.body)).toBe(201);
    if (answer.template === undefined) throw new Error("expected the created template");
    return answer.template;
  }

  interface StoredTemplate { readonly id: string; readonly venue_id: string; readonly name: string; readonly message: string; readonly removed: boolean }

  /** Every stored template, removed ones included, as the database holds it. */
  async function stored(): Promise<StoredTemplate[]> {
    return (await pool.query<StoredTemplate>(
      "SELECT id, venue_id, name, message, deleted_at IS NOT NULL AS removed FROM proposal_templates ORDER BY created_at, name",
    )).rows;
  }

  async function waitForBlockedQueries(count: number): Promise<void> {
    await expect.poll(async () => Number((await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
      [fixtureSchema],
    )).rows[0]?.count), { timeout: 5000 }).toBe(count);
  }

  /** Holds what `hold` takes in an open transaction while `requests` are
   *  made, waits until `blocked` of them wait on it, then ends it and
   *  answers what they answered. */
  async function whileHeld<T>(
    hold: (client: PoolClient) => Promise<unknown>,
    requests: () => Promise<T>,
    blocked: number,
    end: "COMMIT" | "ROLLBACK" = "COMMIT",
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await hold(client);
      const pending = requests();
      await waitForBlockedQueries(blocked);
      await client.query(end);
      return await pending;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 6, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    // Columns derive from the real Drizzle schema; no production migration or
    // data is touched.
    for (const table of looseTables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => {
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "updated_at") defaultSql = " default now()";
        else if (column.name === "is_active") defaultSql = " not null default true";
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    // The room's composite identity the templates' key relies on (0050).
    await pool.query("ALTER TABLE spaces ADD CONSTRAINT spaces_id_venue_unique UNIQUE (id, venue_id)");

    // The real migration, in one transaction as Deploy runs it.
    const migration = await readFile(MIGRATION, "utf8");
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

    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(proposalTemplateRoutes, { db, prefix: "/venues/:venueId/proposal-templates" });
    await server.register(proposalRoutes, { db, prefix: "/proposals" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query(`TRUNCATE proposal_templates, ${looseTables.map((table) => `"${getTableConfig(table).name}"`).join(", ")}`);
    await pool.query(
      "INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Trades Hall Glasgow', 'trades-hall-glasgow', '85 Glassford Street'), ($2, 'Elsewhere', 'elsewhere', '1 Road')",
      [VENUE, OTHER_VENUE],
    );
    await pool.query(
      `INSERT INTO spaces (id, venue_id, name, slug, sort_order, deleted_at) VALUES
        ($1, $5, 'Grand Hall', 'grand-hall', 0, NULL), ($2, $5, 'Saloon', 'saloon', 1, NULL),
        ($3, $6, 'Their Hall', 'their-hall', 0, NULL), ($4, $5, 'Old Library', 'old-library', 2, now())`,
      [HALL, SALOON, FOREIGN_ROOM, REMOVED_ROOM, VENUE, OTHER_VENUE],
    );
    for (const who of PEOPLE) {
      await pool.query("INSERT INTO users (id, email, name, role, platform_role, venue_id) VALUES ($1, $2, $3, $4, $5, $6)",
        [who.id, `${who.id}@example.test`, who.name, who.role, who.platformRole, who.venueId]);
    }
    await pool.query(
      `INSERT INTO pricing_rules (id, venue_id, space_id, name, type, amount, currency, is_active, deleted_at) VALUES
        ($1, $8, $10, 'Grand Hall — Evening Event', 'flat_rate', 1500, 'GBP', true, NULL),
        ($2, $8, $11, 'Saloon — Evening Event', 'flat_rate', 800, 'GBP', true, NULL),
        ($3, $8, NULL, 'Dinner', 'per_head', 65, 'GBP', true, NULL),
        ($4, $8, NULL, 'Late bar', 'per_hour', 150, 'GBP', true, NULL),
        ($5, $9, NULL, 'Late bar', 'per_hour', 150, 'GBP', true, NULL),
        ($6, $8, NULL, 'Late bar', 'per_hour', 150, 'GBP', true, now()),
        ($7, $8, NULL, 'Late bar', 'per_hour', 150, 'GBP', false, NULL)`,
      [HALL_HIRE, SALOON_HIRE, DINNER, LATE_BAR, FOREIGN_ENTRY, REMOVED_ENTRY, INACTIVE_ENTRY, VENUE, OTHER_VENUE, HALL, SALOON],
    );
  }, 60_000);

  afterAll(async () => {
    if (server !== undefined) await server.close();
    if (pool !== undefined) {
      // Only the random schema created by this invocation is removed.
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // Who may read and keep them
  // -------------------------------------------------------------------------

  describe("who may read and keep templates", () => {
    it.each([
      ["sales", SALES], ["staff", STAFF], ["a manager", MANAGER], ["an admin", ADMIN], ["a platform admin", PLATFORM_ADMIN],
    ] as const)("lets %s list, keep, replace, remove and bring back a template", async (_, who) => {
      const kept = await made(templateBody({ name: `${who.name} wedding` }), who);
      expect(kept.updatedByName).toBe(who.name);
      expect((await list(who)).map((template) => template.id)).toEqual([kept.id]);

      const replaced = await replace(kept.id, { ...templateBody({ name: `${who.name} wedding`, message: "Updated." }), expectedUpdatedAt: kept.updatedAt }, who);
      expect(replaced.statusCode, JSON.stringify(replaced.body)).toBe(200);
      expect(replaced.template?.message).toBe("Updated.");

      expect((await remove(kept.id, who)).statusCode).toBe(204);
      const back = await restore(kept.id, who);
      expect(back.statusCode, JSON.stringify(back.body)).toBe(200);
      expect(back.template?.id).toBe(kept.id);
    });

    it.each([
      ["a hallkeeper", HALLKEEPER], ["a planner", PLANNER], ["a client", CLIENT], ["another venue's admin", OTHER_ADMIN],
    ] as const)("refuses %s everything, and changes nothing", async (_, who) => {
      const live = await made();
      const gone = await made(templateBody({ name: "Saloon dinner", spaceId: SALOON, lines: [typed("Piper")] }));
      expect((await remove(gone.id)).statusCode).toBe(204);
      const before = await stored();

      expect((await call("GET", at(), who)).statusCode).toBe(403);
      expect((await create(templateBody({ name: "Theirs" }), who)).statusCode).toBe(403);
      expect((await replace(live.id, { ...templateBody({ message: "Mine now." }), expectedUpdatedAt: live.updatedAt }, who)).statusCode).toBe(403);
      expect((await remove(live.id, who)).statusCode).toBe(403);
      expect((await restore(gone.id, who)).statusCode).toBe(403);
      expect(await stored()).toEqual(before);
    });

    it("asks for sign-in, and says when there is no such venue", async () => {
      expect((await call("GET", at(), null)).statusCode).toBe(401);
      expect((await call("POST", at(), null, templateBody())).statusCode).toBe(401);
      const nowhere = randomUUID();
      expect((await call("GET", at(nowhere), PLATFORM_ADMIN)).statusCode).toBe(404);
      expect((await create(templateBody({ spaceId: null, lines: [typed("Piper")] }), PLATFORM_ADMIN, nowhere)).statusCode).toBe(404);
      expect((await call("GET", "/venues/not-a-venue/proposal-templates", STAFF)).statusCode).toBe(400);
      expect((await call("DELETE", at(VENUE, "not-a-template"), STAFF)).statusCode).toBe(400);
      expect(await stored()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // A template belongs to its venue
  // -------------------------------------------------------------------------

  describe("a template held to its own venue", () => {
    it("keeps a template for a room of this venue only, and not for a room no longer listed", async () => {
      for (const room of [FOREIGN_ROOM, REMOVED_ROOM, randomUUID()]) {
        const refused = await create(templateBody({ spaceId: room, lines: [typed("Piper")] }));
        expect(refused.statusCode, room).toBe(422);
        expect(refused.code).toBe("ROOM_NOT_AT_VENUE");
      }
      const kept = await made(templateBody({ lines: [typed("Piper")] }));
      const moved = await replace(kept.id, { ...templateBody({ spaceId: FOREIGN_ROOM, lines: [typed("Piper")] }), expectedUpdatedAt: kept.updatedAt });
      expect(moved.statusCode).toBe(422);
      expect(moved.code).toBe("ROOM_NOT_AT_VENUE");
      expect((await stored()).map((row) => row.id)).toEqual([kept.id]);
    });

    it("answers another venue's price entry, a removed one, one switched off and an unknown one alike", async () => {
      const answers: Record<string, unknown>[] = [];
      for (const entry of [FOREIGN_ENTRY, REMOVED_ENTRY, INACTIVE_ENTRY, randomUUID()]) {
        const refused = await create(templateBody({ spaceId: null, lines: [listed(entry, "Late bar", "per_hour", 5)] }));
        expect(refused.statusCode, entry).toBe(422);
        answers.push(refused.body);
      }
      expect(answers[0]).toEqual({
        error: "A price-list entry is not on this venue's price list", code: "PRICE_ENTRY_NOT_AT_VENUE", details: { names: ["Late bar"] },
      });
      for (const answer of answers) expect(answer).toEqual(answers[0]);

      // Replacing is held to the same list.
      const kept = await made(templateBody({ spaceId: null, lines: [listed(LATE_BAR, "Late bar", "per_hour", 5)] }));
      const swapped = await replace(kept.id, {
        ...templateBody({ spaceId: null, lines: [listed(FOREIGN_ENTRY, "Late bar", "per_hour", 5)] }), expectedUpdatedAt: kept.updatedAt,
      });
      expect(swapped.body).toEqual(answers[0]);
      expect((await stored()).map((row) => row.id)).toEqual([kept.id]);
    });

    it("never lists one venue's templates to another", async () => {
      const ours = await made();
      const theirs = await made(templateBody({ spaceId: null, lines: [typed("Piper")] }), OTHER_ADMIN, OTHER_VENUE);
      expect((await list(STAFF)).map((template) => template.id)).toEqual([ours.id]);
      expect((await list(OTHER_ADMIN, OTHER_VENUE)).map((template) => template.id)).toEqual([theirs.id]);
      // A platform admin reads each venue's own under its own path.
      expect((await list(PLATFORM_ADMIN, OTHER_VENUE)).map((template) => template.id)).toEqual([theirs.id]);
    });

    it("does not reach one venue's template through another venue's path", async () => {
      const ours = await made();
      const body = { ...templateBody({ spaceId: null, lines: [typed("Piper")], message: "Theirs now." }), expectedUpdatedAt: ours.updatedAt };
      const through = await replace(ours.id, body, OTHER_ADMIN, OTHER_VENUE);
      expect(through.statusCode).toBe(404);
      expect(through.code).toBe("NOT_FOUND");
      expect((await remove(ours.id, OTHER_ADMIN, OTHER_VENUE)).statusCode).toBe(404);
      expect((await remove(ours.id)).statusCode).toBe(204);
      expect((await restore(ours.id, OTHER_ADMIN, OTHER_VENUE)).statusCode).toBe(404);
      expect(await stored()).toEqual([{ id: ours.id, venue_id: VENUE, name: "Grand Hall wedding", message: ours.message, removed: true }]);
    });

    it("refuses at the database a template filed under another venue's room", async () => {
      await expect(pool.query(
        "INSERT INTO proposal_templates (venue_id, space_id, name, message) VALUES ($1, $2, 'Stray', 'Hello')",
        [VENUE, FOREIGN_ROOM],
      )).rejects.toMatchObject({ code: "23503" });
    });
  });

  // -------------------------------------------------------------------------
  // What the price-list lines may be
  // -------------------------------------------------------------------------

  describe("price-list lines", () => {
    it("refuses an entry now priced differently from how it was saved", async () => {
      const refused = await create(templateBody({ lines: [listed(LATE_BAR, "Late bar", "flat_rate", 5), listed(DINNER, "Dinner", "per_head")] }));
      expect(refused.statusCode).toBe(422);
      expect(refused.body).toEqual({ error: "A price-list entry is priced differently now", code: "PRICE_ENTRY_CHANGED", details: { names: ["Late bar"] } });
      expect(await stored()).toEqual([]);
    });

    it("keeps a room's price only in a template for a room, though not only that room's", async () => {
      const anyRoom = await create(templateBody({ spaceId: null }));
      expect(anyRoom.statusCode).toBe(422);
      expect(anyRoom.body).toEqual({
        error: "A room's price needs a template for a room", code: "ROOM_PRICE_NEEDS_ROOM", details: { names: ["Grand Hall — Evening Event"] },
      });
      // Venue-wide entries are fine in an any-room template.
      await made(templateBody({ name: "Any room dinner", spaceId: null, lines: [listed(DINNER, "Dinner", "per_head"), listed(LATE_BAR, "Late bar", "per_hour", 5)] }));
      // A Saloon template may hold the Grand Hall's hire: a package of two rooms.
      const twoRooms = await made(templateBody({ name: "Saloon and Grand Hall", spaceId: SALOON,
        lines: [listed(SALOON_HIRE, "Saloon — Evening Event", "flat_rate", 1), listed(HALL_HIRE, "Grand Hall — Evening Event", "flat_rate", 1)] }));
      expect(twoRooms.lines.map((line) => (line.kind === "price_list" ? line.pricingRuleId : null))).toEqual([SALOON_HIRE, HALL_HIRE]);

      // Nor may a room template be made any-room while it holds one.
      const widened = await replace(twoRooms.id, {
        ...templateBody({ name: "Saloon and Grand Hall", spaceId: null, lines: twoRooms.lines }), expectedUpdatedAt: twoRooms.updatedAt,
      });
      expect(widened.statusCode).toBe(422);
      expect(widened.code).toBe("ROOM_PRICE_NEEDS_ROOM");
    });
  });

  // -------------------------------------------------------------------------
  // Names
  // -------------------------------------------------------------------------

  describe("names", () => {
    it("allows one live template per name whatever its case, and shows the one that has it", async () => {
      const first = await made();
      const again = await create(templateBody({ name: "GRAND HALL WEDDING", message: "Another." }), SALES);
      expect(again.statusCode).toBe(409);
      expect(again.code).toBe("NAME_TAKEN");
      expect(again.template).toEqual(first);
      expect(again.template?.updatedByName).toBe("Anna Reid");

      // Renaming another template onto it is refused alike.
      const other = await made(templateBody({ name: "Saloon dinner", spaceId: SALOON, lines: [typed("Piper")] }));
      const renamed = await replace(other.id, { ...templateBody({ name: "grand hall wedding", spaceId: SALOON, lines: [typed("Piper")] }), expectedUpdatedAt: other.updatedAt });
      expect(renamed.statusCode).toBe(409);
      expect(renamed.code).toBe("NAME_TAKEN");
      expect(renamed.template?.id).toBe(first.id);
      expect((await stored()).map((row) => [row.name, row.message])).toEqual([
        ["Grand Hall wedding", first.message], ["Saloon dinner", other.message],
      ]);

      // Another venue may use the same name.
      await made(templateBody({ spaceId: null, lines: [typed("Piper")] }), OTHER_ADMIN, OTHER_VENUE);
    });

    it("frees the name once removed, and brings the removed one back only while the name is free", async () => {
      const first = await made();
      expect((await remove(first.id)).statusCode).toBe(204);
      const second = await made(templateBody({ name: "Grand Hall Wedding", message: "The new one." }));

      const refused = await restore(first.id);
      expect(refused.statusCode).toBe(409);
      expect(refused.code).toBe("NAME_TAKEN");
      expect(refused.template?.id).toBe(second.id);
      expect((await stored()).map((row) => [row.id, row.removed])).toEqual([[first.id, true], [second.id, false]]);

      // Once the new one goes, the first comes back as it was: still saved by
      // who saved it, when they did, not by who brought it back.
      expect((await remove(second.id)).statusCode).toBe(204);
      const back = await restore(first.id, MANAGER);
      expect(back.statusCode).toBe(200);
      expect(back.template).toMatchObject({
        id: first.id, name: "Grand Hall wedding", message: first.message, lines: first.lines,
        updatedByName: STAFF.name, updatedAt: first.updatedAt,
      });
      // Read by an earlier list, it is replaced as it stands.
      const replaced = await replace(first.id, { ...templateBody({ message: "Changed after it came back." }), expectedUpdatedAt: first.updatedAt });
      expect(replaced.statusCode, JSON.stringify(replaced.body)).toBe(200);
      // A live template is not brought back again.
      expect((await restore(first.id)).statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Changes that land at once
  // -------------------------------------------------------------------------

  describe("changes that land at once", () => {
    it("replaces a template for one of two people who read it at the same moment, and shows the other what it says now", async () => {
      const kept = await made();
      const answers = await whileHeld(
        (client) => client.query("SELECT id FROM proposal_templates WHERE id = $1 FOR UPDATE", [kept.id]),
        () => Promise.all([
          replace(kept.id, { ...templateBody({ message: "Anna's words." }), expectedUpdatedAt: kept.updatedAt }, STAFF),
          replace(kept.id, { ...templateBody({ message: "Duncan's words." }), expectedUpdatedAt: kept.updatedAt }, SALES),
        ]),
        2,
      );
      expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 409]);
      const won = answers.find((answer) => answer.statusCode === 200);
      const lost = answers.find((answer) => answer.statusCode === 409);
      expect(lost?.code).toBe("TEMPLATE_CHANGED");
      expect(lost?.template).toEqual(won?.template);
      expect((await stored())[0]?.message).toBe(won?.template?.message);
    });

    it("refuses a replace made from a copy read before the last change", async () => {
      const kept = await made();
      const fresh = await replace(kept.id, { ...templateBody({ message: "Newer." }), expectedUpdatedAt: kept.updatedAt });
      expect(fresh.statusCode).toBe(200);
      const stale = await replace(kept.id, { ...templateBody({ message: "Older." }), expectedUpdatedAt: kept.updatedAt }, SALES);
      expect(stale.statusCode).toBe(409);
      expect(stale.code).toBe("TEMPLATE_CHANGED");
      expect(stale.template?.message).toBe("Newer.");
      expect(stale.template?.updatedByName).toBe("Anna Reid");
    });

    it("never replaces a removed template, even one removed while the replace waits", async () => {
      const kept = await made();
      const waiting = await whileHeld(
        (client) => client.query("UPDATE proposal_templates SET deleted_at = now(), deleted_by = $2 WHERE id = $1", [kept.id, SALES.id]),
        () => replace(kept.id, { ...templateBody({ message: "Too late." }), expectedUpdatedAt: kept.updatedAt }),
        1,
      );
      expect(waiting.statusCode).toBe(404);
      expect(await stored()).toEqual([{ id: kept.id, venue_id: VENUE, name: kept.name, message: kept.message, removed: true }]);

      const after = await replace(kept.id, { ...templateBody({ message: "Later still." }), expectedUpdatedAt: kept.updatedAt });
      expect(after.statusCode).toBe(404);
      expect((await stored())[0]?.message).toBe(kept.message);
    });

    it("keeps one of two templates given the same name at the same moment", async () => {
      // A third save of the name, not yet committed, holds both at the
      // name's index until it gives up.
      const answers = await whileHeld(
        (client) => client.query("INSERT INTO proposal_templates (venue_id, name, message) VALUES ($1, 'Grand Hall wedding', 'Held')", [VENUE]),
        () => Promise.all([create(templateBody({ message: "Anna's." }), STAFF), create(templateBody({ name: "grand hall wedding", message: "Duncan's." }), SALES)]),
        2,
        "ROLLBACK",
      );
      expect(answers.map((answer) => answer.statusCode).sort()).toEqual([201, 409]);
      const won = answers.find((answer) => answer.statusCode === 201);
      const lost = answers.find((answer) => answer.statusCode === 409);
      expect(lost?.code).toBe("NAME_TAKEN");
      expect(lost?.template?.id).toBe(won?.template?.id);
      expect((await stored()).map((row) => row.id)).toEqual([won?.template?.id]);
    });

    it("removes a template once when two people remove it at the same moment", async () => {
      const kept = await made();
      const answers = await whileHeld(
        (client) => client.query("SELECT id FROM proposal_templates WHERE id = $1 FOR UPDATE", [kept.id]),
        () => Promise.all([remove(kept.id, STAFF), remove(kept.id, SALES)]),
        2,
      );
      expect(answers.map((answer) => answer.statusCode).sort()).toEqual([204, 404]);
      expect((await remove(kept.id)).statusCode).toBe(404);
      const removedBy = (await pool.query<{ deleted_by: string }>("SELECT deleted_by FROM proposal_templates WHERE id = $1", [kept.id])).rows[0]?.deleted_by;
      expect(removedBy).toBe(answers[0]?.statusCode === 204 ? STAFF.id : SALES.id);
    });
  });

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  describe("reading templates", () => {
    it("lists templates by name, with their room, and who last saved them", async () => {
      const wedding = await made();
      const dinner = await made(templateBody({ name: "any-room dinner", spaceId: null, occasion: null, lines: [listed(DINNER, "Dinner", "per_head")] }), MANAGER);
      const read = await list();
      expect(read.map((template) => [template.name, template.roomName, template.roomListed, template.updatedByName])).toEqual([
        ["any-room dinner", null, true, "Morag Bell"],
        ["Grand Hall wedding", "Grand Hall", true, "Anna Reid"],
      ]);
      expect(read[1]).toEqual(wedding);
      expect(read[0]?.id).toBe(dinner.id);
      expect(wedding).toMatchObject({
        venueId: VENUE, spaceId: HALL, occasion: "wedding", readable: true,
        lines: [
          { kind: "price_list", pricingRuleId: HALL_HIRE, name: "Grand Hall — Evening Event", ruleType: "flat_rate", quantity: 1 },
          { kind: "price_list", pricingRuleId: DINNER, name: "Dinner", ruleType: "per_head", quantity: null },
          { kind: "price_list", pricingRuleId: LATE_BAR, name: "Late bar", ruleType: "per_hour", quantity: 5 },
          { kind: "typed", description: "Piper", quantity: 1 },
        ],
      });
    });

    it("keeps a template whose room is no longer listed, saying so, and forgets who saved it once they are gone", async () => {
      const kept = await made();
      await pool.query("UPDATE spaces SET deleted_at = now() WHERE id = $1", [HALL]);
      await pool.query("DELETE FROM users WHERE id = $1", [STAFF.id]);
      const [read] = await list(MANAGER);
      expect(read).toMatchObject({ id: kept.id, spaceId: HALL, roomName: null, roomListed: false, updatedByName: null, readable: true });
    });

    it("lists a template whose stored lines no longer read as unreadable, with nothing in it to use", async () => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO proposal_templates (id, venue_id, space_id, occasion, name, message, lines, updated_by)
         VALUES ($1, $2, NULL, NULL, 'Old format', 'Kept words', '[{"kind":"package","price":900}]'::jsonb, $3)`,
        [id, VENUE, STAFF.id],
      );
      const [read] = await list();
      expect(read).toMatchObject({ id, name: "Old format", readable: false, message: "", lines: [], updatedByName: "Anna Reid" });
      // It can still be removed.
      expect((await remove(id)).statusCode).toBe(204);
      expect(await list()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // What a template may say
  // -------------------------------------------------------------------------

  describe("what a template may say", () => {
    it.each([
      ["a claim the venue cannot back", { message: "The Grand Hall is guaranteed accessible for every guest." }],
      ["nothing at all", { message: "   ", lines: [] }],
      ["more than 40 lines", { spaceId: null, lines: Array.from({ length: 41 }, (_, index) => typed(`Line ${String(index + 1)}`)) }],
      ["a key it does not keep", { price: 1500 }],
      ["a price on a line", { lines: [{ ...typed("Piper"), unitPrice: 250 }] }],
      ["a guest count on a per-head line", { lines: [listed(DINNER, "Dinner", "per_head", 120)] }],
      ["an occasion of nothing but spaces", { occasion: "   " }],
      // PostgreSQL's text and jsonb cannot hold NUL: refused, never a failure.
      ["a NUL in its name", { name: "Grand Hall\u0000wedding" }],
      ["a NUL in its occasion", { occasion: "wed\u0000ding" }],
      ["a NUL in its message", { message: "Thank you\u0000." }],
      ["a NUL in a typed line", { lines: [typed("Pip\u0000er")] }],
      ["a NUL in a price-list line's name", { lines: [listed(HALL_HIRE, "Grand Hall\u0000hire", "flat_rate", 1)] }],
      // Half a surrogate pair: jsonb refuses it and text would alter it.
      ["half a surrogate pair in a typed line", { lines: [typed("Piper \ud83c")] }],
      ["half a surrogate pair in a price-list line's name", { lines: [listed(HALL_HIRE, "Grand Hall hire \udc00", "flat_rate", 1)] }],
      ["half a surrogate pair in its name", { name: "Grand Hall wedding \ud83c" }],
      ["half a surrogate pair in its message", { message: "Thank you \udc00." }],
    ])("refuses a template with %s", async (_, overrides) => {
      const refused = await create(templateBody(overrides));
      expect(refused.statusCode, JSON.stringify(refused.body)).toBe(400);
      expect(refused.code).toBe("VALIDATION_ERROR");
      expect(await stored()).toEqual([]);
    });

    it("keeps forty lines, and refuses a replace that says nothing, names no moment it can hold, carries words it cannot keep or makes a claim", async () => {
      const forty = await made(templateBody({ spaceId: null, lines: Array.from({ length: 40 }, (_, index) => typed(`Line ${String(index + 1)}`)) }));
      expect(forty.lines).toHaveLength(40);
      for (const body of [
        { ...templateBody({ spaceId: null, message: "", lines: [] }), expectedUpdatedAt: forty.updatedAt },
        templateBody({ spaceId: null, lines: [typed("Piper")] }),
        { ...templateBody({ spaceId: null, lines: [typed("Piper")] }), expectedUpdatedAt: "yesterday" },
        // Moments PostgreSQL cannot hold: year 0, and past 9999 once in UTC.
        { ...templateBody({ spaceId: null, lines: [typed("Piper")] }), expectedUpdatedAt: "0000-06-01T00:00:00Z" },
        { ...templateBody({ spaceId: null, lines: [typed("Piper")] }), expectedUpdatedAt: "0001-01-01T00:30:00+01:00" },
        { ...templateBody({ spaceId: null, lines: [typed("Piper")] }), expectedUpdatedAt: "9999-12-31T23:00:00-05:00" },
        { ...templateBody({ spaceId: null, lines: [typed("Pip\u0000er")] }), expectedUpdatedAt: forty.updatedAt },
        { ...templateBody({ spaceId: null, lines: [typed("Piper \ud83c")] }), expectedUpdatedAt: forty.updatedAt },
        { ...templateBody({ spaceId: null, lines: [typed("Piper")], message: "Fire approved for 400." }), expectedUpdatedAt: forty.updatedAt },
      ]) {
        const refused = await replace(forty.id, body);
        expect(refused.statusCode, JSON.stringify(body)).toBe(400);
        expect(refused.code).toBe("VALIDATION_ERROR");
      }
      expect((await list())[0]).toEqual(forty);
    });

    it("keeps the occasion lower-cased and the name trimmed, as the table holds them", async () => {
      const kept = await made(templateBody({ name: "  Grand Hall wedding  ", occasion: " Wedding " }));
      expect(kept).toMatchObject({ name: "Grand Hall wedding", occasion: "wedding" });
    });
  });

  // -------------------------------------------------------------------------
  // GET /proposals/:id/event
  // -------------------------------------------------------------------------

  describe("the event a proposal is for, before any version", () => {
    const PROPOSAL = "89999999-9999-4999-8999-999999999999";

    async function proposal(links: { enquiryId?: string; opportunityId?: string; configurationId?: string } = {}): Promise<void> {
      await pool.query(
        `INSERT INTO proposals (id, venue_id, title, status, current_version, created_by, enquiry_id, opportunity_id, configuration_id)
         VALUES ($1, $2, 'Crawford wedding proposal', 'draft', 0, $3, $4, $5, $6)`,
        [PROPOSAL, VENUE, STAFF.id, links.enquiryId ?? null, links.opportunityId ?? null, links.configurationId ?? null],
      );
    }

    async function enquiry(spaceId: string, roomChosen = true): Promise<string> {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO enquiries (id, venue_id, space_id, name, email, preferred_date, estimated_guests, event_type, state, room_chosen)
         VALUES ($1, $2, $3, 'Elaine Crawford', 'elaine@example.test', '2027-06-01', 150, 'wedding', 'approved', $4)`,
        [id, VENUE, spaceId, roomChosen],
      );
      return id;
    }

    /** Everything the fixture holds, so a read can be shown to write nothing. */
    async function everything(): Promise<string> {
      const tables = ["proposals", "enquiries", "opportunities", "configurations", "spaces", "proposal_templates", "pricing_rules", "users", "venues"];
      const parts: string[] = [];
      for (const table of tables) {
        const rows = await pool.query<{ row: string }>(`SELECT t::text AS row FROM "${table}" t ORDER BY 1`);
        parts.push(`${table}:${rows.rows.map((row) => row.row).join("|")}`);
      }
      return parts.join("\n");
    }

    async function event(who: Person = STAFF, id = PROPOSAL): Promise<{ statusCode: number; event?: ProposalEvent; code?: string }> {
      const res = await server.inject({ method: "GET", url: `/proposals/${id}/event`, headers: as(who) });
      const body = JSON.parse(res.body) as { data?: unknown; code?: string };
      return { statusCode: res.statusCode, code: body.code, ...(body.data === undefined ? {} : { event: ProposalEventSchema.parse(body.data) }) };
    }

    it("gives the room the guest chose on the enquiry, with its id, and writes nothing", async () => {
      await proposal({ enquiryId: await enquiry(SALOON) });
      const before = await everything();
      const read = await event();
      expect(read.statusCode).toBe(200);
      expect(read.event).toEqual({
        facts: { eventDate: "2027-06-01", guestCount: 150, occasion: "wedding", roomName: "Saloon", roomSlug: "saloon" },
        spaceId: SALOON,
      });
      expect(await everything()).toBe(before);
    });

    it("names no room the guest did not choose", async () => {
      await proposal({ enquiryId: await enquiry(SALOON, false) });
      expect((await event()).event).toEqual({
        facts: { eventDate: "2027-06-01", guestCount: 150, occasion: "wedding", roomName: null, roomSlug: null },
        spaceId: null,
      });
    });

    it("prefers the layout's room and the deal's facts", async () => {
      const enquiryId = await enquiry(SALOON);
      const opportunityId = randomUUID();
      await pool.query(
        `INSERT INTO opportunities (id, venue_id, title, stage, source_enquiry_id, preferred_date, guest_count, event_type, estimated_value_minor, currency, next_action)
         VALUES ($1, $2, 'Crawford wedding', 'qualified', $3, '2027-06-05', 160, 'ceilidh', 0, 'GBP', 'Draft')`,
        [opportunityId, VENUE, enquiryId],
      );
      const configurationId = randomUUID();
      await pool.query("INSERT INTO configurations (id, venue_id, space_id, name) VALUES ($1, $2, $3, 'Dinner rounds')", [configurationId, VENUE, HALL]);
      // The enquiry is reached through the deal.
      await proposal({ opportunityId, configurationId });
      const before = await everything();
      expect((await event()).event).toEqual({
        facts: { eventDate: "2027-06-05", guestCount: 160, occasion: "ceilidh", roomName: "Grand Hall", roomSlug: "grand-hall" },
        spaceId: HALL,
      });
      expect(await everything()).toBe(before);
    });

    it("answers only the venue's commercial team, and not for a removed proposal", async () => {
      await proposal({ enquiryId: await enquiry(SALOON) });
      const before = await everything();
      expect((await event(OTHER_ADMIN)).statusCode).toBe(403);
      expect((await event(HALLKEEPER)).statusCode).toBe(403);
      expect((await event(SALES)).statusCode).toBe(200);
      expect((await event(PLATFORM_ADMIN)).statusCode).toBe(200);
      expect((await event(STAFF, randomUUID())).statusCode).toBe(404);
      const bad = await server.inject({ method: "GET", url: "/proposals/not-a-proposal/event", headers: as(STAFF) });
      expect(bad.statusCode).toBe(400);
      expect(await everything()).toBe(before);

      await pool.query("UPDATE proposals SET deleted_at = now() WHERE id = $1", [PROPOSAL]);
      const removed = await event();
      expect(removed.statusCode).toBe(404);
      expect(removed.code).toBe("NOT_FOUND");
    });
  });
});
