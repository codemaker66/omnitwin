import Fastify, { type FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type FetchLike,
} from "@modelcontextprotocol/client";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import { TRADES_HALL_PUBLIC_PROFILE, TRADES_HALL_ROOM_CAPACITIES } from "@omnitwin/types";
import type { Env } from "../env.js";
import {
  AI_ASSISTANT_ORIGIN_HOSTS,
  MCP_MAX_BODY_BYTES,
  MCP_RATE_LIMIT_PER_MINUTE,
  mcpAllowedOriginHosts,
  publicMcpRoutes,
  publicToolInputs,
} from "../routes/public-mcp.js";
import type {
  BlockingInterval,
  PublicDiscoveryStore,
  PublicRoomRecord,
  PublicVenueRecord,
} from "../services/public-discovery.js";

// ---------------------------------------------------------------------------
// POST /mcp through the official MCP client (T-649), on a real socket, in both
// protocol eras: the 2026-07-28 stateless revision and the 2025 initialize
// handshake. The store is in memory here; public-mcp-postgres.test.ts runs the
// real query against migrated PostgreSQL with seeded private data.
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-10-01T11:00:00.000Z");
const MODERN = "2026-07-28";

function room(id: string, slug: string, name: string): PublicRoomRecord {
  return {
    id, slug, name, widthM: "21.00", lengthM: "10.50", heightM: "7.00",
    floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
  };
}

const TRADES_HALL: PublicVenueRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: TRADES_HALL_PUBLIC_PROFILE.dbSlug,
  timeZone: "Europe/London",
  rooms: [room("gh", "grand-hall", "Grand Hall"), room("sr", "store-room", "Store Room")],
};
const OTHER: PublicVenueRecord = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "other-venue",
  timeZone: "Europe/London",
  rooms: [room("oh", "hall", "Other Hall")],
};
const INTERVALS: Record<string, readonly BlockingInterval[]> = {
  [TRADES_HALL.id]: [{ spaceId: "gh", startsAt: new Date("2026-10-24T17:00:00.000Z"), endsAt: new Date("2026-10-25T00:30:00.000Z") }],
  [OTHER.id]: [{ spaceId: "oh", startsAt: new Date("2026-10-23T09:00:00.000Z"), endsAt: new Date("2026-10-23T17:00:00.000Z") }],
};

const store: PublicDiscoveryStore = {
  loadVenue: (slug) => Promise.resolve([TRADES_HALL, OTHER].find((venue) => venue.slug === slug) ?? null),
  loadBlockingIntervals: (venueId, from, to) => Promise.resolve(
    (INTERVALS[venueId] ?? []).filter((item) => item.startsAt < to && item.endsAt > from),
  ),
};

/** Records every response body the client receives. */
function recordingFetch(bodies: string[]): FetchLike {
  return async (input, init) => {
    const response = await fetch(input, init);
    bodies.push(await response.clone().text());
    return response;
  };
}

async function connect(url: URL, era: "modern" | "legacy", bodies: string[]): Promise<Client> {
  const client = new Client(
    { name: "venviewer-public-mcp-test", version: "1.0.0" },
    era === "modern" ? { versionNegotiation: { mode: { pin: MODERN } } } : {},
  );
  await client.connect(new StreamableHTTPClientTransport(url, { fetch: recordingFetch(bodies) }));
  return client;
}

function text(result: CallToolResult): string {
  const [first] = result.content;
  if (first?.type !== "text") throw new Error("Expected a text result");
  return first.text;
}

const STACK_TRACE = /\n\s+at\s|node_modules|\.ts:\d+|\.js:\d+|Error:/u;

describe("public MCP endpoint, in-memory store", () => {
  let server: FastifyInstance;
  let url: URL;
  const bodies: string[] = [];
  const clients: Client[] = [];

  beforeAll(async () => {
    server = Fastify();
    await server.register(publicMcpRoutes, { store, corsOrigins: ["https://venviewer.com"], now: () => NOW });
    await server.listen({ port: 0, host: "127.0.0.1" });
    const { port } = server.server.address() as AddressInfo;
    url = new URL(`http://127.0.0.1:${String(port)}/mcp`);
  }, 120_000);

  afterAll(async () => {
    for (const client of clients) await client.close();
    await server.close();
  });

  async function client(era: "modern" | "legacy"): Promise<Client> {
    const connected = await connect(url, era, bodies);
    clients.push(connected);
    return connected;
  }

  describe.each(["modern", "legacy"] as const)("%s era", (era) => {
    it("lists exactly three read-only tools with their contracts", async () => {
      const mcp = await client(era);
      const { tools } = await mcp.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(["check_availability", "get_venue", "how_to_enquire"]);
      for (const tool of tools) {
        expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
        expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      }
      const availability = tools.find((tool) => tool.name === "check_availability");
      expect(availability?.description).toContain("never who booked");
      expect(availability?.inputSchema.required).toEqual(["from", "to"]);
      expect(mcp.getInstructions()).toContain("Nothing here can send an enquiry, hold a date or make a booking");
    });

    it("describes the venue with published capacities only", async () => {
      const mcp = await client(era);
      const result = await mcp.callTool({ name: "get_venue", arguments: {} });
      expect(result.isError).not.toBe(true);
      const venue = result.structuredContent as {
        venue: { name: string; officialWebsite: string; timeZone: string };
        rooms: { slug: string; capacities: { layout: string; maxGuests: number | null; note: string | null }[] }[];
      };
      expect(venue.venue).toMatchObject({
        name: "Trades Hall of Glasgow", officialWebsite: "https://www.tradeshallglasgow.co.uk/", timeZone: "Europe/London",
      });
      const grandHall = venue.rooms.find((entry) => entry.slug === "grand-hall");
      expect(grandHall?.capacities.find((entry) => entry.layout === "dinner")?.maxGuests).toBe(TRADES_HALL_ROOM_CAPACITIES["grand-hall"].dinner);
      const storeRoom = venue.rooms.find((entry) => entry.slug === "store-room");
      expect(storeRoom?.capacities.every((entry) => entry.maxGuests === null && entry.note?.startsWith("Not published") === true)).toBe(true);
      expect(JSON.parse(text(result))).toEqual(result.structuredContent);
    });

    it("answers free or busy per room per date", async () => {
      const mcp = await client(era);
      const result = await mcp.callTool({
        name: "check_availability", arguments: { from: "2026-10-23", to: "2026-10-25", room: "grand-hall" },
      });
      expect(result.isError).not.toBe(true);
      expect((result.structuredContent as { rooms: unknown[] }).rooms).toEqual([
        { room: "grand-hall", name: "Grand Hall", days: { "2026-10-23": "free", "2026-10-24": "busy", "2026-10-25": "free" } },
      ]);
    });

    it("explains how to enquire, through staff", async () => {
      const mcp = await client(era);
      const result = await mcp.callTool({ name: "how_to_enquire", arguments: { venue: "trades-hall-glasgow" } });
      expect(result.structuredContent).toMatchObject({
        enquiryUrl: "https://venviewer.com/#enquire",
        otherWays: { telephone: "+44 141 552 2418", email: "info@tradeshallglasgow.co.uk" },
      });
      expect(text(result)).toContain("cannot send an enquiry, hold a date or make a booking");
    });
  });

  describe("input bounds", () => {
    const cases: readonly [string, Record<string, unknown>, RegExp][] = [
      ["an impossible date", { from: "2026-02-30", to: "2026-03-01" }, /real date/u],
      ["a non-ISO date", { from: "14/11/2026", to: "2026-11-15" }, /real date/u],
      ["a range that runs backwards", { from: "2026-11-15", to: "2026-11-14" }, /on or after/u],
      ["more than 92 days", { from: "2026-11-01", to: "2027-02-01" }, /at most 92 days/u],
      ["a date already past", { from: "2026-09-30", to: "2026-10-02" }, /today \(2026-10-01/u],
      ["a date beyond the horizon", { from: "2028-09-25", to: "2028-10-02" }, /730 days ahead/u],
      ["a room written as a name", { from: "2026-11-01", to: "2026-11-02", room: "Grand Hall" }, /room slug/u],
      ["an over-long room", { from: "2026-11-01", to: "2026-11-02", room: "a".repeat(101) }, /100/u],
      ["an unknown room", { from: "2026-11-01", to: "2026-11-02", room: "ballroom" }, /no room "ballroom"/u],
      ["an unexpected field", { from: "2026-11-01", to: "2026-11-02", clientName: "x" }, /[Uu]nrecognized/u],
      ["a missing date", { from: "2026-11-01" }, /to/u],
    ];

    it.each(cases)("refuses %s with a plain message", async (_label, args, message) => {
      const mcp = await client("modern");
      const result = await mcp.callTool({ name: "check_availability", arguments: args });
      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(message);
      expect(text(result)).not.toMatch(STACK_TRACE);
    });
  });

  describe("only allowlisted venues exist", () => {
    it("treats another tenant's slug and id exactly like a venue that does not exist", async () => {
      const mcp = await client("modern");
      const answer = async (venue: string): Promise<string> => {
        const result = await mcp.callTool({ name: "get_venue", arguments: { venue } });
        expect(result.isError).toBe(true);
        // The answer never echoes the venue asked for, so no normalising.
        expect(text(result)).not.toContain(venue);
        return text(result);
      };
      const otherSlug = await answer(OTHER.slug);
      const otherId = await answer(OTHER.id);
      const nobody = await answer("no-such-venue-anywhere");
      expect(otherSlug).toBe(nobody);
      expect(otherId).toBe(nobody);
      for (const tool of ["check_availability", "how_to_enquire"]) {
        const result = await mcp.callTool({ name: tool, arguments: { venue: OTHER.slug, from: "2026-10-23", to: "2026-10-23" } });
        expect(result.isError).toBe(true);
      }
    });

    it("never mentions another tenant in any response it has sent", () => {
      expect(bodies.length).toBeGreaterThan(10);
      for (const body of bodies) {
        expect(body).not.toContain("Other Hall");
        expect(body).not.toContain(OTHER.id);
        expect(body).not.toContain("2026-10-23T09:00");
      }
    });
  });

  describe("transport safety", () => {
    function post(headers: Record<string, string>, body: string): Promise<Response> {
      return fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body,
      });
    }
    const listTools = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    it("refuses a browser Origin it does not know, per the transport's MUST", async () => {
      const response = await post({ origin: "https://evil.example" }, listTools);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toMatch(STACK_TRACE);
    });

    it.each(["https://venviewer.com", "https://claude.ai", "https://chatgpt.com"])("admits the Origin %s", async (origin) => {
      const response = await post({ origin }, listTools);
      expect(response.status).toBe(200);
    });

    it("admits server-side clients, which send no Origin, and marks answers uncacheable", async () => {
      const response = await post({}, listTools);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("refuses an oversized body before any MCP work", async () => {
      const padding = "x".repeat(MCP_MAX_BODY_BYTES + 1);
      const response = await post({}, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { padding } }));
      expect(response.status).toBe(413);
    });

    it("has no session stream to open", async () => {
      const response = await fetch(url, { method: "GET", headers: { accept: "text/event-stream" } });
      expect(response.status).toBe(405);
    });

    it("closes a change subscription at once, having nothing to notify", async () => {
      const response = await post(
        { "mcp-protocol-version": MODERN, "mcp-method": "subscriptions/listen" },
        JSON.stringify({
          jsonrpc: "2.0", id: 7, method: "subscriptions/listen",
          params: {
            notifications: { toolsListChanged: true },
            _meta: {
              "io.modelcontextprotocol/protocolVersion": MODERN,
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      );
      const settled = await Promise.race([
        response.text(),
        new Promise<null>((resolve) => { setTimeout(() => { resolve(null); }, 5_000); }),
      ]);
      expect(settled).not.toBeNull();
      expect(settled).not.toContain("toolsListChanged\":true");
    });
  });
});

describe("tool input contracts", () => {
  const inputs = publicToolInputs([TRADES_HALL_PUBLIC_PROFILE]);
  const json = inputs.checkAvailability["~standard"].jsonSchema.input({ target: "draft-2020-12" });
  const advertised = fromJsonSchema(json);

  // Shape-level cases both describe; cross-field and calendar rules are Zod's
  // alone (JSON Schema cannot say "on or after from" or "no 30 February").
  const shapes: readonly [Record<string, unknown>, boolean][] = [
    [{ from: "2026-11-01", to: "2026-11-02" }, true],
    [{ venue: "trades-hall-glasgow", from: "2026-11-01", to: "2026-11-02", room: "grand-hall" }, true],
    [{ from: "2026-11-01" }, false],
    [{ from: "2026-11-01", to: "2026-11-02", extra: true }, false],
    [{ venue: "other-venue", from: "2026-11-01", to: "2026-11-02" }, false],
    [{ from: "2026-11-01", to: "2026-11-02", room: "Grand Hall" }, false],
    [{ from: "2026-11-01", to: "2026-11-02", room: "a".repeat(101) }, false],
    [{ from: 20261101, to: "2026-11-02" }, false],
    [{ from: "2026-11", to: "2026-11-02" }, false],
  ];

  it.each(shapes)("Zod and the advertised JSON Schema agree on %j", async (value, valid) => {
    const zod = await inputs.checkAvailability["~standard"].validate(value);
    const schema = await advertised["~standard"].validate(value);
    expect(zod.issues === undefined).toBe(valid);
    expect(schema.issues === undefined).toBe(valid);
  });

  it("defaults the venue to the one opted-in venue", async () => {
    const parsed = await inputs.getVenue["~standard"].validate({});
    expect(parsed).toEqual({ value: { venue: "trades-hall-glasgow" } });
  });
});

describe("Origin allowlist", () => {
  it("is the API's CORS origins plus the AI assistants, by hostname", () => {
    expect(mcpAllowedOriginHosts(["https://venviewer.com", "http://localhost:5173", "not a url"]).sort())
      .toEqual([...AI_ASSISTANT_ORIGIN_HOSTS, "venviewer.com", "localhost"].sort());
  });
});

describe("public MCP endpoint inside the real API server", () => {
  let server: FastifyInstance;
  const env = {
    NODE_ENV: "test", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/public_mcp_test",
    PORT: 3001, CORS_ORIGINS: "https://venviewer.com",
    EMAIL_FROM: "Venviewer <notifications@example.test>", VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE: "planner",
    SENTRY_TRACES_SAMPLE_RATE: 0, AI_ASSISTANT_ENABLED: "false",
  } satisfies Env;

  beforeAll(async () => {
    const { buildServer } = await import("../index.js");
    server = await buildServer(env);
  }, 180_000);

  afterAll(async () => {
    await server?.close();
  });

  function inject(body: object) {
    return server.inject({
      method: "POST", url: "/mcp",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      payload: body,
    });
  }

  it("is mounted at /mcp with the shared limiter, security headers and no caching", async () => {
    const response = await inject({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-ratelimit-limit"]).toBe(String(MCP_RATE_LIMIT_PER_MINUTE));
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain("check_availability");
  });

  it("answers an unreachable database with a plain message, never a stack trace", async () => {
    const initialize = await inject({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(initialize.statusCode).toBe(200);
    const response = await inject({
      jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_venue", arguments: {} },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("could not be read just now");
    expect(response.body).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|postgres|\\n\s+at\s/u);
  }, 180_000);
});
