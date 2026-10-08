import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  McpServer,
  createMcpHandler,
  originValidationResponse,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import type { PublicVenueProfile } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { zodToolSchema, type JsonSchemaDocument } from "../lib/standard-schema.js";
import {
  AVAILABILITY_HORIZON_DAYS,
  AVAILABILITY_MAX_SPAN_DAYS,
  PUBLIC_DISCOVERY_CACHE_TTL_MS,
  PublicDiscovery,
  drizzlePublicDiscoveryStore,
  inclusiveDayCount,
  isCalendarDate,
  type DiscoveryOutcome,
  type PublicDiscoveryStore,
} from "../services/public-discovery.js";

// ---------------------------------------------------------------------------
// POST /mcp — the public, read-only Model Context Protocol endpoint (T-649).
//
// Blake, 8 October 2026: AI assistants may find and query Trades Hall, "Yes,
// read-only": venue facts, room capacities from venue records, and free/busy
// dates only (no client names); enquiries still go through staff. A date with
// only a provisional hold answers "held" ("Say 'held, enquire'"). Three tools
// carry exactly that (services/public-discovery.ts owns the boundary).
//
// Transport: the 2026-07-28 revision is stateless, and @modelcontextprotocol/
// server v2's createMcpHandler serves it from a per-request server factory,
// answering 2025-era clients (initialize handshake) statelessly from the same
// factory. The handler is web-standard (Request → Response); this route
// converts once each way so the response runs through the API's own hooks:
// security headers, compression, request id, metrics and the rate limiter.
//
// Every response is finite: the server advertises no list-changed
// notifications, so a `subscriptions/listen` is acknowledged and closed at
// once, and the tools emit no progress, so 2026-era answers are single JSON
// bodies (the handler's default "auto" mode) rather than held-open streams.
// ---------------------------------------------------------------------------

export const MCP_PATH = "/mcp";
/** Requests are a few hundred bytes; anything larger is not a tool call. */
export const MCP_MAX_BODY_BYTES = 64 * 1024;
/** Per IP (the shared limiter's key for anonymous callers). Generous for a
 *  read: AI assistants call from shared cloud egress addresses, and the reads
 *  behind it are cached, so the limit guards CPU rather than the database. */
export const MCP_RATE_LIMIT_PER_MINUTE = 120;
/** Browser origins of AI assistants that may relay connector calls. Origin
 *  validation exists to stop DNS rebinding against private servers; this one
 *  is public and read-only, so admitting these costs nothing. */
export const AI_ASSISTANT_ORIGIN_HOSTS: readonly string[] = ["claude.ai", "claude.com", "chatgpt.com"];

const SERVER_VERSION = "1.0.0";
const ROOM_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ROOM_SLUG_MAX_LENGTH = 100;
const MAX_TOOL_INPUT_ELEMENTS = 32;
const TOOL_LIST_TTL_MS = 60 * 60_000;
const UNEXPECTED_TOOL_ERROR =
  "Something went wrong reading the venue's information. Please try again shortly, or contact the venue team directly.";

// Request headers that belong to this hop, not to the MCP exchange.
const REQUEST_HEADERS_NOT_FORWARDED: ReadonlySet<string> = new Set([
  "host", "connection", "keep-alive", "content-length", "transfer-encoding", "content-encoding",
]);
// Response headers Fastify computes itself for the body it sends.
const RESPONSE_HEADERS_NOT_FORWARDED: ReadonlySet<string> = new Set([
  "connection", "keep-alive", "content-length", "transfer-encoding", "content-encoding",
]);

// ---------------------------------------------------------------------------
// Tool contracts — Zod validates (the boundary); JSON Schema describes
// ---------------------------------------------------------------------------

type NonEmpty = readonly [string, ...string[]];

function nonEmptySlugs(venues: readonly PublicVenueProfile[]): NonEmpty {
  const [first, ...rest] = venues.map((venue) => venue.dbSlug);
  if (first === undefined) throw new Error("Public MCP needs at least one opted-in venue");
  return [first, ...rest];
}

const calendarDate = z
  .string()
  .max(10)
  .refine(isCalendarDate, { message: "Use a real date written as YYYY-MM-DD." });

/** The input contracts for one set of opted-in venues. Exported for tests. */
export function publicToolInputs(venues: readonly PublicVenueProfile[]) {
  const slugs = nonEmptySlugs(venues);
  const [defaultSlug] = slugs;
  // One fixed message for every other value: never echo what was asked, so a
  // second tenant's slug or id draws the same bytes as a name nobody uses.
  const unknownVenue = `Unknown venue. Only ${slugs.join(", ")} can be queried here.`;
  const venue = z.enum(slugs, { errorMap: () => ({ message: unknownVenue }) }).default(defaultSlug);
  const venueJson: JsonSchemaDocument = {
    type: "string",
    enum: [...slugs],
    default: defaultSlug,
    description: `Which venue. Only ${slugs.join(", ")} can be queried here.`,
  };
  const dateJson = (role: string): JsonSchemaDocument => ({
    type: "string",
    format: "date",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: `${role}, as YYYY-MM-DD in the venue's own time zone.`,
  });

  const getVenue = zodToolSchema(z.object({ venue }).strict(), {
    type: "object",
    properties: { venue: venueJson },
    additionalProperties: false,
  });

  const checkAvailability = zodToolSchema(
    z.object({
      venue,
      from: calendarDate,
      to: calendarDate,
      room: z.string().max(ROOM_SLUG_MAX_LENGTH).regex(ROOM_SLUG_PATTERN, {
        message: "Use a room slug from get_venue, such as grand-hall.",
      }).optional(),
    }).strict().superRefine((value, context) => {
      if (value.to < value.from) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "\"to\" must be on or after \"from\"." });
      } else if (inclusiveDayCount(value.from, value.to) > AVAILABILITY_MAX_SPAN_DAYS) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["to"],
          message: `Ask about at most ${String(AVAILABILITY_MAX_SPAN_DAYS)} days at a time; call again for later dates.`,
        });
      }
    }),
    {
      type: "object",
      properties: {
        venue: venueJson,
        from: dateJson("First date to check (today or later)"),
        to: dateJson(`Last date to check, at most ${String(AVAILABILITY_MAX_SPAN_DAYS)} days after "from" inclusive`),
        room: {
          type: "string",
          pattern: ROOM_SLUG_PATTERN.source,
          maxLength: ROOM_SLUG_MAX_LENGTH,
          description: "Optional room slug from get_venue (for example grand-hall). Omit it to check every room.",
        },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  );

  const howToEnquire = zodToolSchema(z.object({ venue }).strict(), {
    type: "object",
    properties: { venue: venueJson },
    additionalProperties: false,
  });

  return { getVenue, checkAvailability, howToEnquire };
}

// ---------------------------------------------------------------------------
// The per-request server
// ---------------------------------------------------------------------------

function toolResult(outcome: DiscoveryOutcome<object>): CallToolResult {
  if (!outcome.ok) return { content: [{ type: "text", text: outcome.message }], isError: true };
  return {
    content: [{ type: "text", text: JSON.stringify(outcome.value) }],
    structuredContent: outcome.value,
  };
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Builds the MCP server one request is served by. Exported for tests. */
export function buildPublicMcpServer(
  discovery: PublicDiscovery,
  onToolError: (tool: string, error: unknown) => void,
): McpServer {
  const names = discovery.venues.map((venue) => venue.name).join(", ");
  const enquiryPaths = discovery.venues.map((venue) => venue.enquiryUrl).join(", ");
  const inputs = publicToolInputs(discovery.venues);
  const cacheMinutes = String(Math.round(PUBLIC_DISCOVERY_CACHE_TTL_MS / 60_000));

  const server = new McpServer(
    {
      name: "venviewer-public-venues",
      title: `${names} — public venue information`,
      version: SERVER_VERSION,
      websiteUrl: "https://venviewer.com/",
      description: `Read-only public information about ${names}, published through Venviewer with the venue's agreement.`,
    },
    {
      instructions: `Read-only public information about ${names}, published through Venviewer with the venue's agreement: venue facts, rooms with their published capacities, and whether each date is free, held (someone has a provisional option) or busy. No client, event or booking details exist here. Nothing here can send an enquiry, hold a date or make a booking — for any of those, give the person the how_to_enquire details; the venue's own team handles every enquiry.`,
      // Nothing here ever changes mid-session, so advertise no list-changed
      // notifications: a subscription is acknowledged and closed at once.
      capabilities: { tools: { listChanged: false } },
      cacheHints: {
        "tools/list": { ttlMs: TOOL_LIST_TTL_MS, cacheScope: "public" },
        "server/discover": { ttlMs: TOOL_LIST_TTL_MS, cacheScope: "public" },
      },
      maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS,
    },
  );

  const guarded = async (tool: string, run: () => Promise<CallToolResult>): Promise<CallToolResult> => {
    try {
      return await run();
    } catch (error) {
      onToolError(tool, error);
      return { content: [{ type: "text", text: UNEXPECTED_TOOL_ERROR }], isError: true };
    }
  };

  server.registerTool(
    "get_venue",
    {
      title: "Venue facts, rooms and published capacities",
      description: `Public facts about ${names}: name, address, time zone, the official website, and every room with its recorded dimensions (metres, floor area) and the venue's own published capacities by layout — theatre, classroom, dinner and reception — each cited with its source. Where the venue publishes no figure, the capacity is null and marked "not published"; never estimate one from the dimensions. Read-only.`,
      inputSchema: inputs.getVenue,
      annotations: { title: "Venue facts", ...READ_ONLY },
    },
    async ({ venue }) => guarded("get_venue", async () => toolResult(await discovery.describe(venue))),
  );

  server.registerTool(
    "check_availability",
    {
      title: "Free, held or busy dates",
      description: `Whether each room at ${names} is free, held or busy on each date in a range: at most ${String(AVAILABILITY_MAX_SPAN_DAYS)} days per call, from today up to ${String(AVAILABILITY_HORIZON_DAYS)} days ahead, optionally for one room. Returns only "free", "held" or "busy" per room per date — never who booked or holds it, the event, its times, any option rank, amounts, decision dates, or how many bookings or holds there are. "busy" means a confirmed booking or a venue closure at some time that date. "held" means someone has a provisional option on that date: a second option may be possible, so the person should contact the venue team (${enquiryPaths}, or how_to_enquire). "free" means neither. Whatever the answer, the venue team confirms availability when someone enquires. Dates are venue-local (each runs 04:00 to 04:00, as the venue's diary counts a day). Answers can be up to ${cacheMinutes} minutes old. This cannot hold or book a date; use how_to_enquire.`,
      inputSchema: inputs.checkAvailability,
      annotations: { title: "Free, held or busy dates", ...READ_ONLY },
    },
    async ({ venue, from, to, room }) =>
      guarded("check_availability", async () => toolResult(await discovery.availability({ venue, from, to, room }))),
  );

  server.registerTool(
    "how_to_enquire",
    {
      title: "How to enquire",
      description: `How to send an enquiry to the events team at ${names}: the enquiry page, what to include, and the venue's published telephone, email and website. Enquiries go through the venue's staff; this service cannot submit an enquiry, place a hold or make a booking.`,
      inputSchema: inputs.howToEnquire,
      annotations: { title: "How to enquire", ...READ_ONLY },
    },
    async ({ venue }) => guarded("how_to_enquire", async () => Promise.resolve(toolResult(discovery.guide(venue)))),
  );

  return server;
}

// ---------------------------------------------------------------------------
// Origin policy and the Fastify mount
// ---------------------------------------------------------------------------

/** Hostnames whose browser Origin may call /mcp: the API's own CORS origins
 *  plus the AI assistants'. A request with no Origin (every server-side MCP
 *  client) is unaffected; any other Origin gets 403, per the Streamable HTTP
 *  transport's MUST. */
export function mcpAllowedOriginHosts(corsOrigins: readonly string[]): string[] {
  const hosts = new Set<string>(AI_ASSISTANT_ORIGIN_HOSTS);
  for (const origin of corsOrigins) {
    try {
      hosts.add(new URL(origin).hostname);
    } catch {
      // A malformed CORS entry admits nothing.
    }
  }
  return [...hosts];
}

function toWebRequest(request: FastifyRequest, signal: AbortSignal): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || REQUEST_HEADERS_NOT_FORWARDED.has(name)) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  const carriesBody = request.method === "POST" && request.body !== undefined;
  // A fixed base: the Host header is the caller's to choose and is not used.
  return new Request(new URL(request.url, "http://mcp.invalid"), {
    method: request.method,
    headers,
    signal,
    ...(carriesBody ? { body: JSON.stringify(request.body) } : {}),
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "unknown error";
}

export interface PublicMcpRouteOptions {
  /** The API database; ignored when a store is supplied. */
  readonly db?: Database;
  readonly store?: PublicDiscoveryStore;
  /** Opted-in venues; defaults to PUBLIC_DISCOVERY_VENUES. */
  readonly venues?: readonly PublicVenueProfile[];
  /** The API's CORS allowlist (env CORS_ORIGINS). */
  readonly corsOrigins: readonly string[];
  readonly now?: () => number;
}

export async function publicMcpRoutes(server: FastifyInstance, opts: PublicMcpRouteOptions): Promise<void> {
  const store = opts.store ?? (opts.db === undefined ? undefined : drizzlePublicDiscoveryStore(opts.db));
  if (store === undefined) throw new Error("publicMcpRoutes needs a database or a store");

  // Logs carry an event name and an error message only — never a request
  // body (tool arguments are dates and slugs, but the rule holds anyway).
  const discovery = new PublicDiscovery({
    store,
    venues: opts.venues,
    now: opts.now,
    onReadError: (error) => {
      server.log.error({ event: "mcp.read_failed", message: messageOf(error) }, "public venue read failed");
    },
  });
  const onToolError = (tool: string, error: unknown): void => {
    server.log.error({ event: "mcp.tool_failed", tool, message: messageOf(error) }, "public MCP tool failed");
  };

  const handler = createMcpHandler(() => buildPublicMcpServer(discovery, onToolError), {
    maxRequestBodySize: MCP_MAX_BODY_BYTES,
    keepAliveMs: 0,
    onerror: (error) => {
      server.log.warn({ event: "mcp.request_rejected", message: messageOf(error) }, "public MCP request rejected");
    },
  });
  server.addHook("onClose", async () => {
    await handler.close();
  });

  const allowedOriginHosts = mcpAllowedOriginHosts(opts.corsOrigins);

  server.route({
    method: ["GET", "POST", "DELETE"],
    url: MCP_PATH,
    bodyLimit: MCP_MAX_BODY_BYTES,
    config: { rateLimit: { max: MCP_RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" } },
    handler: async (request, reply) => {
      const abort = new AbortController();
      reply.raw.once("close", () => {
        if (!reply.raw.writableFinished) abort.abort();
      });
      const webRequest = toWebRequest(request, abort.signal);
      const response = originValidationResponse(webRequest, allowedOriginHosts)
        ?? await handler.fetch(webRequest, request.body === undefined ? {} : { parsedBody: request.body });

      reply.code(response.status);
      response.headers.forEach((value, name) => {
        if (!RESPONSE_HEADERS_NOT_FORWARDED.has(name)) reply.header(name, value);
      });
      // Answers depend on the live diary; intermediaries must not reuse them.
      reply.header("cache-control", "no-store");
      return reply.send(await response.text());
    },
  });
}
