import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ClientEventScheduleSchema } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { getUserByClerkId, type JwtUser } from "../middleware/auth.js";
import { clientEventScheduleRoutes } from "../routes/client-event-schedule.js";
import { eventRoutes } from "../routes/events.js";

// Full migrations must already exist. Never read DATABASE_URL or an env file,
// truncate shared tables, create substitute tables, or write outside this
// invocation's UUID fixtures. The second tuple is the dedicated CI database on
// its existing disposable PostgreSQL service, not the platform test database.
const target = process.env["VENVIEWER_EVENT_ACCESS_TEST_DATABASE_URL"];
if (target !== undefined) {
  const url = new URL(target);
  const local = url.username === "goal15" && url.port === "55481" && url.pathname === "/venviewer_goal15_access_test";
  const ci = url.username === "postgres" && url.port === "55477" && url.pathname === "/venviewer_event_access_test";
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || (!local && !ci) || url.search || url.hash) {
    throw new Error("Event access tests require the explicitly owned, fully migrated disposable database");
  }
}

describe.skipIf(target === undefined)("client schedule on fully migrated disposable PostgreSQL", () => {
  let pool: Pool;
  let observer: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;
  // The planner corridor's write side. Registered separately so the read
  // routes keep their own instance; both speak to the same database.
  let corridorServer: FastifyInstance;
  const applicationName = `client-schedule-${randomUUID()}`;
  const fixtures: Fixture[] = [];

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit disposable target required");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VENVIEWER_APPROVED_AUTH_DOMAINS", "");
    pool = new Pool({ connectionString: target, application_name: applicationName, max: 5 });
    observer = new Pool({ connectionString: target, application_name: `${applicationName}-observer`, max: 2 });
    expect((await observer.query<{ database: string }>("SELECT current_database() AS database")).rows[0]?.database)
      .toBe(new URL(target).pathname.slice(1));
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(clientEventScheduleRoutes, { db, prefix: "/events" });
    await server.ready();
    corridorServer = Fastify();
    await corridorServer.register(eventRoutes, { db, prefix: "/events" });
    await corridorServer.ready();
  });

  afterAll(async () => {
    await server?.close();
    await corridorServer?.close();
    if (db !== undefined) {
      for (const f of fixtures) {
        await db.delete(schema.eventConfigurationLinks).where(inArray(schema.eventConfigurationLinks.eventId, f.eventIds));
        await db.delete(schema.layoutVariants).where(inArray(schema.layoutVariants.eventId, f.eventIds));
        await db.delete(schema.eventPhases).where(inArray(schema.eventPhases.eventId, f.eventIds));
        await db.delete(schema.events).where(inArray(schema.events.id, f.eventIds));
        await db.delete(schema.configurations).where(inArray(schema.configurations.id, f.configIds));
        await db.delete(schema.spaces).where(inArray(schema.spaces.id, f.roomIds));
        await db.delete(schema.users).where(inArray(schema.users.id, f.actors.map(actor => actor.id)));
        await db.delete(schema.venues).where(inArray(schema.venues.id, f.venueIds));
      }
    }
    await pool?.end();
    await observer?.end();
    vi.unstubAllEnvs();
  }, 30000);

  type ActorKey = "client" | "otherClient" | "staff" | "admin" | "hallkeeper" | "otherStaff" | "otherAdmin" | "platform";
  interface Fixture {
    venueIds: [string, string];
    roomIds: [string, string];
    eventIds: [string, string, string];
    configIds: [string, string, string, string];
    phaseIds: [string, string, string, string];
    variantId: string;
    linkId: string;
    actors: JwtUser[];
    actor: Record<ActorKey, JwtUser>;
  }

  async function fixture(): Promise<Fixture> {
    const venueIds: Fixture["venueIds"] = [randomUUID(), randomUUID()];
    const roomIds: Fixture["roomIds"] = [randomUUID(), randomUUID()];
    const eventIds: Fixture["eventIds"] = [randomUUID(), randomUUID(), randomUUID()];
    const configIds: Fixture["configIds"] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const phaseIds: Fixture["phaseIds"] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const actorEntries = (["client", "otherClient", "staff", "admin", "hallkeeper", "otherStaff", "otherAdmin", "platform"] as const).map(key => {
      const id = randomUUID();
      const role = key === "otherClient" ? "client" : key === "otherStaff" ? "staff" : key === "otherAdmin" || key === "platform" ? "admin" : key;
      const venueId = key === "client" || key === "otherClient" || key === "platform" ? null
        : key === "otherStaff" || key === "otherAdmin" ? venueIds[1] : venueIds[0];
      const actor: JwtUser = { id, email: `${id}@event-access.invalid`, name: `Fixture ${key}`, role, venueId,
        platformRole: key === "platform" ? "admin" : "none" };
      return [key, actor] as const;
    });
    const actor = Object.fromEntries(actorEntries) as Record<ActorKey, JwtUser>;
    const f: Fixture = { venueIds, roomIds, eventIds, configIds, phaseIds, variantId: randomUUID(), linkId: randomUUID(),
      actors: actorEntries.map(([, value]) => value), actor };
    fixtures.push(f);
    await db.insert(schema.venues).values(venueIds.map((id, index) => ({ id, name: `Schedule venue ${String(index)}`, slug: id,
      address: "INTERNAL_ADDRESS", timezone: "Europe/London" })));
    await db.insert(schema.spaces).values(roomIds.map((id, index) => ({ id, venueId: venueIds[index] ?? venueIds[0],
      name: `Room ${String(index)}`, slug: id, widthM: "10", lengthM: "20", heightM: "5", floorPlanOutline: [] })));
    await db.insert(schema.users).values(f.actors.map(value => ({ ...value, clerkId: `user_${value.id.replaceAll("-", "")}` })));
    await db.insert(schema.events).values(eventIds.map((id, index) => ({ id, venueId: index === 2 ? venueIds[1] : venueIds[0],
      createdBy: index === 2 ? actor.otherStaff.id : actor.staff.id, name: `Event ${String(index)}`, eventType: "dinner", status: "in_planning",
      startsAt: new Date("2026-10-25T18:00:00Z"), endsAt: new Date("2026-10-25T23:00:00Z"), guestCount: 24,
      notes: "INTERNAL_EVENT_NOTES", clientName: "INTERNAL_CLIENT_NAME" })));
    await db.insert(schema.configurations).values(configIds.map((id, index) => ({ id,
      venueId: index === 3 ? venueIds[1] : venueIds[0], spaceId: index === 3 ? roomIds[1] : roomIds[0],
      userId: index === 2 ? actor.otherClient.id : actor.client.id, name: `Layout ${String(index)}`, layoutStyle: "dinner-rounds",
      metadata: { instructions: { specialInstructions: "INTERNAL_DIETARY" } }, visibility: "private", slug: id })));
    await db.insert(schema.layoutVariants).values({ id: f.variantId, eventId: eventIds[0], configurationId: configIds[0],
      name: "INTERNAL_VARIANT_NAME", notes: "INTERNAL_VARIANT_NOTES", status: "candidate" });
    await db.insert(schema.eventConfigurationLinks).values([
      { id: f.linkId, eventId: eventIds[0], configurationId: configIds[0], layoutVariantId: f.variantId, linkType: "variant_configuration" },
      { eventId: eventIds[0], configurationId: configIds[1], linkType: "source_configuration" },
      { eventId: eventIds[0], configurationId: configIds[2], linkType: "source_configuration" },
      { eventId: eventIds[2], configurationId: configIds[3], linkType: "source_configuration" },
    ]);
    await db.insert(schema.eventPhases).values([
      { id: phaseIds[0], eventId: eventIds[0], spaceId: roomIds[0], name: "Arrival", sortOrder: 0, durationMinutes: 30,
        startsAt: new Date("2026-10-25T18:00:00Z"), notes: "INTERNAL_PHASE_NOTES", staffConflictsLabel: "INTERNAL_STAFF_CONFLICT" },
      { id: phaseIds[1], eventId: eventIds[0], spaceId: null, name: "Untimed", sortOrder: 1, durationMinutes: 15 },
      { id: phaseIds[2], eventId: eventIds[1], spaceId: roomIds[0], name: "OTHER_EVENT_SECRET", sortOrder: 0,
        durationMinutes: 30, startsAt: new Date("2026-10-25T18:00:00Z") },
      { id: phaseIds[3], eventId: eventIds[2], spaceId: roomIds[1], name: "OTHER_VENUE_SECRET", sortOrder: 0, durationMinutes: 30 },
    ]);
    return f;
  }

  function read(f: Fixture, actor: JwtUser = f.actor.client, configurationId?: string, eventId = f.eventIds[0]) {
    return server.inject({ method: "GET", url: `/events/${eventId}/client-schedule${configurationId === undefined ? "" : `?configurationId=${configurationId}`}`,
      headers: { authorization: `Bearer ${JSON.stringify(actor)}` } });
  }

  it("returns only the linked owner's working schedule and layouts, with exact timezone and untimed phase", async () => {
    const f = await fixture();
    const response = await read(f);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const data = ClientEventScheduleSchema.parse(response.json<{ data: unknown }>().data);
    expect(data.layouts.map(layout => layout.id)).toEqual([f.configIds[0], f.configIds[1]]);
    expect(data.phases).toEqual([
      { id: f.phaseIds[0], name: "Arrival", startsAt: "2026-10-25T18:00:00.000Z", durationMinutes: 30,
        space: { id: f.roomIds[0], name: "Room 0" } },
      { id: f.phaseIds[1], name: "Untimed", startsAt: null, durationMinutes: 15, space: null },
    ]);
    expect(data.venue.timezone).toBe("Europe/London");
    expect(data.scheduleState).toBe("working");
    expect(response.body).not.toMatch(/INTERNAL_|OTHER_EVENT_SECRET|OTHER_VENUE_SECRET/u);
    expect(response.body).not.toContain(f.configIds[2]);
    expect((await read(f, f.actor.client, f.configIds[0])).json<{ data: { layouts: { id: string }[] } }>().data.layouts)
      .toEqual([{ id: f.configIds[0], name: "Layout 0", space: { id: f.roomIds[0], name: "Room 0" } }]);
  });

  it.each(["staff", "admin", "hallkeeper", "platform"] as const)("allows the current %s grant and still binds an explicit layout", async role => {
    const f = await fixture();
    expect((await read(f, f.actor[role])).statusCode).toBe(200);
    expect((await read(f, f.actor[role], f.configIds[3])).statusCode).toBe(404);
    expect((await read(f, f.actor[role], f.configIds[0])).statusCode).toBe(200);
  });

  it("treats planner as an owned-layout client, not venue-wide membership", async () => {
    const f = await fixture();
    await db.update(schema.users).set({ role: "planner", venueId: f.venueIds[0] }).where(eq(schema.users.id, f.actor.client.id));
    expect((await read(f)).statusCode).toBe(200);
    expect((await read(f, f.actor.client, undefined, f.eventIds[1])).statusCode).toBe(404);
    expect((await read(f, f.actor.client, f.configIds[2])).statusCode).toBe(404);
  });

  it.each(["staff", "public"] as const)("keeps the owner's schedule when a layout is shared with %s without granting other viewers", async visibility => {
    const f = await fixture();
    await db.update(schema.configurations).set({ visibility }).where(eq(schema.configurations.id, f.configIds[0]));
    expect((await read(f, f.actor.client, f.configIds[0])).statusCode).toBe(200);
    expect((await read(f, f.actor.otherClient, f.configIds[0])).statusCode).toBe(404);
  });

  it("deduplicates multiple legitimate links without manufacturing layout choices", async () => {
    const f = await fixture();
    await db.insert(schema.eventConfigurationLinks).values({ eventId: f.eventIds[0], configurationId: f.configIds[0], linkType: "approved_snapshot_source" });
    const response = await read(f, f.actor.client, f.configIds[0]);
    expect(response.statusCode, response.body).toBe(200);
    expect(ClientEventScheduleSchema.parse(response.json<{ data: unknown }>().data).layouts).toHaveLength(1);
  });

  it("omits an invalid foreign-room phase and presents genuinely empty schedules honestly to venue staff", async () => {
    const f = await fixture();
    await db.update(schema.eventPhases).set({ spaceId: f.roomIds[1] }).where(eq(schema.eventPhases.id, f.phaseIds[0]));
    const response = await read(f, f.actor.client, f.configIds[0]);
    expect(response.statusCode, response.body).toBe(200);
    expect(ClientEventScheduleSchema.parse(response.json<{ data: unknown }>().data).phases.map(phase => phase.id)).toEqual([f.phaseIds[1]]);
    expect(response.body).not.toContain(f.roomIds[1]);
    await db.delete(schema.eventPhases).where(eq(schema.eventPhases.id, f.phaseIds[2]));
    const empty = await read(f, f.actor.staff, undefined, f.eventIds[1]);
    expect(empty.statusCode, empty.body).toBe(200);
    expect(ClientEventScheduleSchema.parse(empty.json<{ data: unknown }>().data)).toMatchObject({ phases: [], layouts: [], scheduleState: "working" });
  });

  it("denies other-venue staff/admin, unlinked clients, guessed event IDs and forged token grants", async () => {
    const f = await fixture();
    for (const actor of [f.actor.otherStaff, f.actor.otherAdmin, { ...f.actor.client, role: "admin", platformRole: "admin" as const }]) {
      const response = await read(f, actor, undefined, f.eventIds[1]);
      expect(response.statusCode, response.body).toBe(404);
    }
    expect((await read(f, f.actor.otherStaff)).statusCode).toBe(404);
    expect((await read(f, f.actor.otherAdmin)).statusCode).toBe(404);
    expect((await read(f, f.actor.client, undefined, randomUUID())).statusCode).toBe(404);
    expect((await read(f, f.actor.otherClient, f.configIds[0])).statusCode).toBe(404);
  });

  it.each(["config_deleted", "owner_changed", "variant_archived", "variant_event_changed", "variant_config_changed", "link_removed",
    "variant_link_missing_variant", "config_venue_changed", "config_room_changed", "room_deleted", "event_deleted", "venue_deleted", "public_preview"] as const)(
    "denies the requested relationship after committed %s", async change => {
      const f = await fixture();
      expect((await read(f, f.actor.client, f.configIds[0])).statusCode).toBe(200);
      if (change === "config_deleted") await db.update(schema.configurations).set({ deletedAt: new Date() }).where(eq(schema.configurations.id, f.configIds[0]));
      if (change === "owner_changed") await db.update(schema.configurations).set({ userId: f.actor.otherClient.id }).where(eq(schema.configurations.id, f.configIds[0]));
      if (change === "variant_archived") await db.update(schema.layoutVariants).set({ status: "archived" }).where(eq(schema.layoutVariants.id, f.variantId));
      if (change === "variant_event_changed") await db.update(schema.layoutVariants).set({ eventId: f.eventIds[1] }).where(eq(schema.layoutVariants.id, f.variantId));
      if (change === "variant_config_changed") await db.update(schema.layoutVariants).set({ configurationId: f.configIds[1] }).where(eq(schema.layoutVariants.id, f.variantId));
      if (change === "link_removed") await db.delete(schema.eventConfigurationLinks).where(eq(schema.eventConfigurationLinks.id, f.linkId));
      if (change === "variant_link_missing_variant") await db.update(schema.eventConfigurationLinks).set({ layoutVariantId: null }).where(eq(schema.eventConfigurationLinks.id, f.linkId));
      if (change === "config_venue_changed") await db.update(schema.configurations).set({ venueId: f.venueIds[1] }).where(eq(schema.configurations.id, f.configIds[0]));
      if (change === "config_room_changed") await db.update(schema.configurations).set({ spaceId: f.roomIds[1] }).where(eq(schema.configurations.id, f.configIds[0]));
      if (change === "room_deleted") await db.update(schema.spaces).set({ deletedAt: new Date() }).where(eq(schema.spaces.id, f.roomIds[0]));
      if (change === "event_deleted") await db.update(schema.events).set({ deletedAt: new Date() }).where(eq(schema.events.id, f.eventIds[0]));
      if (change === "venue_deleted") await db.update(schema.venues).set({ deletedAt: new Date() }).where(eq(schema.venues.id, f.venueIds[0]));
      if (change === "public_preview") await db.update(schema.configurations).set({ isPublicPreview: true }).where(eq(schema.configurations.id, f.configIds[0]));
      const response = await read(f, f.actor.client, f.configIds[0]);
      expect(response.statusCode, response.body).toBe(404);
    },
  );

  it("retains the real migration constraint against invented link grants", async () => {
    const f = await fixture();
    await expect(observer.query("UPDATE event_configuration_links SET link_type='invented_grant' WHERE id=$1", [f.linkId]))
      .rejects.toMatchObject({ code: "23514", constraint: "event_configuration_links_link_type_check" });
    expect((await read(f, f.actor.client, f.configIds[0])).statusCode).toBe(200);
  });

  it("does not grant event access from historical creator identity after the current role or venue changes", async () => {
    const f = await fixture();
    expect((await read(f, f.actor.staff)).statusCode).toBe(200);
    await db.update(schema.users).set({ role: "client", venueId: null }).where(eq(schema.users.id, f.actor.staff.id));
    expect((await read(f, f.actor.staff)).statusCode).toBe(404);
    await db.update(schema.users).set({ role: "staff", venueId: f.venueIds[1] }).where(eq(schema.users.id, f.actor.staff.id));
    expect((await read(f, f.actor.staff)).statusCode).toBe(404);
  });

  it("re-resolves current role and venue through the production local identity bridge, independently of mock-token route tests", async () => {
    const f = await fixture();
    const clerkId = `user_${f.actor.staff.id.replaceAll("-", "")}`;
    const before = await getUserByClerkId(db, clerkId, f.actor.staff.email);
    expect(before).toMatchObject({ id: f.actor.staff.id, role: "staff", venueId: f.venueIds[0] });
    await db.update(schema.users).set({ role: "client", venueId: null }).where(eq(schema.users.id, f.actor.staff.id));
    const after = await getUserByClerkId(db, clerkId, f.actor.staff.email);
    expect(after).toMatchObject({ id: f.actor.staff.id, role: "client", venueId: null });
    if (after === null) throw new Error("Fixture identity disappeared");
    expect((await read(f, after)).statusCode).toBe(404);
  });

  it("uses one repeatable snapshot for an in-flight read and denies the next read after ownership changes", async () => {
    const f = await fixture();
    const blocker = await observer.connect();
    let pending: ReturnType<typeof read> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE events IN ACCESS EXCLUSIVE MODE");
      pending = read(f, f.actor.client, f.configIds[0]);
      // Fastify inject is thenable; attaching then starts the request.
      const running = pending.then(response => response);
      await expect.poll(async () => {
        await blocker.query("SELECT pg_stat_clear_snapshot()");
        const result = await blocker.query<{ waiting: number }>("SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [applicationName]);
        return result.rows[0]?.waiting;
      }, { timeout: 5000 }).toBe(1);
      await blocker.query("UPDATE configurations SET user_id=$1 WHERE id=$2", [f.actor.otherClient.id, f.configIds[0]]);
      await blocker.query("COMMIT");
      expect((await running).statusCode).toBe(200);
      expect((await read(f, f.actor.client, f.configIds[0])).statusCode).toBe(404);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await pending;
    }
  });

  // THE OPS LENS CORRIDOR. Compiling an Ops handoff pack against an event link
  // writes an event_configuration_links row, and a source_configuration link
  // with no layout variant is the ONLY participation grant that admits a client
  // to an event's schedule. So the corridor must never write that row for a
  // layout a customer owns: a staff member compiling a pack would otherwise
  // hand that customer the event. Both halves are proved here — the grant is
  // real (direct insert), and the route refuses to create it.
  it("refuses the corridor link on a client-owned layout, so compiling grants no schedule access", async () => {
    const f = await fixture();
    const link = (configurationId: string, eventId = f.eventIds[1]) => corridorServer.inject({
      method: "POST", url: `/events/${eventId}/configuration-links`,
      headers: { authorization: `Bearer ${JSON.stringify(f.actor.staff)}` },
      payload: { configurationId, linkType: "source_configuration" },
    });
    const linksFor = (eventId: string) => db.select().from(schema.eventConfigurationLinks)
      .where(eq(schema.eventConfigurationLinks.eventId, eventId));

    // Event 1 starts with no links at all, so the client owning layout 1 has no
    // relationship to it.
    expect(await linksFor(f.eventIds[1])).toHaveLength(0);
    expect((await read(f, f.actor.client, f.configIds[1], f.eventIds[1])).statusCode).toBe(404);

    const refused = await link(f.configIds[1]);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe("CONFIGURATION_OWNER_IS_CUSTOMER");
    expect(await linksFor(f.eventIds[1])).toHaveLength(0);
    expect((await read(f, f.actor.client, f.configIds[1], f.eventIds[1])).statusCode).toBe(404);

    // The instrument is not vacuous: the row the route refused to write is
    // exactly the one that would have opened the event to that client.
    await db.insert(schema.eventConfigurationLinks)
      .values({ eventId: f.eventIds[1], configurationId: f.configIds[1], linkType: "source_configuration" });
    expect((await read(f, f.actor.client, f.configIds[1], f.eventIds[1])).statusCode).toBe(200);
    await db.delete(schema.eventConfigurationLinks).where(eq(schema.eventConfigurationLinks.eventId, f.eventIds[1]));

    // A venue-owned layout still binds, once, and admits no customer.
    const staffConfigId = randomUUID();
    await db.insert(schema.configurations).values({ id: staffConfigId, venueId: f.venueIds[0], spaceId: f.roomIds[0],
      userId: f.actor.staff.id, name: "Staff layout", layoutStyle: "dinner-rounds", visibility: "private", slug: staffConfigId });
    try {
      const created = await link(staffConfigId);
      expect(created.statusCode, created.body).toBe(201);
      const repeated = await link(staffConfigId);
      expect(repeated.statusCode, repeated.body).toBe(200);
      expect(await linksFor(f.eventIds[1])).toHaveLength(1);
      expect((await read(f, f.actor.client, staffConfigId, f.eventIds[1])).statusCode).toBe(404);
      expect((await read(f, f.actor.staff, staffConfigId, f.eventIds[1])).statusCode).toBe(200);
    } finally {
      await db.delete(schema.eventConfigurationLinks).where(eq(schema.eventConfigurationLinks.configurationId, staffConfigId));
      await db.delete(schema.configurations).where(eq(schema.configurations.id, staffConfigId));
    }
  });
});
