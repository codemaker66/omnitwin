import Fastify, { type FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
  TRADES_HALL_ENQUIRY_VENUE_SLUG,
  proposalVersionPayloadDigest,
  type ProposalVersionPayload,
} from "@omnitwin/types";
import * as schema from "../db/schema.js";
import type { Database } from "../db/client.js";
import { enquiryRoutes } from "../routes/enquiries.js";
import { publicEnquiryRoutes } from "../routes/public-enquiries.js";
import { proposalRoutes, proposalShareRoutes } from "../routes/proposals.js";
import { bookingRoutes } from "../routes/bookings.js";
import { removeExpiredEngagementEvents, stampFirstResponse } from "../services/enquiry-funnel.js";

// ---------------------------------------------------------------------------
// The enquiry funnel (migration 0100) at the boundary that owns each
// guarantee, on a database migrated with the whole set as production holds it:
//
//   - the first reply: only the venue's own commercial team reports one; the
//     floor, customers, a Venviewer platform admin and another venue are
//     refused and nothing is written; a reply is never before its enquiry,
//     never in the future, never by someone off the venue's team; the stamp
//     only moves earlier, and concurrent writers agree on the earliest;
//     Venviewer's own decisions and sent proposals stamp it, never across
//     venues;
//   - proposal link visits: counted once per half hour, the first kept, a
//     link opened before counting left unknown, concurrent openings counted
//     once;
//   - engagement: only on an enquiry or proposal of the venue's, each moment
//     once, nothing about the person, gone after the retention period;
//   - attribution: the referring host and cleaned tags only, read into a
//     channel; Venviewer's own pages are not a source;
//   - viewings and lost reasons in the Diary.
//
// Opt-in, disposable loopback PostgreSQL only; never reads DATABASE_URL/.env:
//   VENVIEWER_ENQUIRY_FUNNEL_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/venviewer_enquiry_funnel_test
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const testUrl = process.env["VENVIEWER_ENQUIRY_FUNNEL_TEST_DATABASE_URL"];

function assertTestTarget(raw: string): void {
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_enquiry_funnel_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Enquiry funnel tests require the explicit loopback venviewer_enquiry_funnel_test database");
  }
}

describe("enquiry funnel PostgreSQL target guard", () => {
  it.each([
    "postgresql://user@production.example/venviewer_enquiry_funnel_test",
    "postgresql://postgres@127.0.0.1/production",
    "postgresql://postgres@127.0.0.1/venviewer_enquiry_funnel_test?host=production.example",
  ])("rejects an unsafe target: %s", (url) => {
    expect(() => { assertTestTarget(url); }).toThrow();
  });
});

const VERSION_PAYLOAD: ProposalVersionPayload = {
  schemaVersion: PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
  title: "Crawford wedding proposal",
  clientMessage: "Planning-grade proposal for your wedding on 5 June.",
  configurationId: null,
  layoutRevision: null,
  capacityNote: null,
  packageSummary: [],
  quote: null,
};

interface StampRow {
  readonly first_response_at: Date | null;
  readonly first_response_by: string | null;
  readonly first_response_channel: string | null;
  readonly first_response_recorded_at: Date | null;
}

interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

describe.skipIf(testUrl === undefined)("the enquiry funnel on migrated PostgreSQL (migration 0100)", () => {
  const run = randomUUID().slice(0, 8);
  const venue = randomUUID();
  const otherVenue = randomUUID();
  const hall = randomUUID();
  const saloon = randomUUID();
  const theirHall = randomUUID();
  const people = {
    admin: randomUUID(),
    manager: randomUUID(),
    staff: randomUUID(),
    sales: randomUUID(),
    hallkeeper: randomUUID(),
    otherManager: randomUUID(),
    otherStaff: randomUUID(),
    platformAdmin: randomUUID(),
    client: randomUUID(),
  } as const;
  const savedTwinSlugs = process.env["TWIN_PUBLIC_VENUE_SLUGS"];
  const savedSignals = process.env["ENQUIRY_FUNNEL_BROWSER_SIGNALS"];

  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;

  function as(role: string, venueId: string | null, id: string, platformRole = "none"): Record<string, string> {
    return { authorization: `Bearer ${JSON.stringify({ id, email: `${role}-${run}@example.test`, role, platformRole, venueId })}` };
  }
  const asStaff = (): Record<string, string> => as("staff", venue, people.staff);
  const asSales = (): Record<string, string> => as("sales", venue, people.sales);

  async function call(method: "GET" | "POST" | "PATCH", url: string, headers: Record<string, string>, payload?: Record<string, unknown>): Promise<Reply> {
    const res = await server.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
    const text = res.body;
    return { status: res.statusCode, body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>) };
  }

  async function newEnquiry(options: {
    readonly venueId?: string;
    readonly spaceId?: string;
    readonly roomChosen?: boolean;
    readonly state?: string;
    readonly createdAt?: Date;
    readonly userId?: string;
    readonly eventType?: string;
    /** When it was sent, as its status history records it. */
    readonly sentAt?: Date;
  } = {}): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO enquiries (id, venue_id, space_id, state, name, email, created_at, updated_at, room_chosen, source, user_id, event_type)
       VALUES ($1, $2, $3, $4, 'Fixture guest', 'guest@example.test', $5, $5, $6, 'website', $7, $8)`,
      [id, options.venueId ?? venue, options.spaceId ?? hall, options.state ?? "submitted",
        options.createdAt ?? new Date(Date.now() - 3 * 3_600_000), options.roomChosen ?? true,
        options.userId ?? null, options.eventType ?? null],
    );
    if (options.sentAt !== undefined) {
      await pool.query(
        "INSERT INTO enquiry_status_history (enquiry_id, from_status, to_status, created_at) VALUES ($1, 'draft', 'submitted', $2)",
        [id, options.sentAt],
      );
    }
    return id;
  }

  async function stampOf(enquiryId: string): Promise<StampRow> {
    const { rows } = await pool.query<StampRow>(
      "SELECT first_response_at, first_response_by, first_response_channel, first_response_recorded_at FROM enquiries WHERE id = $1",
      [enquiryId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error("no such enquiry");
    return row;
  }

  function report(headers: Record<string, string>, enquiryId: string, body: Record<string, unknown>): Promise<Reply> {
    return call("POST", `/enquiries/${enquiryId}/first-response`, headers, body);
  }

  async function sqlState(statement: string, values: readonly unknown[]): Promise<string | undefined> {
    try {
      await pool.query(statement, [...values]);
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  }

  function hashToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }

  /** A proposal of `venueId`, with one saved version, sent or still a draft,
   *  and a client link. */
  async function newProposal(options: {
    readonly venueId?: string;
    readonly enquiryId?: string | null;
    readonly opportunityId?: string | null;
    readonly sent?: boolean;
  } = {}): Promise<{ readonly id: string; readonly token: string; readonly tokenId: string }> {
    const id = randomUUID();
    const sent = options.sent ?? true;
    await pool.query(
      `INSERT INTO proposals (id, venue_id, enquiry_id, opportunity_id, title, status, current_version, sent_at, sent_version, created_by)
       VALUES ($1, $2, $3, $4, 'Crawford wedding proposal', $5, 1, $6, $7, $8)`,
      [id, options.venueId ?? venue, options.enquiryId ?? null, options.opportunityId ?? null,
        sent ? "sent" : "draft", sent ? new Date() : null, sent ? 1 : null, people.staff],
    );
    await pool.query(
      "INSERT INTO proposal_versions (proposal_id, version, payload, coordinate_space, source_hash) VALUES ($1, 1, $2, 'real_m_v1', $3)",
      [id, JSON.stringify(VERSION_PAYLOAD), proposalVersionPayloadDigest(VERSION_PAYLOAD)],
    );
    const token = `funnelToken_${randomUUID().replaceAll("-", "")}`;
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO proposal_share_tokens (proposal_id, token_hash, token_prefix) VALUES ($1, $2, 'funnel') RETURNING id",
      [id, hashToken(token)],
    );
    const tokenId = rows[0]?.id;
    if (tokenId === undefined) throw new Error("no token row");
    return { id, token, tokenId };
  }

  beforeAll(async () => {
    if (testUrl === undefined) throw new Error("Explicit test URL required");
    assertTestTarget(testUrl);
    process.env["TWIN_PUBLIC_VENUE_SLUGS"] = TRADES_HALL_ENQUIRY_VENUE_SLUG;
    // The suite reads what a browser sends; one case turns it off again.
    process.env["ENQUIRY_FUNNEL_BROWSER_SIGNALS"] = "on";
    pool = new Pool({ connectionString: testUrl, application_name: `enquiry_funnel_${run}`, max: 24 });
    const target = await pool.query<{ database: string }>("SELECT current_database() AS database");
    expect(target.rows[0]?.database).toBe("venviewer_enquiry_funnel_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });

    // The public routes resolve Trades Hall by its database slug, so the
    // fixture venue takes it; a rerun on the same database moves the last
    // run's venue aside first.
    await pool.query("UPDATE venues SET slug = slug || '-old-' || left(id::text, 8) WHERE slug = $1", [TRADES_HALL_ENQUIRY_VENUE_SLUG]);
    await db.insert(schema.venues).values([
      { id: venue, name: "TEST ONLY Trades Hall", slug: TRADES_HALL_ENQUIRY_VENUE_SLUG, address: "Disposable fixture", timezone: "Europe/London" },
      { id: otherVenue, name: "TEST ONLY elsewhere", slug: `funnel-other-${run}`, address: "Disposable fixture", timezone: "Europe/London" },
    ]);
    const room = (id: string, venueId: string, name: string, slug: string, sortOrder: number) => ({
      id, venueId, name, slug, sortOrder, widthM: "21.00", lengthM: "10.50", heightM: "7.00",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
    });
    await db.insert(schema.spaces).values([
      room(hall, venue, "Grand Hall", "grand-hall", 0),
      room(saloon, venue, "Saloon", "saloon", 1),
      room(theirHall, otherVenue, "Their Hall", "grand-hall", 0),
    ]);
    const person = (id: string, role: string, venueId: string | null, platformRole = "none") => ({
      id, venueId, role, platformRole, name: `${role} ${run}`, email: `${role}-${id.slice(0, 8)}@example.test`,
    });
    await db.insert(schema.users).values([
      person(people.admin, "admin", venue),
      person(people.manager, "manager", venue),
      person(people.staff, "staff", venue),
      person(people.sales, "sales", venue),
      person(people.hallkeeper, "hallkeeper", venue),
      person(people.otherManager, "manager", otherVenue),
      person(people.otherStaff, "staff", otherVenue),
      person(people.platformAdmin, "admin", null, "admin"),
      person(people.client, "client", null),
    ]);

    server = Fastify();
    await server.register(enquiryRoutes, { db, prefix: "/enquiries" });
    await server.register(publicEnquiryRoutes, { db, prefix: "/public" });
    await server.register(proposalRoutes, { db, prefix: "/proposals" });
    await server.register(proposalShareRoutes, { db, prefix: "/proposal-share" });
    await server.register(bookingRoutes, { db, prefix: "/bookings" });
    await server.ready();
  }, 300_000);

  afterAll(async () => {
    if (savedTwinSlugs === undefined) delete process.env["TWIN_PUBLIC_VENUE_SLUGS"];
    else process.env["TWIN_PUBLIC_VENUE_SLUGS"] = savedTwinSlugs;
    if (savedSignals === undefined) delete process.env["ENQUIRY_FUNNEL_BROWSER_SIGNALS"];
    else process.env["ENQUIRY_FUNNEL_BROWSER_SIGNALS"] = savedSignals;
    await server?.close();
    await pool?.end();
  }, 60_000);

  // -------------------------------------------------------------------------
  // The first reply: who may report it
  // -------------------------------------------------------------------------

  it("lets the venue's own commercial team report a reply, each named as the person who replied", async () => {
    for (const [role, id] of [["admin", people.admin], ["manager", people.manager], ["staff", people.staff], ["sales", people.sales]] as const) {
      const enquiryId = await newEnquiry();
      const res = await report(as(role, venue, id), enquiryId, { channel: "email" });
      expect(res.status, role).toBe(200);
      expect(res.body["data"]).toMatchObject({ enquiryId, changed: true, firstResponse: { byUserId: id, channel: "email" } });
      const stamp = await stampOf(enquiryId);
      expect(stamp.first_response_by).toBe(id);
      expect(stamp.first_response_channel).toBe("email");
      // A reply reported now was made now and recorded now.
      expect(stamp.first_response_at?.getTime()).toBe(stamp.first_response_recorded_at?.getTime());
    }
  });

  it("refuses the floor, customers, a Venviewer platform admin and another venue, and writes nothing", async () => {
    const enquiryId = await newEnquiry();
    const refused = [
      as("hallkeeper", venue, people.hallkeeper),
      as("planner", venue, randomUUID()),
      as("client", venue, randomUUID()),
      as("caterer", venue, randomUUID()),
      as("admin", null, people.platformAdmin, "admin"),
      as("manager", otherVenue, people.otherManager),
      as("staff", otherVenue, people.otherStaff),
    ];
    for (const headers of refused) {
      expect((await report(headers, enquiryId, { channel: "phone" })).status).toBe(403);
    }
    expect(await stampOf(enquiryId)).toMatchObject({ first_response_at: null, first_response_channel: null });
    const audit = await pool.query("SELECT count(*)::int AS n FROM general_audit_log WHERE target_id = $1", [enquiryId]);
    expect(audit.rows[0]).toEqual({ n: 0 });
  });

  it("answers 404 for an unknown enquiry and 400 for a malformed request", async () => {
    expect((await report(asStaff(), randomUUID(), { channel: "email" })).status).toBe(404);
    expect((await call("POST", "/enquiries/not-a-uuid/first-response", asStaff(), { channel: "email" })).status).toBe(400);
    const enquiryId = await newEnquiry();
    // A channel only Venviewer itself records, an unknown channel, an extra field, nothing.
    for (const body of [{ channel: "proposal" }, { channel: "decision" }, { channel: "carrier_pigeon" }, { channel: "email", note: "x" }, {}]) {
      expect((await report(asStaff(), enquiryId, body)).status).toBe(400);
    }
    expect((await stampOf(enquiryId)).first_response_at).toBeNull();
  });

  it("refuses a reply before the enquiry arrived, in the future, to a draft, or by someone off the venue's team", async () => {
    const arrived = new Date(Date.now() - 2 * 3_600_000);
    const enquiryId = await newEnquiry({ createdAt: arrived });
    const before = await report(asStaff(), enquiryId, { channel: "email", respondedAt: new Date(arrived.getTime() - 60_000).toISOString() });
    expect(before).toMatchObject({ status: 422, body: { code: "FIRST_RESPONSE_BEFORE_ENQUIRY" } });
    const future = await report(asStaff(), enquiryId, { channel: "email", respondedAt: new Date(Date.now() + 10 * 60_000).toISOString() });
    expect(future).toMatchObject({ status: 422, body: { code: "FIRST_RESPONSE_IN_FUTURE" } });
    for (const respondedBy of [people.otherManager, people.hallkeeper, randomUUID()]) {
      const offTeam = await report(asStaff(), enquiryId, { channel: "phone", respondedBy });
      expect(offTeam).toMatchObject({ status: 422, body: { code: "RESPONDER_NOT_AT_VENUE" } });
    }
    const draft = await newEnquiry({ state: "draft" });
    expect(await report(asStaff(), draft, { channel: "email" })).toMatchObject({ status: 422, body: { code: "ENQUIRY_NOT_SENT" } });
    expect((await stampOf(enquiryId)).first_response_at).toBeNull();
    expect((await stampOf(draft)).first_response_at).toBeNull();
  });

  it("measures from when the enquiry was sent, not when its draft was made", async () => {
    const drafted = new Date(Date.now() - 48 * 3_600_000);
    const sent = new Date(Date.now() - 24 * 3_600_000);
    const enquiryId = await newEnquiry({ createdAt: drafted, sentAt: sent });
    const between = await report(asStaff(), enquiryId, { channel: "email", respondedAt: new Date(sent.getTime() - 3_600_000).toISOString() });
    expect(between).toMatchObject({ status: 422, body: { code: "FIRST_RESPONSE_BEFORE_ENQUIRY" } });
    const after = await report(asStaff(), enquiryId, { channel: "email", respondedAt: new Date(sent.getTime() + 3_600_000).toISOString() });
    expect(after.status).toBe(200);
  });

  it("leaves a reply more than a week old to the venue's admin or manager", async () => {
    const arrived = new Date(Date.now() - 10 * 86_400_000);
    const enquiryId = await newEnquiry({ createdAt: arrived, sentAt: arrived });
    const nineDaysAgo = new Date(Date.now() - 9 * 86_400_000).toISOString();
    for (const headers of [asStaff(), asSales()]) {
      expect(await report(headers, enquiryId, { channel: "phone", respondedAt: nineDaysAgo }))
        .toMatchObject({ status: 422, body: { code: "FIRST_RESPONSE_TOO_OLD" } });
    }
    expect((await stampOf(enquiryId)).first_response_at).toBeNull();
    expect((await report(as("manager", venue, people.manager), enquiryId, { channel: "phone", respondedAt: nineDaysAgo })).status).toBe(200);
    // Within the week anyone on the team may.
    const recent = await newEnquiry({ createdAt: new Date(Date.now() - 5 * 86_400_000) });
    expect((await report(asSales(), recent, { channel: "phone", respondedAt: new Date(Date.now() - 4 * 86_400_000).toISOString() })).status).toBe(200);
  });

  it("records a colleague who replied, a time a little fast as now, and a reply made exactly as it arrived", async () => {
    const enquiryId = await newEnquiry();
    const colleague = await report(asStaff(), enquiryId, { channel: "phone", respondedBy: people.sales });
    expect(colleague.status).toBe(200);
    expect((await stampOf(enquiryId)).first_response_by).toBe(people.sales);

    // A phone a minute fast: within the allowed skew, recorded as the server's now.
    const fast = await newEnquiry();
    const res = await report(asStaff(), fast, { channel: "email", respondedAt: new Date(Date.now() + 60_000).toISOString() });
    expect(res.status).toBe(200);
    const stamp = await stampOf(fast);
    expect(stamp.first_response_at?.getTime()).toBeLessThanOrEqual(stamp.first_response_recorded_at?.getTime() ?? 0);

    const arrived = new Date(Date.now() - 3_600_000);
    const exact = await newEnquiry({ createdAt: arrived });
    expect((await report(asStaff(), exact, { channel: "in_person", respondedAt: arrived.toISOString() })).status).toBe(200);
    expect((await stampOf(exact)).first_response_at?.getTime()).toBe(arrived.getTime());
  });

  // -------------------------------------------------------------------------
  // The first reply: only ever earlier, whatever order writers arrive in
  // -------------------------------------------------------------------------

  it("keeps the earliest reply: a later one changes nothing, an earlier one replaces it whole, and each report is audited", async () => {
    const arrived = new Date(Date.now() - 5 * 3_600_000);
    const enquiryId = await newEnquiry({ createdAt: arrived });
    const at = (hours: number): string => new Date(arrived.getTime() + hours * 3_600_000).toISOString();

    const second = await report(asStaff(), enquiryId, { channel: "email", respondedAt: at(2) });
    expect(second.body["data"]).toMatchObject({ changed: true, firstResponse: { at: at(2), channel: "email", byUserId: people.staff } });
    const third = await report(asSales(), enquiryId, { channel: "phone", respondedAt: at(3) });
    expect(third.body["data"]).toMatchObject({ changed: false, firstResponse: { at: at(2), channel: "email", byUserId: people.staff } });
    const first = await report(asSales(), enquiryId, { channel: "phone", respondedAt: at(1) });
    expect(first.body["data"]).toMatchObject({ changed: true, firstResponse: { at: at(1), channel: "phone", byUserId: people.sales } });

    const stamp = await stampOf(enquiryId);
    expect(stamp.first_response_at?.toISOString()).toBe(at(1));
    expect(stamp.first_response_channel).toBe("phone");
    expect(stamp.first_response_by).toBe(people.sales);
    // Reported after it happened: recorded later than made.
    expect(stamp.first_response_recorded_at?.getTime()).toBeGreaterThan(stamp.first_response_at?.getTime() ?? 0);

    const audit = await pool.query<{ actor_user_id: string; changed: boolean; previous: { at: string; channel: string } | null; responded: string }>(
      `SELECT actor_user_id, (metadata->>'changed')::boolean AS changed, metadata->'previous' AS previous, metadata->>'respondedAt' AS responded
       FROM general_audit_log WHERE target_type = 'enquiry' AND target_id = $1 AND action = 'enquiry.first_response_reported'`,
      [enquiryId],
    );
    expect(audit.rows.map((row) => row.changed).sort()).toEqual([false, true, true]);
    expect(audit.rows.filter((row) => row.actor_user_id === people.sales)).toHaveLength(2);
    // The report that replaced the 2-hour reply says so: what it displaced is kept.
    const replacing = audit.rows.find((row) => row.responded === at(1));
    expect(replacing?.previous).toMatchObject({ at: at(2), channel: "email" });
    expect(audit.rows.find((row) => row.responded === at(2))?.previous).toBeNull();
  });

  it("agrees on the earliest reply when many people report at once, with who and how kept from the same report", async () => {
    const arrived = new Date(Date.now() - 4 * 3_600_000);
    const enquiryId = await newEnquiry({ createdAt: arrived });
    const reporters = [
      { headers: as("admin", venue, people.admin), by: people.admin },
      { headers: as("manager", venue, people.manager), by: people.manager },
      { headers: asStaff(), by: people.staff },
      { headers: asSales(), by: people.sales },
    ];
    const channels = ["email", "phone", "in_person", "video_call", "text_message"] as const;
    // Sixteen reports with distinct times through the afternoon, sent together in a shuffled order.
    const reports = Array.from({ length: 16 }, (_, index) => {
      const reporter = reporters[index % reporters.length];
      if (reporter === undefined) throw new Error("no reporter");
      return {
        ...reporter,
        channel: channels[index % channels.length] ?? "email",
        respondedAt: new Date(arrived.getTime() + (10 + ((index * 5) % 16) * 7) * 60_000),
      };
    }).sort(() => Math.random() - 0.5);
    const earliest = reports.reduce((best, entry) => (entry.respondedAt < best.respondedAt ? entry : best));

    const replies = await Promise.all(reports.map((entry) =>
      report(entry.headers, enquiryId, { channel: entry.channel, respondedAt: entry.respondedAt.toISOString() })));
    expect(replies.every((res) => res.status === 200)).toBe(true);

    const stamp = await stampOf(enquiryId);
    expect(stamp.first_response_at?.getTime()).toBe(earliest.respondedAt.getTime());
    expect(stamp.first_response_channel).toBe(earliest.channel);
    expect(stamp.first_response_by).toBe(earliest.by);
    // No caller was told a reply earlier than the one that stands.
    for (const res of replies) {
      const data = res.body["data"] as { firstResponse: { at: string } };
      expect(Date.parse(data.firstResponse.at)).toBeGreaterThanOrEqual(earliest.respondedAt.getTime());
    }
  }, 60_000);

  it("keeps the earliest when Venviewer's own replies race people's reports on separate connections", async () => {
    const arrived = new Date(Date.now() - 6 * 3_600_000);
    const enquiryId = await newEnquiry({ createdAt: arrived });
    const reported = Array.from({ length: 20 }, (_, index) => new Date(arrived.getTime() + (index + 1) * 11 * 60_000));
    const writes = [
      ...reported.map((at, index) => stampFirstResponse(db, {
        enquiryId, venueId: venue, at, byUserId: index % 2 === 0 ? people.staff : people.sales, channel: "phone",
      })),
      ...Array.from({ length: 4 }, () => stampFirstResponse(db, {
        enquiryId, venueId: venue, at: "now", byUserId: people.admin, channel: "decision",
      })),
    ];
    const results = await Promise.all(writes);
    expect(results.some((result) => result.changed)).toBe(true);
    const stamp = await stampOf(enquiryId);
    expect(stamp.first_response_at?.getTime()).toBe(reported[0]?.getTime());
    expect(stamp.first_response_channel).toBe("phone");
    expect(stamp.first_response_by).toBe(people.staff);
    // Another venue's id never stamps it, whatever the time.
    const foreign = await stampFirstResponse(db, {
      enquiryId, venueId: otherVenue, at: new Date(arrived.getTime() + 60_000), byUserId: people.otherManager, channel: "email",
    });
    expect(foreign).toEqual({ changed: false, stamp: null });
    expect((await stampOf(enquiryId)).first_response_at?.getTime()).toBe(reported[0]?.getTime());
  }, 60_000);

  it("re-checks a waiting write against the reply that committed first, in both orders", async () => {
    // Two transactions on their own connections. The first stamps and holds
    // its row lock; the second's UPDATE waits on it; when the first commits,
    // PostgreSQL re-evaluates the second's WHERE against the committed row.
    const race = async (firstAt: Date, secondAt: Date): Promise<StampRow> => {
      const enquiryId = await newEnquiry({ createdAt: new Date(Math.min(firstAt.getTime(), secondAt.getTime()) - 60_000) });
      const one = await pool.connect();
      const two = await pool.connect();
      try {
        await one.query("BEGIN");
        await two.query("BEGIN");
        await stampFirstResponse(drizzle(one, { schema }), { enquiryId, venueId: venue, at: firstAt, byUserId: people.staff, channel: "email" });
        const waiting = stampFirstResponse(drizzle(two, { schema }), { enquiryId, venueId: venue, at: secondAt, byUserId: people.sales, channel: "phone" });
        // The second really is blocked on the first's lock before it commits.
        await new Promise((resolve) => { setTimeout(resolve, 300); });
        const blocked = await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'update \"enquiries\"%'",
        );
        expect(blocked.rows[0]?.n).toBeGreaterThanOrEqual(1);
        await one.query("COMMIT");
        await waiting;
        await two.query("COMMIT");
      } finally {
        one.release();
        two.release();
      }
      return stampOf(enquiryId);
    };
    const early = new Date(Date.now() - 2 * 3_600_000);
    const late = new Date(Date.now() - 3_600_000);
    // The later reply committed first; the earlier one, waiting, replaces it.
    const laterFirst = await race(late, early);
    expect(laterFirst.first_response_at?.getTime()).toBe(early.getTime());
    expect(laterFirst).toMatchObject({ first_response_channel: "phone", first_response_by: people.sales });
    // The earlier reply committed first; the later one, waiting, changes nothing.
    const earlierFirst = await race(early, late);
    expect(earlierFirst.first_response_at?.getTime()).toBe(early.getTime());
    expect(earlierFirst).toMatchObject({ first_response_channel: "email", first_response_by: people.staff });
  }, 60_000);

  it("never lets the database hold a partial or impossible reply", async () => {
    const enquiryId = await newEnquiry();
    // Time without channel, channel without time, a person with no reply.
    expect(await sqlState("UPDATE enquiries SET first_response_at = now() WHERE id = $1", [enquiryId])).toBe("23514");
    expect(await sqlState("UPDATE enquiries SET first_response_channel = 'email' WHERE id = $1", [enquiryId])).toBe("23514");
    expect(await sqlState("UPDATE enquiries SET first_response_by = $2 WHERE id = $1", [enquiryId, people.staff])).toBe("23514");
    // Before the enquiry arrived, recorded before it was made, an unknown channel.
    expect(await sqlState(
      "UPDATE enquiries SET first_response_at = created_at - interval '1 minute', first_response_channel = 'email', first_response_recorded_at = now() WHERE id = $1",
      [enquiryId],
    )).toBe("23514");
    expect(await sqlState(
      "UPDATE enquiries SET first_response_at = now(), first_response_channel = 'email', first_response_recorded_at = now() - interval '1 minute' WHERE id = $1",
      [enquiryId],
    )).toBe("23514");
    expect(await sqlState(
      "UPDATE enquiries SET first_response_at = now(), first_response_channel = 'fax', first_response_recorded_at = now() WHERE id = $1",
      [enquiryId],
    )).toBe("23514");
  });

  // -------------------------------------------------------------------------
  // Replies Venviewer sends itself
  // -------------------------------------------------------------------------

  it("records the venue's decision as the first reply, and an earlier reported reply still replaces it", async () => {
    const arrived = new Date(Date.now() - 2 * 3_600_000);
    const enquiryId = await newEnquiry({ createdAt: arrived });
    const review = await call("POST", `/enquiries/${enquiryId}/transition`, asStaff(), { status: "under_review" });
    expect(review.status).toBe(200);
    // Reviewing is not replying.
    expect((await stampOf(enquiryId)).first_response_at).toBeNull();
    const approve = await call("POST", `/enquiries/${enquiryId}/transition`, asStaff(), { status: "approved" });
    expect(approve.status).toBe(200);
    expect(approve.body["data"]).toMatchObject({ firstResponseChannel: "decision", firstResponseBy: people.staff });
    const decided = await stampOf(enquiryId);
    expect(decided.first_response_channel).toBe("decision");
    expect(decided.first_response_at?.getTime()).toBe(decided.first_response_recorded_at?.getTime());

    const earlier = new Date(arrived.getTime() + 20 * 60_000);
    const res = await report(asSales(), enquiryId, { channel: "phone", respondedAt: earlier.toISOString() });
    expect(res.body["data"]).toMatchObject({ changed: true });
    expect((await stampOf(enquiryId)).first_response_channel).toBe("phone");
  });

  it("names nobody when a Venviewer operator, not the venue's team, makes the decision", async () => {
    const enquiryId = await newEnquiry({ state: "under_review" });
    const approve = await call("POST", `/enquiries/${enquiryId}/transition`, as("admin", null, people.platformAdmin, "admin"), { status: "approved" });
    expect(approve.status).toBe(200);
    expect(await stampOf(enquiryId)).toMatchObject({ first_response_channel: "decision", first_response_by: null });
  });

  it("shows the venue's funnel fields to its team and never to the enquiry's customer", async () => {
    const enquiryId = await newEnquiry({ userId: people.client });
    expect((await report(asStaff(), enquiryId, { channel: "email" })).status).toBe(200);
    const asClient = as("client", null, people.client);
    const own = await call("GET", `/enquiries/${enquiryId}`, asClient);
    expect(own.status).toBe(200);
    const data = own.body["data"] as Record<string, unknown>;
    for (const field of ["firstResponseAt", "firstResponseBy", "firstResponseChannel", "firstResponseRecordedAt", "referrerHost", "utmSource", "acquisitionChannel"]) {
      expect(data, field).not.toHaveProperty(field);
    }
    expect(data).toMatchObject({ id: enquiryId, state: "submitted" });
    const listed = await call("GET", "/enquiries", asClient);
    expect((listed.body["data"] as Record<string, unknown>[]).every((row) => !("firstResponseAt" in row))).toBe(true);
    const staffView = await call("GET", `/enquiries/${enquiryId}`, asStaff());
    expect(staffView.body["data"]).toMatchObject({ firstResponseChannel: "email", firstResponseBy: people.staff });
  });

  it("records a proposal sent as the first reply to its enquiry, or its deal's enquiry, never another venue's", async () => {
    // The proposal carries the enquiry.
    const carried = await newEnquiry();
    const direct = await newProposal({ enquiryId: carried, sent: false });
    const sent = await call("POST", `/proposals/${direct.id}/transition`, asStaff(), { status: "sent" });
    expect(sent.status).toBe(200);
    expect(await stampOf(carried)).toMatchObject({ first_response_channel: "proposal", first_response_by: people.staff });

    // The proposal's deal carries it.
    const viaDeal = await newEnquiry();
    const deal = randomUUID();
    await pool.query(
      "INSERT INTO opportunities (id, venue_id, source_enquiry_id, title) VALUES ($1, $2, $3, 'Crawford wedding')",
      [deal, venue, viaDeal],
    );
    const dealProposal = await newProposal({ opportunityId: deal, sent: false });
    expect((await call("POST", `/proposals/${dealProposal.id}/transition`, asSales(), { status: "sent" })).status).toBe(200);
    expect((await stampOf(viaDeal)).first_response_channel).toBe("proposal");

    // A proposal of this venue pointing at another venue's enquiry replies to nobody.
    const theirs = await newEnquiry({ venueId: otherVenue, spaceId: theirHall });
    const stray = await newProposal({ enquiryId: theirs, sent: false });
    expect((await call("POST", `/proposals/${stray.id}/transition`, asStaff(), { status: "sent" })).status).toBe(200);
    expect((await stampOf(theirs)).first_response_at).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Proposal link visits
  // -------------------------------------------------------------------------

  async function views(tokenId: string): Promise<{ view_count: number | null; first_viewed_at: Date | null; last_viewed_at: Date | null }> {
    const { rows } = await pool.query<{ view_count: number | null; first_viewed_at: Date | null; last_viewed_at: Date | null }>(
      "SELECT view_count, first_viewed_at, last_viewed_at FROM proposal_share_tokens WHERE id = $1",
      [tokenId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error("no token");
    return row;
  }

  it("counts a link's visits half an hour apart and keeps its first", async () => {
    const proposal = await newProposal();
    expect(await views(proposal.tokenId)).toMatchObject({ view_count: 0, first_viewed_at: null, last_viewed_at: null });
    for (let open = 0; open < 3; open += 1) {
      expect((await call("GET", `/proposal-share/${proposal.token}`, {})).status).toBe(200);
    }
    const once = await views(proposal.tokenId);
    expect(once.view_count).toBe(1);
    expect(once.first_viewed_at).not.toBeNull();

    // The last opening slid back past the visit gap: the next is a new visit.
    await pool.query(
      "UPDATE proposal_share_tokens SET last_viewed_at = last_viewed_at - interval '31 minutes', first_viewed_at = first_viewed_at - interval '31 minutes' WHERE id = $1",
      [proposal.tokenId],
    );
    const firstBefore = (await views(proposal.tokenId)).first_viewed_at;
    expect((await call("GET", `/proposal-share/${proposal.token}`, {})).status).toBe(200);
    const twice = await views(proposal.tokenId);
    expect(twice.view_count).toBe(2);
    expect(twice.first_viewed_at?.getTime()).toBe(firstBefore?.getTime());
    expect(twice.last_viewed_at?.getTime()).toBeGreaterThan(twice.first_viewed_at?.getTime() ?? 0);
  });

  it("counts many openings at once as one visit", async () => {
    const proposal = await newProposal();
    const opened = await Promise.all(Array.from({ length: 12 }, () => call("GET", `/proposal-share/${proposal.token}`, {})));
    expect(opened.every((res) => res.status === 200)).toBe(true);
    expect(await views(proposal.tokenId)).toMatchObject({ view_count: 1 });
  }, 60_000);

  it("leaves a link opened before counting began unknown, rather than calling a later visit its first", async () => {
    // Opened before migration 0100: the migration left both unknown.
    const before = await newProposal();
    await pool.query("UPDATE proposal_share_tokens SET last_viewed_at = now() - interval '2 days', view_count = NULL WHERE id = $1", [before.tokenId]);
    // Opened by the release before this one while 0100 was already applied.
    const between = await newProposal();
    await pool.query("UPDATE proposal_share_tokens SET last_viewed_at = now() - interval '2 hours' WHERE id = $1", [between.tokenId]);
    for (const proposal of [before, between]) {
      expect((await call("GET", `/proposal-share/${proposal.token}`, {})).status).toBe(200);
      const after = await views(proposal.tokenId);
      expect(after.view_count).toBeNull();
      expect(after.first_viewed_at).toBeNull();
      expect(Date.now() - (after.last_viewed_at?.getTime() ?? 0)).toBeLessThan(60_000);
    }
    // The database refuses a count with no first visit, or a first with no count.
    expect(await sqlState("UPDATE proposal_share_tokens SET view_count = 3 WHERE id = $1", [before.tokenId])).toBe("23514");
    expect(await sqlState("UPDATE proposal_share_tokens SET first_viewed_at = now() - interval '1 day', view_count = 0 WHERE id = $1", [between.tokenId])).toBe("23514");
  });

  it("does not count a refused opening: a revoked link or an unsent proposal", async () => {
    const revoked = await newProposal();
    await pool.query("UPDATE proposal_share_tokens SET revoked_at = now() WHERE id = $1", [revoked.tokenId]);
    expect((await call("GET", `/proposal-share/${revoked.token}`, {})).status).toBe(404);
    expect(await views(revoked.tokenId)).toMatchObject({ view_count: 0, last_viewed_at: null });
    const draft = await newProposal({ sent: false });
    expect((await call("GET", `/proposal-share/${draft.token}`, {})).status).toBe(404);
    expect(await views(draft.tokenId)).toMatchObject({ view_count: 0, last_viewed_at: null });
  });

  // -------------------------------------------------------------------------
  // Engagement, only on an enquiry or proposal of the venue's
  // -------------------------------------------------------------------------

  it("records a walk on the proposal it came from, once per window, however many reports arrive together", async () => {
    const proposal = await newProposal();
    const reports = await Promise.all(Array.from({ length: 8 }, () =>
      call("POST", `/proposal-share/${proposal.token}/engagement`, {}, { kind: "twin_walk_30s" })));
    expect(reports.every((res) => res.status === 200)).toBe(true);
    expect(reports.filter((res) => (res.body["data"] as { recorded: boolean }).recorded)).toHaveLength(1);
    const rows = await pool.query("SELECT venue_id, kind, enquiry_id, proposal_id FROM venue_engagement_events WHERE proposal_id = $1", [proposal.id]);
    expect(rows.rows).toEqual([{ venue_id: venue, kind: "twin_walk_30s", enquiry_id: null, proposal_id: proposal.id }]);

    // Past the window the same walk is a new moment.
    await pool.query("UPDATE venue_engagement_events SET recorded_at = recorded_at - interval '31 minutes' WHERE proposal_id = $1", [proposal.id]);
    const later = await call("POST", `/proposal-share/${proposal.token}/engagement`, {}, { kind: "twin_walk_30s" });
    expect(later.body["data"]).toEqual({ recorded: true });
  }, 60_000);

  it("refuses engagement for a link that opens nothing, and a malformed report", async () => {
    const revoked = await newProposal();
    await pool.query("UPDATE proposal_share_tokens SET revoked_at = now() WHERE id = $1", [revoked.tokenId]);
    expect((await call("POST", `/proposal-share/${revoked.token}/engagement`, {}, { kind: "twin_walk_30s" })).status).toBe(404);
    const draft = await newProposal({ sent: false });
    expect((await call("POST", `/proposal-share/${draft.token}/engagement`, {}, { kind: "twin_walk_30s" })).status).toBe(404);
    expect((await call("POST", "/proposal-share/funnelToken_unknown_0123456789abcdef/engagement", {}, { kind: "twin_walk_30s" })).status).toBe(404);
    const live = await newProposal();
    for (const body of [{ kind: "page_view" }, { kind: "twin_walk_30s", visitorId: "abc" }, {}]) {
      expect((await call("POST", `/proposal-share/${live.token}/engagement`, {}, body)).status).toBe(400);
    }
    const counted = await pool.query("SELECT count(*)::int AS n FROM venue_engagement_events WHERE proposal_id = ANY($1::uuid[])", [[revoked.id, draft.id, live.id]]);
    expect(counted.rows[0]).toEqual({ n: 0 });
  });

  it("holds nothing about the person, belongs to exactly one enquiry or proposal of its venue, and goes with it", async () => {
    const columns = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'venue_engagement_events' ORDER BY ordinal_position",
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(["id", "venue_id", "kind", "enquiry_id", "proposal_id", "space_id", "recorded_at"]);

    const enquiryId = await newEnquiry();
    const proposal = await newProposal();
    const theirs = await newEnquiry({ venueId: otherVenue, spaceId: theirHall });
    const insert = "INSERT INTO venue_engagement_events (venue_id, kind, enquiry_id, proposal_id, space_id) VALUES ($1, $2, $3, $4, $5)";
    // Neither subject, or both.
    expect(await sqlState(insert, [venue, "twin_walk_30s", null, null, null])).toBe("23514");
    expect(await sqlState(insert, [venue, "twin_walk_30s", enquiryId, proposal.id, null])).toBe("23514");
    // Another venue's enquiry, or another venue's room, filed under this venue.
    expect(await sqlState(insert, [venue, "twin_walk_30s", theirs, null, null])).toBe("23503");
    expect(await sqlState(insert, [venue, "twin_walk_30s", enquiryId, null, theirHall])).toBe("23503");
    // An unknown kind.
    expect(await sqlState(insert, [venue, "page_view", enquiryId, null, null])).toBe("23514");

    expect(await sqlState(insert, [venue, "twin_walk_30s", enquiryId, null, hall])).toBeUndefined();
    await pool.query("DELETE FROM enquiries WHERE id = $1", [enquiryId]);
    const left = await pool.query("SELECT count(*)::int AS n FROM venue_engagement_events WHERE enquiry_id = $1", [enquiryId]);
    expect(left.rows[0]).toEqual({ n: 0 });
  });

  it("removes engagement events once they pass the retention period, and only those", async () => {
    const enquiryId = await newEnquiry();
    const old = randomUUID();
    const recent = randomUUID();
    await pool.query(
      `INSERT INTO venue_engagement_events (id, venue_id, kind, enquiry_id, recorded_at) VALUES
       ($1, $3, 'twin_walk_30s', $4, now() - interval '24 months 1 day'),
       ($2, $3, 'twin_walk_30s', $4, now() - interval '23 months')`,
      [old, recent, venue, enquiryId],
    );
    expect(await removeExpiredEngagementEvents(db)).toBeGreaterThanOrEqual(1);
    const kept = await pool.query<{ id: string }>("SELECT id FROM venue_engagement_events WHERE id = ANY($1::uuid[])", [[old, recent]]);
    expect(kept.rows.map((row) => row.id)).toEqual([recent]);
  });

  // -------------------------------------------------------------------------
  // Where an enquiry came from, and what came with it
  // -------------------------------------------------------------------------

  async function guestEnquiry(extra: Record<string, unknown>): Promise<string> {
    const res = await call("POST", "/public/enquiries", {}, {
      venueSlug: TRADES_HALL_ENQUIRY_VENUE_SLUG,
      email: `guest-${randomUUID().slice(0, 8)}@example.test`,
      source: "website",
      ...extra,
    });
    expect(res.status).toBe(201);
    return (res.body["data"] as { enquiryId: string }).enquiryId;
  }

  async function attributionOf(enquiryId: string): Promise<Record<string, string | null>> {
    const { rows } = await pool.query<Record<string, string | null>>(
      `SELECT referrer_host, utm_source, utm_medium, utm_campaign, acquisition_channel
       FROM enquiries WHERE id = $1`,
      [enquiryId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error("no enquiry");
    return row;
  }

  it("keeps only the referring host and cleaned tags, and reads them into a channel", async () => {
    const listing = await guestEnquiry({
      attribution: {
        referrer: "https://www.Hitched.co.uk/wedding-venues/trades-hall?session=abc123",
        utm: { source: "Hitched", medium: "listing", campaign: "Autumn  2026!", content: "jo.bloggs@example.com" },
      },
    });
    // utm_content is never read: email tools put per-recipient ids there.
    expect(await attributionOf(listing)).toEqual({
      referrer_host: "hitched.co.uk",
      utm_source: "hitched",
      utm_medium: "listing",
      utm_campaign: "autumn 2026",
      acquisition_channel: "listing",
    });

    const assistant = await guestEnquiry({ attribution: { utm: { source: "chatgpt.com" } } });
    expect((await attributionOf(assistant)).acquisition_channel).toBe("assistant");

    // The venue's own website, and Venviewer's own pages.
    const venueSite = await guestEnquiry({ attribution: { referrer: "https://www.tradeshallglasgow.co.uk/contact/" } });
    expect(await attributionOf(venueSite)).toMatchObject({ referrer_host: "tradeshallglasgow.co.uk", acquisition_channel: "venue_website" });
    const internal = await guestEnquiry({ attribution: { referrer: "https://venviewer.com/rooms/grand-hall" } });
    expect(await attributionOf(internal)).toMatchObject({ referrer_host: null, acquisition_channel: "direct" });

    // Nothing sent: nothing captured, which is not the same as direct.
    const none = await guestEnquiry({});
    expect(await attributionOf(none)).toEqual({
      referrer_host: null, utm_source: null, utm_medium: null, utm_campaign: null, acquisition_channel: null,
    });

    // Attribution never costs the guest the enquiry: what cannot be read is
    // dropped, an unknown key is never stored, and a hostile referrer is kept
    // as nothing.
    const odd = await guestEnquiry({ attribution: { referrer: "android-app:<img src=x onerror=alert(1)>", fingerprint: "abc" } });
    expect(await attributionOf(odd)).toMatchObject({ referrer_host: null, acquisition_channel: "direct" });
    const unreadable = await guestEnquiry({ attribution: "https://hitched.co.uk" });
    expect((await attributionOf(unreadable)).acquisition_channel).toBeNull();
    // The database refuses a tag without its channel, and a referrer that is not a hostname.
    expect(await sqlState("UPDATE enquiries SET utm_source = 'hitched' WHERE id = $1", [none])).toBe("23514");
    expect(await sqlState("UPDATE enquiries SET referrer_host = '<img src=x>', acquisition_channel = 'referral' WHERE id = $1", [none])).toBe("23514");
    expect(await sqlState("UPDATE enquiries SET referrer_host = 'jo@example.com', acquisition_channel = 'referral' WHERE id = $1", [none])).toBe("23514");
    expect(await sqlState("UPDATE enquiries SET referrer_host = 'com.google.android.gm', acquisition_channel = 'email' WHERE id = $1", [none])).toBeUndefined();
  });

  it("keeps nothing a browser sends while the switch is off, and answers 404 for a proposal page's engagement", async () => {
    process.env["ENQUIRY_FUNNEL_BROWSER_SIGNALS"] = "off";
    try {
      const enquiryId = await guestEnquiry({
        attribution: { referrer: "https://www.hitched.co.uk/", utm: { source: "hitched" } },
        engagement: ["twin_walk_30s"],
      });
      expect((await attributionOf(enquiryId)).acquisition_channel).toBeNull();
      const events = await pool.query("SELECT count(*)::int AS n FROM venue_engagement_events WHERE enquiry_id = $1", [enquiryId]);
      expect(events.rows[0]).toEqual({ n: 0 });
      const proposal = await newProposal();
      expect((await call("POST", `/proposal-share/${proposal.token}/engagement`, {}, { kind: "twin_walk_30s" })).status).toBe(404);
    } finally {
      process.env["ENQUIRY_FUNNEL_BROWSER_SIGNALS"] = "on";
    }
  });

  it("attaches what happened before an enquiry to that enquiry and its room, and refuses a repeated or unknown kind", async () => {
    const roomed = await guestEnquiry({ roomSlug: "saloon", engagement: ["twin_walk_30s"] });
    const roomedRows = await pool.query("SELECT venue_id, kind, enquiry_id, proposal_id, space_id FROM venue_engagement_events WHERE enquiry_id = $1", [roomed]);
    expect(roomedRows.rows).toEqual([{ venue_id: venue, kind: "twin_walk_30s", enquiry_id: roomed, proposal_id: null, space_id: saloon }]);

    // A guest who named no room: the walk is the venue's, filed under no room.
    const unroomed = await guestEnquiry({ engagement: ["twin_walk_30s"] });
    const unroomedRows = await pool.query("SELECT space_id FROM venue_engagement_events WHERE enquiry_id = $1", [unroomed]);
    expect(unroomedRows.rows).toEqual([{ space_id: null }]);

    // A repeated kind counts once, a kind this release does not know is dropped,
    // and neither costs the guest the enquiry.
    const repeated = await guestEnquiry({ engagement: ["twin_walk_30s", "twin_walk_30s", "page_view"] });
    const repeatedRows = await pool.query("SELECT kind FROM venue_engagement_events WHERE enquiry_id = $1", [repeated]);
    expect(repeatedRows.rows).toEqual([{ kind: "twin_walk_30s" }]);
    const unknown = await guestEnquiry({ engagement: ["page_view"] });
    const unknownRows = await pool.query("SELECT count(*)::int AS n FROM venue_engagement_events WHERE enquiry_id = $1", [unknown]);
    expect(unknownRows.rows[0]).toEqual({ n: 0 });
  });

  it("admits the listing and assistant touchpoints and nothing outside the seven", async () => {
    const enquiryId = await newEnquiry();
    for (const source of ["listing", "assistant"]) {
      expect(await sqlState("UPDATE enquiries SET source = $2 WHERE id = $1", [enquiryId, source])).toBeUndefined();
    }
    expect(await sqlState("UPDATE enquiries SET source = 'billboard' WHERE id = $1", [enquiryId])).toBe("23514");
  });

  // -------------------------------------------------------------------------
  // Viewings and lost reasons in the Diary
  // -------------------------------------------------------------------------

  let slot = 0;
  /** A fresh interval each time, hours ahead, so no two fixtures collide. */
  function interval(minutes = 45): { startsAt: string; endsAt: string } {
    slot += 1;
    const start = new Date(Date.UTC(2027, 0, 4, 9, 0, 0) + slot * 3 * 3_600_000);
    return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + minutes * 60_000).toISOString() };
  }

  it("books a viewing for an enquiry: in its room, hosted by whoever books it, with no event", async () => {
    const enquiryId = await newEnquiry({ spaceId: saloon });
    const res = await call("POST", "/bookings/viewings", asStaff(), { enquiryId, ...interval() });
    expect(res.status).toBe(201);
    expect(res.body["data"]).toMatchObject({
      kind: "viewing", status: "active", state: "viewing", enquiryId, spaceId: saloon, eventId: null,
      ownerUserId: people.staff, title: "Fixture guest", rank: null, lostReason: null,
    });
    // Asked for again (a double press, a retry): the same viewing, not a second.
    const first = res.body["data"] as { id: string; startsAt: string; endsAt: string };
    const again = await call("POST", "/bookings/viewings", asStaff(), { enquiryId, startsAt: first.startsAt, endsAt: first.endsAt });
    expect(again.status).toBe(200);
    expect((again.body["data"] as { id: string }).id).toBe(first.id);
    const count = await pool.query("SELECT count(*)::int AS n FROM bookings WHERE enquiry_id = $1 AND kind = 'viewing'", [enquiryId]);
    expect(count.rows[0]).toEqual({ n: 1 });
    // Called off.
    const id = first.id;
    const cancelled = await call("POST", `/bookings/${id}/transition`, asStaff(), { toState: "cancelled" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body["data"]).toMatchObject({ kind: "viewing", status: "cancelled" });
  });

  it("refuses a viewing outside the Diary's writers, another venue's room or host, or a room the guest never chose", async () => {
    const enquiryId = await newEnquiry();
    for (const headers of [asSales(), as("manager", venue, people.manager), as("hallkeeper", venue, people.hallkeeper),
      as("staff", otherVenue, people.otherStaff), as("admin", null, people.platformAdmin, "admin")]) {
      expect((await call("POST", "/bookings/viewings", headers, { enquiryId, ...interval() })).status).toBe(403);
    }
    expect(await call("POST", "/bookings/viewings", asStaff(), { enquiryId, spaceId: theirHall, ...interval() }))
      .toMatchObject({ status: 400, body: { code: "SPACE_VENUE_MISMATCH" } });
    expect(await call("POST", "/bookings/viewings", asStaff(), { enquiryId, ownerUserId: people.otherStaff, ...interval() }))
      .toMatchObject({ status: 400, body: { code: "OWNER_VENUE_MISMATCH" } });
    const unroomed = await newEnquiry({ roomChosen: false });
    expect(await call("POST", "/bookings/viewings", asStaff(), { enquiryId: unroomed, ...interval() }))
      .toMatchObject({ status: 400, body: { code: "ROOM_NOT_CHOSEN" } });
    expect((await call("POST", "/bookings/viewings", asStaff(), { enquiryId: unroomed, spaceId: hall, ...interval() })).status).toBe(201);
    expect((await call("POST", "/bookings/viewings", asStaff(), { enquiryId: randomUUID(), ...interval() })).status).toBe(404);
    // Never for a draft nobody has sent, nor for a request that books nothing.
    for (const other of [await newEnquiry({ state: "draft" }), await newEnquiry({ eventType: "venue-access" })]) {
      expect(await call("POST", "/bookings/viewings", asStaff(), { enquiryId: other, ...interval() }))
        .toMatchObject({ status: 422, body: { code: "NOT_A_BOOKING_ENQUIRY" } });
    }
    const viewings = await pool.query("SELECT count(*)::int AS n FROM bookings WHERE enquiry_id = $1 AND kind = 'viewing'", [enquiryId]);
    expect(viewings.rows[0]).toEqual({ n: 0 });
  });

  it("keeps a viewing a viewing: never given an event, never made from another booking", async () => {
    const enquiryId = await newEnquiry();
    const viewing = await call("POST", "/bookings/viewings", asStaff(), { enquiryId, ...interval() });
    expect(viewing.status).toBe(201);
    const viewingId = (viewing.body["data"] as { id: string }).id;
    const event = randomUUID();
    await pool.query("INSERT INTO events (id, venue_id, name, status) VALUES ($1, $2, 'Crawford wedding', 'draft')", [event, venue]);
    expect((await call("PATCH", `/bookings/${viewingId}`, asStaff(), { eventId: event })).status).toBe(400);
    expect(await sqlState("UPDATE bookings SET event_id = $2 WHERE id = $1", [viewingId, event])).toBe("23514");
    // The generic create refuses a viewing with an event too.
    expect((await call("POST", "/bookings", asStaff(), { venueId: venue, spaceId: hall, kind: "viewing", title: "Walk-in", eventId: event, ...interval() })).status).toBe(400);

    const prospect = await call("POST", "/bookings", asStaff(), { venueId: venue, spaceId: hall, kind: "prospect", title: "Maybe", ...interval() });
    expect(prospect.status).toBe(201);
    const prospectId = (prospect.body["data"] as { id: string }).id;
    for (const headers of [asStaff(), as("admin", venue, people.admin)]) {
      expect(await call("POST", `/bookings/${prospectId}/transition`, headers, { toState: "viewing" }))
        .toMatchObject({ status: 400, body: { code: "INVALID_TRANSITION" } });
    }
    // Nor does a viewing become a commitment, even by the admin's override.
    for (const toState of ["hold", "ink", "lost", "released"]) {
      expect(await call("POST", `/bookings/${viewingId}/transition`, as("admin", venue, people.admin), { toState }))
        .toMatchObject({ status: 400, body: { code: "INVALID_TRANSITION" } });
    }
    expect((await pool.query("SELECT kind, status, event_id FROM bookings WHERE id = $1", [viewingId])).rows[0])
      .toEqual({ kind: "viewing", status: "active", event_id: null });
  });

  it("records why a booking was lost, only on a lost booking", async () => {
    const make = async (): Promise<string> => {
      const res = await call("POST", "/bookings", asStaff(), { venueId: venue, spaceId: hall, kind: "prospect", title: "Maybe", ...interval() });
      expect(res.status).toBe(201);
      return (res.body["data"] as { id: string }).id;
    };
    const priced = await make();
    const lost = await call("POST", `/bookings/${priced}/transition`, asStaff(), { toState: "lost", lostReason: "price", note: "Our menu was over their budget." });
    expect(lost.status).toBe(200);
    expect(lost.body["data"]).toMatchObject({ status: "lost", lostReason: "price" });
    expect((await pool.query("SELECT lost_reason FROM bookings WHERE id = $1", [priced])).rows[0]).toEqual({ lost_reason: "price" });

    // Unsaid is still lost.
    const unsaid = await make();
    expect((await call("POST", `/bookings/${unsaid}/transition`, asStaff(), { toState: "lost" })).body["data"]).toMatchObject({ status: "lost", lostReason: null });

    // A reason belongs to a loss and to the list.
    const held = await make();
    expect((await call("POST", `/bookings/${held}/transition`, asStaff(), { toState: "hold", lostReason: "price" })).status).toBe(400);
    expect((await call("POST", `/bookings/${held}/transition`, asStaff(), { toState: "lost", lostReason: "weather" })).status).toBe(400);
    expect(await sqlState("UPDATE bookings SET lost_reason = 'price' WHERE id = $1", [held])).toBe("23514");

    // The admin's override back out of lost clears the reason with it.
    const reopened = await call("POST", `/bookings/${priced}/transition`, as("admin", venue, people.admin), { toState: "prospect" });
    expect(reopened.status).toBe(200);
    expect((await pool.query("SELECT status, lost_reason FROM bookings WHERE id = $1", [priced])).rows[0]).toEqual({ status: "active", lost_reason: null });
  });
});
