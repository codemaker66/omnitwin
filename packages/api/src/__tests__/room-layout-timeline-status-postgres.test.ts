import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVENT_ENDED_STATUSES,
  EVENT_STATUSES,
  RoomLayoutTimelineResponseSchema,
  type EventStatus,
} from "@omnitwin/types";
import * as schema from "../db/schema.js";
import type { JwtUser } from "../middleware/auth.js";
import { roomLayoutTimelineRoutes } from "../routes/room-layout-timeline.js";

// ---------------------------------------------------------------------------
// The room layout timeline (GET /calendar/layout-timeline) reads the room's
// day as the Diary does: an event that ended (cancelled, or lost when every
// option went) will not happen and occupies no room, so none of its phases,
// layouts, guest counts or revenue estimates appear beside the live ones.
// Every other status keeps its phases on the timeline.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// Tables are created in a schema of their own from the real Drizzle schema,
// so no migration, shared table or production data is touched.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  // CI's route database, or this suite's private local cluster.
  const allowedPort = parsed.port === "55476" || parsed.port === "55418";
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || !allowedPort
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Room layout timeline tests require their explicit isolated loopback database");
  }
}

const VENUE = randomUUID();
const ROOM = randomUUID();
const LIVE_EVENT = randomUUID();
const STAFF: JwtUser = { id: randomUUID(), email: "staff@timeline-status.invalid", name: "Fixture staff", role: "staff", platformRole: "none", venueId: VENUE };
const MANAGER: JwtUser = { ...STAFF, id: randomUUID(), email: "manager@timeline-status.invalid", role: "manager" };
const ENDED: ReadonlySet<EventStatus> = new Set(EVENT_ENDED_STATUSES);

function headers(user: JwtUser): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify(user)}` };
}

describe.skipIf(testUrl === undefined)("the room layout timeline on isolated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;
  const fixtureSchema = `timeline_status_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.users, schema.venues, schema.spaces, schema.configurations, schema.events, schema.eventPhases,
    schema.phaseLayoutSnapshots, schema.canonicalLayoutSnapshots, schema.layoutValidationRuns, schema.revenueScenarios,
  ];

  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "test");
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 4, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => {
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "updated_at") defaultSql = " default now()";
        else if (typeof column.default === "boolean" || typeof column.default === "number") defaultSql = ` default ${String(column.default)}`;
        else if (typeof column.default === "string") defaultSql = ` default '${column.default.replaceAll("'", "''")}'`;
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(roomLayoutTimelineRoutes, { db, prefix: "/calendar" });
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
    vi.unstubAllEnvs();
  }, 30_000);

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${tables.map((table) => `"${getTableConfig(table).name}"`).join(", ")}`);
    await db.insert(schema.venues).values({ id: VENUE, name: "Trades Hall Glasgow", slug: "timeline-status-venue", address: "Glassford Street", timezone: "Europe/London" });
    await db.insert(schema.spaces).values({ id: ROOM, venueId: VENUE, name: "Grand Hall", slug: "grand-hall", widthM: "10", lengthM: "20", heightM: "5", floorPlanOutline: [] });
    await db.insert(schema.users).values([STAFF, MANAGER].map((user) => ({
      id: user.id, email: user.email, name: user.name, role: user.role, platformRole: user.platformRole, venueId: user.venueId,
    })));
    // The room's live booking that evening, which stays on every read.
    await addEventWithPhase(LIVE_EVENT, "confirmed", "Live dinner");
  });

  async function addEventWithPhase(eventId: string, status: EventStatus, name: string): Promise<void> {
    await db.insert(schema.events).values({
      id: eventId, venueId: VENUE, createdBy: STAFF.id, name, eventType: "dinner", status,
      startsAt: new Date("2026-11-07T18:00:00Z"), endsAt: new Date("2026-11-07T23:00:00Z"), guestCount: 200,
    });
    await db.insert(schema.eventPhases).values({
      eventId, spaceId: ROOM, templateKey: "dinner", name: `${name} service`, sortOrder: 1,
      startsAt: new Date("2026-11-07T19:00:00Z"), durationMinutes: 120, guestCount: 200,
    });
  }

  async function timelineEventIds(user: JwtUser): Promise<{ ids: string[]; body: string }> {
    const response = await server.inject({
      method: "GET",
      url: `/calendar/layout-timeline?${new URLSearchParams({
        venueId: VENUE, spaceId: ROOM, scope: "day", anchorDate: "2026-11-07",
      }).toString()}`,
      headers: headers(user),
    });
    expect(response.statusCode, response.body).toBe(200);
    const timeline = RoomLayoutTimelineResponseSchema.parse(response.json<{ data: unknown }>().data);
    return { ids: timeline.frames.map((frame) => frame.eventId), body: response.body };
  }

  it.each(EVENT_STATUSES.map((status) => [status, ENDED.has(status)] as const))(
    "an event that is %s (ended: %s) shows on the room's day only while it has not ended",
    async (status, ended) => {
      const eventId = randomUUID();
      const name = `Overlapping ${status} event`;
      await addEventWithPhase(eventId, status, name);
      for (const user of [STAFF, MANAGER]) {
        const { ids, body } = await timelineEventIds(user);
        if (ended) {
          expect(ids, `${user.role} reads a ${status} event`).toEqual([LIVE_EVENT]);
          expect(body).not.toContain(eventId);
          expect(body).not.toContain(name);
        } else {
          expect([...ids].sort(), `${user.role} reads a ${status} event`).toEqual([LIVE_EVENT, eventId].sort());
        }
      }
    },
  );
});
