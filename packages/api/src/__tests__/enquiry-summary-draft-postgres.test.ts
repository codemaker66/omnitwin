import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AIDraftSchema } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import type { Env } from "../env.js";
import { enquirySummaryDraftRoutes } from "../routes/enquiry-summary-draft.js";
import { DisabledAIGenerationAdapter, type AIGenerationAdapter, type AIGenerationInput } from "../services/ai-assistant.js";
import { TallyAIUsageMeter } from "../services/ai-usage.js";
import { AnthropicAIGenerationAdapter } from "../services/anthropic-draft-adapter.js";

// ---------------------------------------------------------------------------
// Release audit ai-1 (27 October 2026): an enquiry's AI summary is built on
// the server from the enquiry the venue holds, never from what the browser
// sends. Against a real database: what reaches the provider has no name,
// email address, phone number or id; only the venue's own team may ask, for
// an enquiry at the venue they work at (another venue's is not found); and
// nothing to summarise is refused rather than invented.
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
    throw new Error("Enquiry summary draft route tests require their explicit isolated loopback database");
  }
}

const VENUE = "a1111111-1111-4111-8111-111111111111";
const OTHER_VENUE = "a2222222-2222-4222-8222-222222222222";
const HALL = "a3333333-3333-4333-8333-333333333333";
const OTHER_HALL = "a4444444-4444-4444-8444-444444444444";
const ENQUIRY = "a5555555-5555-4555-8555-555555555555";

const WORDS = "Jane Doe, jane@example.com, call me on 07700 900123; my father is a wheelchair user and two guests are coeliac";

function as(role: string, venueId: string | null, platformRole: "none" | "admin" = "none"): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ id: randomUUID(), email: `${role}@example.test`, role, platformRole, venueId })}` };
}

describe.skipIf(testUrl === undefined)("enquiry summary drafts built on the server, on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  let offServer: FastifyInstance;
  let spentServer: FastifyInstance;
  const seen: AIGenerationInput[] = [];
  const fixtureSchema = `enquiry_summary_draft_${randomUUID().replaceAll("-", "")}`;
  const looseTables: PgTable[] = [schema.venues, schema.spaces, schema.enquiries];

  const capture: AIGenerationAdapter = {
    status: { configured: true, provider: "capture", model: "capture-model", disabledReason: null },
    generateText(input) {
      seen.push(input);
      return Promise.resolve("A wedding enquiry for about 150 guests in the Grand Hall.");
    },
  };

  async function ask(headers: { authorization: string }, id: string = ENQUIRY, target: FastifyInstance = server) {
    const res = await target.inject({ method: "POST", url: `/enquiries/${id}/summary-draft`, headers, payload: {} });
    return { statusCode: res.statusCode, body: res.json<Record<string, unknown>>() };
  }

  async function enquiry(values: {
    readonly id?: string;
    readonly venueId?: string;
    readonly spaceId?: string;
    readonly message?: string | null;
    readonly eventType?: string | null;
    readonly guests?: number | null;
    readonly date?: string | null;
    readonly roomChosen?: boolean;
  } = {}): Promise<void> {
    await pool.query(
      `INSERT INTO enquiries (id, venue_id, space_id, name, email, guest_name, guest_email, guest_phone, preferred_date,
         estimated_guests, event_type, state, room_chosen, message, created_at)
       VALUES ($1, $2, $3, 'Jane Doe', 'jane@example.com', 'Jane Doe', 'jane@example.com', '07700 900123', $4, $5, $6,
         'submitted', $7, $8, '2026-10-26T23:30:00Z')`,
      [values.id ?? ENQUIRY, values.venueId ?? VENUE, values.spaceId ?? HALL,
        values.date === undefined ? "2027-06-01" : values.date,
        values.guests === undefined ? 150 : values.guests,
        values.eventType === undefined ? "wedding" : values.eventType,
        values.roomChosen ?? true,
        values.message === undefined ? WORDS : values.message],
    );
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 4, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of looseTables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => {
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "updated_at") defaultSql = " default now()";
        else if (column.name === "room_chosen") defaultSql = " default true";
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(enquirySummaryDraftRoutes, { db, env: {} as Env, adapter: capture, prefix: "/enquiries" });
    await server.ready();
    offServer = Fastify();
    await offServer.register(enquirySummaryDraftRoutes, { db, env: {} as Env, adapter: new DisabledAIGenerationAdapter(), prefix: "/enquiries" });
    await offServer.ready();
    // A venue whose allowance is one micro-dollar: no call's worst case fits, and nothing is sent.
    spentServer = Fastify();
    await spentServer.register(enquirySummaryDraftRoutes, {
      db,
      env: {} as Env,
      adapter: new AnthropicAIGenerationAdapter({
        model: "claude-opus-5-5",
        apiKey: "test-key-not-real",
        usage: new TallyAIUsageMeter({ limitMicroUsd: 1 }),
        send: () => Promise.reject(new Error("nothing may be sent")),
      }),
      prefix: "/enquiries",
    });
    await spentServer.ready();
  }, 120_000);

  beforeEach(async () => {
    seen.length = 0;
    await pool.query(`TRUNCATE ${looseTables.map((table) => `"${getTableConfig(table).name}"`).join(", ")}`);
    await pool.query("INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Trades Hall Glasgow', 'trades-hall-glasgow', '85 Glassford Street'), ($2, 'Another Hall', 'another-hall', '1 Elsewhere')",
      [VENUE, OTHER_VENUE]);
    await pool.query("INSERT INTO spaces (id, venue_id, name, slug, sort_order) VALUES ($1, $2, 'Grand Hall', 'grand-hall', 0), ($3, $4, 'Other Room', 'other-room', 0)",
      [HALL, VENUE, OTHER_HALL, OTHER_VENUE]);
  }, 60_000);

  afterAll(async () => {
    for (const app of [server, offServer, spentServer]) {
      if (app !== undefined) await app.close();
    }
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  }, 60_000);

  // The guest's name, email address and phone number as the form's own fields
  // hold them are never sent; a name the guest wrote in their message is, as
  // written (the privacy page says so), with contact details taken out.
  it("summarises from the enquiry the venue holds, sending no name, contact or id field and no contact details in the guest's words", async () => {
    await enquiry();
    const answer = await ask(as("staff", VENUE));
    expect(answer.statusCode).toBe(200);
    const draft = AIDraftSchema.parse(answer.body["data"]);
    expect(draft).toMatchObject({ useCase: "enquiry_summary", humanReviewRequired: true, sendState: "draft_only", provenance: "ai_generated" });
    expect(seen).toHaveLength(1);
    const [input] = seen;
    if (input === undefined) throw new Error("expected the provider to be asked");
    expect(input.useCase).toBe("enquiry_summary");
    expect(input.context).toEqual({
      occasion: "Wedding",
      preferredDate: "2027-06-01",
      estimatedGuests: 150,
      roomName: "Grand Hall",
      currentStatus: "submitted",
      // 23:30 GMT on the 26th is the 26th in Glasgow.
      receivedOn: "2026-10-26",
      clientNotes: "Jane Doe, (email address), call me on (phone number); my father is a wheelchair user and two guests are coeliac",
    });
    for (const sent of [JSON.stringify(input.context), input.prompt, input.instructions]) {
      expect(sent).not.toMatch(new RegExp(`jane@example\\.com|07700|900123|${ENQUIRY}|${VENUE}|${HALL}|enquiryId|"email"|"name"`, "u"));
    }
    expect(input.prompt).toContain("(email address)");
    expect(input.prompt).toContain("(phone number)");
  });

  it("names no room the guest did not choose", async () => {
    await enquiry({ roomChosen: false });
    expect((await ask(as("staff", VENUE))).statusCode).toBe(200);
    expect(seen[0]?.context["roomName"]).toBeNull();
  });

  it("does not find another venue's enquiry, and asks the provider nothing", async () => {
    await enquiry({ venueId: OTHER_VENUE, spaceId: OTHER_HALL });
    const answer = await ask(as("staff", VENUE));
    expect(answer.statusCode).toBe(404);
    expect(answer.body).toEqual({ error: "Enquiry not found", code: "NOT_FOUND" });
    // The other venue's own team may.
    expect((await ask(as("sales", OTHER_VENUE))).statusCode).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it.each([
    ["the venue's hallkeeper", as("hallkeeper", VENUE)],
    ["the venue's manager", as("manager", VENUE)],
    ["the venue's admin", as("admin", VENUE)],
    ["a platform admin who works at the venue", as("admin", VENUE, "admin")],
  ])("summarises for %s, as the enquiry inbox admits them", async (_, headers) => {
    await enquiry();
    expect((await ask(headers)).statusCode).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it.each([
    ["an account with no venue", as("admin", null)],
    ["a platform admin with no venue", as("admin", null, "admin")],
    ["a client of the venue", as("client", VENUE)],
    ["a planner at the venue", as("planner", VENUE)],
  ])("refuses %s, sending nothing", async (_, headers) => {
    await enquiry();
    const answer = await ask(headers);
    expect(answer.statusCode).toBe(403);
    expect(answer.body).toMatchObject({ code: "FORBIDDEN" });
    expect(seen).toEqual([]);
  });

  it("refuses an enquiry with nothing to summarise rather than invent one", async () => {
    await enquiry({ message: "  ", eventType: null, guests: null, date: null });
    const answer = await ask(as("staff", VENUE));
    expect(answer.statusCode).toBe(422);
    expect(answer.body).toMatchObject({ code: "NOTHING_TO_DRAFT_FROM" });
    expect(seen).toEqual([]);
  });

  it("answers 503 while AI is off, 429 once the venue's allowance is used, and 400 for a malformed id", async () => {
    await enquiry();
    expect(await ask(as("staff", VENUE), ENQUIRY, offServer)).toMatchObject({ statusCode: 503, body: { code: "AI_ASSISTANT_DISABLED" } });
    expect(await ask(as("staff", VENUE), ENQUIRY, spentServer)).toMatchObject({ statusCode: 429, body: { code: "AI_BUDGET_REACHED" } });
    expect(await ask(as("staff", VENUE), "not-an-id")).toMatchObject({ statusCode: 400, body: { code: "VALIDATION_ERROR" } });
    expect(seen).toEqual([]);
  });
});
