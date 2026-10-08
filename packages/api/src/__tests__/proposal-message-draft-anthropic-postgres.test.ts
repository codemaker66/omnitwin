import Anthropic from "@anthropic-ai/sdk";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalMessageDraftSchema } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import type { Env } from "../env.js";
import { proposalMessageDraftRoutes } from "../routes/proposal-message-draft.js";
import { DisabledAIGenerationAdapter } from "../services/ai-assistant.js";
import { AnthropicAIGenerationAdapter } from "../services/anthropic-draft-adapter.js";

// ---------------------------------------------------------------------------
// "Use in proposal" (X1, T-635) with the Anthropic provider (T-650), against a
// real database: the same route, the real SDK, and the provider's HTTP
// boundary replaced here, so nothing leaves the machine. It proves the
// provider keeps X1's guarantees: only the commercial team asks, nothing is
// invented from an empty proposal, contact details never reach the provider,
// the draft comes back unchecked, and every provider failure fails as the
// gateway's do (502 AI_DRAFT_GENERATION_FAILED), with AI switched off still
// 503 AI_ASSISTANT_DISABLED. A mock does not prove the live integration.
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
    throw new Error("Proposal message draft route tests require their explicit isolated loopback database");
  }
}

const VENUE = "81111111-1111-4111-8111-111111111112";
const HALL = "83333333-3333-4333-8333-333333333334";
const PROPOSAL = "89999999-9999-4999-8999-999999999998";
const STAFF = { id: "88888888-8888-4888-8888-000000000101", role: "staff" } as const;
const HALLKEEPER = { id: "88888888-8888-4888-8888-000000000102", role: "hallkeeper" } as const;

function as(who: { readonly id: string; readonly role: string }): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ id: who.id, email: `${who.role}@example.test`, role: who.role, platformRole: "none", venueId: VENUE })}` };
}

interface Reply { readonly status?: number; readonly text?: string; readonly stopReason?: string; readonly lost?: boolean }

const sent: Record<string, unknown>[] = [];
const replies: Reply[] = [];
const fakeFetch = vi.fn((_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  sent.push(typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {});
  const reply = replies.shift() ?? { text: "Dear Elaine, thank you for thinking of the Grand Hall." };
  if (reply.lost === true) return Promise.reject(new TypeError("fetch failed"));
  if (reply.status !== undefined) {
    return Promise.resolve(new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "test failure" } }), {
      status: reply.status, headers: { "content-type": "application/json", "x-should-retry": "false" },
    }));
  }
  return Promise.resolve(new Response(JSON.stringify({
    id: "msg_x1", type: "message", role: "assistant", model: "claude-opus-5-5",
    content: reply.text === undefined ? [] : [{ type: "text", text: reply.text, citations: null }],
    stop_reason: reply.stopReason ?? "end_turn", stop_sequence: null, stop_details: null,
    usage: { input_tokens: 50, output_tokens: 60 },
  }), { status: 200, headers: { "content-type": "application/json" } }));
});

describe.skipIf(testUrl === undefined)("proposal message drafts with the Anthropic provider on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  let offServer: FastifyInstance;
  const fixtureSchema = `proposal_message_draft_anthropic_${randomUUID().replaceAll("-", "")}`;
  const looseTables: PgTable[] = [schema.venues, schema.users, schema.spaces, schema.proposals, schema.enquiries,
    schema.opportunities, schema.configurations, schema.contacts, schema.proposalComments, schema.proposalVersions, schema.proposalStatusHistory];

  async function ask(who: { readonly id: string; readonly role: string }, target: FastifyInstance = server): Promise<{ statusCode: number; body: Record<string, unknown> }> {
    const res = await target.inject({ method: "POST", url: `/proposals/${PROPOSAL}/message-draft`, headers: as(who) });
    return { statusCode: res.statusCode, body: res.json<Record<string, unknown>>() };
  }

  async function proposalWithEnquiry(message: string | null): Promise<void> {
    const enquiryId = randomUUID();
    await pool.query(
      `INSERT INTO enquiries (id, venue_id, space_id, name, email, preferred_date, estimated_guests, event_type, state, room_chosen, message)
       VALUES ($1, $2, $3, 'Elaine Crawford', 'elaine@example.test', '2027-06-01', 150, 'wedding', 'approved', true, $4)`,
      [enquiryId, VENUE, HALL, message],
    );
    await pool.query(
      "INSERT INTO proposals (id, venue_id, title, status, current_version, created_by, enquiry_id) VALUES ($1, $2, 'Crawford wedding proposal', 'draft', 0, $3, $4)",
      [PROPOSAL, VENUE, STAFF.id, enquiryId],
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
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    const db = drizzle(pool, { schema });
    const client = new Anthropic({ apiKey: "test-key-not-real", baseURL: "https://api.anthropic.com", fetch: fakeFetch, maxRetries: 0 });
    const adapter = new AnthropicAIGenerationAdapter({
      model: "claude-opus-5-5",
      apiKey: "test-key-not-real",
      send: (request) => client.beta.messages.create(request),
    });
    server = Fastify();
    await server.register(proposalMessageDraftRoutes, { db, env: {} as Env, adapter, prefix: "/proposals" });
    await server.ready();
    offServer = Fastify();
    await offServer.register(proposalMessageDraftRoutes, { db, env: {} as Env, adapter: new DisabledAIGenerationAdapter(), prefix: "/proposals" });
    await offServer.ready();
  }, 120_000);

  beforeEach(async () => {
    sent.length = 0;
    replies.length = 0;
    fakeFetch.mockClear();
    await pool.query(`TRUNCATE ${looseTables.map((table) => `"${getTableConfig(table).name}"`).join(", ")}`);
    await pool.query("INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Trades Hall Glasgow', 'trades-hall-glasgow', '85 Glassford Street')", [VENUE]);
    await pool.query("INSERT INTO spaces (id, venue_id, name, slug, sort_order) VALUES ($1, $2, 'Grand Hall', 'grand-hall', 0)", [HALL, VENUE]);
    for (const who of [STAFF, HALLKEEPER]) {
      await pool.query("INSERT INTO users (id, email, name, role, platform_role, venue_id) VALUES ($1, $2, 'Test person', $3, 'none', $4)",
        [who.id, `${who.id}@example.test`, who.role, VENUE]);
    }
  }, 60_000);

  afterAll(async () => {
    if (server !== undefined) await server.close();
    if (offServer !== undefined) await offServer.close();
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  }, 60_000);

  it("returns Claude's draft as an unchecked, never-sent draft of what it drew on", async () => {
    await proposalWithEnquiry("We'd love a ceilidh after dinner.");
    const answer = await ask(STAFF);
    expect(answer.statusCode).toBe(200);
    const draft = ProposalMessageDraftSchema.parse(answer.body["data"]);
    expect(draft.draft).toMatchObject({
      useCase: "proposal_draft", body: "Dear Elaine, thank you for thinking of the Grand Hall.",
      humanReviewRequired: true, provenance: "ai_generated", evidenceStatus: "unverified", sendState: "draft_only",
    });
    expect(draft.drewOn).toEqual({ event: true, enquiry: true, clientWords: false });
    // The rules in the system prompt; the venue's facts, as data, in the user turn.
    expect(JSON.stringify(sent[0]?.["system"])).toContain("You are drafting the message a venue's events team sends their client with a proposal");
    expect(JSON.stringify(sent[0]?.["messages"])).toContain("ceilidh after dinner");
  });

  it("never sends the provider an email address or phone number from the client's words", async () => {
    await proposalWithEnquiry("Call me on 07700 900123 or write to elaine.c@example.org.");
    expect((await ask(STAFF)).statusCode).toBe(200);
    const body = JSON.stringify(sent[0]);
    expect(body).not.toMatch(/07700|900123|elaine\.c@|example\.org|elaine@example\.test/u);
    expect(body).toContain("(phone number)");
    expect(body).toContain("(email address)");
  });

  it("refuses a hallkeeper, and refuses to invent from nothing, asking the provider nothing", async () => {
    await proposalWithEnquiry("Words.");
    expect((await ask(HALLKEEPER)).statusCode).toBe(403);
    await pool.query("DELETE FROM proposals");
    await pool.query("INSERT INTO proposals (id, venue_id, title, status, current_version, created_by) VALUES ($1, $2, 'Empty', 'draft', 0, $3)", [PROPOSAL, VENUE, STAFF.id]);
    const nothing = await ask(STAFF);
    expect(nothing.statusCode).toBe(422);
    expect(nothing.body["code"]).toBe("NOTHING_TO_DRAFT_FROM");
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("says AI is off with the server's own code when it is switched off", async () => {
    await proposalWithEnquiry("Words.");
    const off = await ask(STAFF, offServer);
    expect(off.statusCode).toBe(503);
    expect(off.body["code"]).toBe("AI_ASSISTANT_DISABLED");
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["a server error", { status: 500 }],
    ["a rate limit", { status: 429 }],
    ["a rejected key", { status: 401 }],
    ["a refusal", { stopReason: "refusal" }],
    ["an answer cut off", { text: "Dear Ela", stopReason: "max_tokens" }],
    ["a lost connection", { lost: true }],
  ] as const)("fails as the gateway fails on %s: 502 AI_DRAFT_GENERATION_FAILED", async (_, reply) => {
    await proposalWithEnquiry("Words.");
    replies.push(reply);
    const answer = await ask(STAFF);
    expect(answer.statusCode).toBe(502);
    expect(answer.body).toEqual({ error: "AI draft generation failed", code: "AI_DRAFT_GENERATION_FAILED" });
  });
});
