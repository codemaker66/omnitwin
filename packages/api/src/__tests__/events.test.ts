import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const VENUE_ID = "00000000-0000-4000-8000-000000000001";
const EVENT_ID = "00000000-0000-4000-8000-000000000002";
const PHASE_ID = "00000000-0000-4000-8000-000000000003";
const CONFIG_ID = "00000000-0000-4000-8000-000000000004";
const OTHER_VENUE_ID = "00000000-0000-4000-8000-00000000000b";
const ACTOR_ID = "00000000-0000-4000-8000-000000000099";

function signToken(payload: {
  id: string;
  email: string;
  role: string;
  venueId: string | null;
  platformRole?: string;
}): string {
  return JSON.stringify(payload);
}

const adminToken = (): string => signToken({
  id: ACTOR_ID,
  email: "admin@test.com",
  role: "admin",
  venueId: VENUE_ID,
});

const staffToken = (venueId: string | null = VENUE_ID): string =>
  signToken({ id: ACTOR_ID, email: "staff@test.com", role: "staff", venueId });

const hallkeeperToken = (): string =>
  signToken({ id: ACTOR_ID, email: "keeper@test.com", role: "hallkeeper", venueId: VENUE_ID });

const plannerToken = (): string =>
  signToken({ id: ACTOR_ID, email: "planner@test.com", role: "planner", venueId: VENUE_ID });

const platformAdminToken = (): string =>
  signToken({ id: ACTOR_ID, email: "platform@test.com", role: "admin", venueId: null, platformRole: "admin" });

function bodyCode(raw: string): string {
  return (JSON.parse(raw) as { code: string }).code;
}

function validEventPayload(venueId: string = VENUE_ID): Record<string, unknown> {
  return {
    venueId,
    name: "Wedding",
    eventType: "wedding",
    status: "draft",
    guestCount: 120,
  };
}

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

describe("event routes", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/events",
      payload: { venueId: VENUE_ID, name: "Wedding" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("validates event creation status vocabulary", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { venueId: VENUE_ID, name: "Wedding", status: "production ready" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts valid event creation payload before hitting the database", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        venueId: VENUE_ID,
        name: "Wedding",
        eventType: "wedding",
        status: "draft",
        guestCount: 120,
      },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  it("validates phase update placeholders without unsafe claims", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/event-phases/${PHASE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { densityStatus: "certified_safe" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts valid phase update shape before hitting the database", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/event-phases/${PHASE_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        durationMinutes: 45,
        guestCount: 120,
        opsTasksCount: 8,
        reviewGatesCount: 2,
        densityStatus: "not_checked",
        densityLabel: "Density not checked",
        staffConflictsStatus: "not_checked",
        staffConflictsLabel: "Staff conflicts not checked",
      },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  it("validates layout variant links", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/events/${EVENT_ID}/layout-variants`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        configurationId: CONFIG_ID,
        name: "Dinner option A",
        guestCount: 120,
      },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  it("uses the shared default phase generator in event creation", async () => {
    const source = await readFile(resolve("src/routes/events.ts"), "utf-8");
    expect(source).toContain("defaultEventPhaseInputs()");
    expect(source).toContain("Density not checked");
    expect(source).toContain("Staff conflicts not checked");
    expect(source).not.toContain("certified safe");
    expect(source).not.toContain("fire approved");
  });

  it("scopes scenario phase lookup to the event in the request path", async () => {
    const source = await readFile(resolve("src/routes/events.ts"), "utf-8");
    const scenarioRoute = source.slice(
      source.indexOf('server.post("/:id/scenarios"'),
      source.indexOf('server.post("/:id/layout-variants"'),
    );
    expect(scenarioRoute).toContain("eq(eventPhases.id, parsed.data.phaseId)");
    expect(scenarioRoute).toContain("eq(eventPhases.eventId, eventRow.id)");
    expect(scenarioRoute).toContain("EVENT_PHASE_MISMATCH");
  });

  it("rejects cross-venue configuration links before writing an event variant", async () => {
    const source = await readFile(resolve("src/routes/events.ts"), "utf-8");
    const variantRoute = source.slice(source.indexOf('server.post("/:id/layout-variants"'));
    expect(variantRoute).toContain("config.venueId !== eventRow.venueId");
    expect(variantRoute).toContain('code: "CONFIGURATION_VENUE_MISMATCH"');
    expect(variantRoute.indexOf("config.venueId !== eventRow.venueId"))
      .toBeLessThan(variantRoute.indexOf("tx.insert(layoutVariants)"));
  });

  it("pins event/phase ownership at the database boundary", async () => {
    const [schema, migration] = await Promise.all([
      readFile(resolve("src/db/schema.ts"), "utf-8"),
      readFile(resolve("drizzle/0045_event_scenario_phase_scope.sql"), "utf-8"),
    ]);
    expect(schema).toContain("event_phases_event_id_id_unique");
    expect(schema).toContain("event_scenarios_event_phase_fk");
    expect(migration).toContain('UNIQUE ("event_id", "id")');
    expect(migration).toContain('FOREIGN KEY ("event_id", "phase_id")');
    expect(migration).toContain('REFERENCES "event_phases" ("event_id", "id")');
    expect(migration).toContain('ON DELETE SET NULL ("phase_id")');
  });
});

// ---------------------------------------------------------------------------
// Event write surface — tenant isolation (T-540)
//
// The gap this pins shut: POST /events took a caller-supplied venueId and
// inserted the event plus its whole default phase scaffold with NO venue
// authorization. Any authenticated user could plant an event inside any
// venue — and, because every other event route gates on canAccessResource
// (owner OR venue manager), planting it made them its createdBy and handed
// them write access to that foreign venue's phases, scenarios and variants.
//
// The fix is two gates in a fixed order, mirroring the diary's write surface:
//   1. role   — staff/admin (or platform admin) → else 403 FORBIDDEN
//   2. scope  — the venue named by the body, or carried by the loaded row
//               → else 403 (VENUE_SCOPE_MISMATCH when a body names it)
//
// The role gate runs before body validation: an actor who can never write
// should not be told about the schema.
// ---------------------------------------------------------------------------

/** The by-id write routes, each with a payload their schema accepts. */
const BY_ID_WRITES: readonly {
  method: "POST" | "PATCH";
  url: string;
  payload: Record<string, unknown>;
}[] = [
  { method: "PATCH", url: `/events/${EVENT_ID}`, payload: { name: "Renamed" } },
  {
    method: "POST",
    url: `/events/${EVENT_ID}/phases`,
    payload: { name: "Drinks reception", durationMinutes: 45 },
  },
  {
    method: "POST",
    url: `/events/${EVENT_ID}/scenarios`,
    payload: { name: "Rain plan" },
  },
  {
    method: "POST",
    url: `/events/${EVENT_ID}/layout-variants`,
    payload: { name: "Dinner option A" },
  },
  { method: "PATCH", url: `/event-phases/${PHASE_ID}`, payload: { durationMinutes: 45 } },
];

describe("event write surface — tenant isolation (T-540)", () => {
  it("refuses cross-venue event creation, naming the scope mismatch", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: `Bearer ${staffToken(OTHER_VENUE_ID)}` },
      payload: validEventPayload(VENUE_ID),
    });
    expect(res.statusCode).toBe(403);
    expect(bodyCode(res.body)).toBe("VENUE_SCOPE_MISMATCH");
  });

  it("refuses creation by a venue-less actor", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: `Bearer ${staffToken(null)}` },
      payload: validEventPayload(),
    });
    expect(res.statusCode).toBe(403);
    expect(bodyCode(res.body)).toBe("VENUE_SCOPE_MISMATCH");
  });

  it("refuses hallkeeper creation — events are staff/admin territory", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: `Bearer ${hallkeeperToken()}` },
      payload: validEventPayload(),
    });
    expect(res.statusCode).toBe(403);
    expect(bodyCode(res.body)).toBe("FORBIDDEN");
  });

  it("refuses planner creation at their own venue", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: `Bearer ${plannerToken()}` },
      payload: validEventPayload(),
    });
    expect(res.statusCode).toBe(403);
    expect(bodyCode(res.body)).toBe("FORBIDDEN");
  });

  it("authorizes before it validates — a refused role never sees the schema", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: `Bearer ${hallkeeperToken()}` },
      payload: { venueId: VENUE_ID, name: "Wedding", status: "production ready" },
    });
    expect(res.statusCode).toBe(403);
    expect(bodyCode(res.body)).toBe("FORBIDDEN");
  });

  it("lets venue staff create in their own venue", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: validEventPayload(),
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("lets a platform admin create in any venue", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: `Bearer ${platformAdminToken()}` },
      payload: validEventPayload(OTHER_VENUE_ID),
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("refuses hallkeeper writes on every by-id event route", async () => {
    for (const surface of BY_ID_WRITES) {
      const res = await server.inject({
        method: surface.method,
        url: surface.url,
        headers: { authorization: `Bearer ${hallkeeperToken()}` },
        payload: surface.payload,
      });
      expect(res.statusCode, `${surface.method} ${surface.url}`).toBe(403);
      expect(bodyCode(res.body), `${surface.method} ${surface.url}`).toBe("FORBIDDEN");
    }
  });

  it("refuses planner writes on every by-id event route", async () => {
    for (const surface of BY_ID_WRITES) {
      const res = await server.inject({
        method: surface.method,
        url: surface.url,
        headers: { authorization: `Bearer ${plannerToken()}` },
        payload: surface.payload,
      });
      expect(res.statusCode, `${surface.method} ${surface.url}`).toBe(403);
      expect(bodyCode(res.body), `${surface.method} ${surface.url}`).toBe("FORBIDDEN");
    }
  });

  it("keeps event reads open to hallkeeper — only writes narrowed", async () => {
    for (const url of [`/events/${EVENT_ID}`, `/events/${EVENT_ID}/phase-graph`]) {
      const res = await server.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${hallkeeperToken()}` },
      });
      expect(res.statusCode, url).not.toBe(401);
      expect(res.statusCode, url).not.toBe(403);
    }
  });

  it("source contract: the role gate precedes body parsing on every write route", async () => {
    const source = await readFile(resolve("src/routes/events.ts"), "utf-8");
    const writeRoutes = [
      { start: 'server.post("/", ', end: 'server.get("/:id", ' },
      { start: 'server.patch("/:id", ', end: 'server.post("/:id/phases", ' },
      { start: 'server.post("/:id/phases", ', end: 'server.post("/:id/scenarios", ' },
      { start: 'server.post("/:id/scenarios", ', end: 'server.post("/:id/layout-variants", ' },
      { start: 'server.post("/:id/layout-variants", ', end: 'server.get("/:id/phase-graph", ' },
    ];
    for (const route of writeRoutes) {
      const startIndex = source.indexOf(route.start);
      const endIndex = source.indexOf(route.end);
      expect(startIndex, route.start).toBeGreaterThan(-1);
      expect(endIndex, route.end).toBeGreaterThan(startIndex);
      const slice = source.slice(startIndex, endIndex);
      const gate = slice.indexOf("requireEventWriteRole");
      const parse = slice.indexOf("Schema.safeParse(request.body)");
      expect(gate, `${route.start} has no role gate`).toBeGreaterThan(-1);
      expect(parse, `${route.start} has no body parse`).toBeGreaterThan(-1);
      expect(gate, `${route.start} parses before it authorizes`).toBeLessThan(parse);
    }
  });

  it("source contract: by-id writes resolve venue scope against the loaded row before writing", async () => {
    const source = await readFile(resolve("src/routes/events.ts"), "utf-8");
    // One copy of the load + venue policy, the loadAccessibleBooking precedent.
    expect(source).toContain("canWriteEvents(request.user, eventRow.venueId)");
    const writes = [
      { start: 'server.patch("/:id", ', mutate: "db.update(events)" },
      { start: 'server.post("/:id/phases", ', mutate: "db.insert(eventPhases)" },
      { start: 'server.post("/:id/scenarios", ', mutate: "db.insert(eventScenarios)" },
      { start: 'server.post("/:id/layout-variants", ', mutate: "tx.insert(layoutVariants)" },
    ];
    for (const write of writes) {
      const slice = source.slice(source.indexOf(write.start));
      const gate = slice.indexOf("requireEventWriteAccess");
      const mutate = slice.indexOf(write.mutate);
      expect(gate, `${write.start} has no write-access gate`).toBeGreaterThan(-1);
      expect(mutate, `${write.start} has no ${write.mutate}`).toBeGreaterThan(-1);
      expect(gate, `${write.start} writes before it authorizes`).toBeLessThan(mutate);
    }
  });

  it("source contract: the create route scopes the body's venue, not the row's", async () => {
    const source = await readFile(resolve("src/routes/events.ts"), "utf-8");
    const slice = source.slice(source.indexOf('server.post("/", '), source.indexOf('server.get("/:id", '));
    expect(slice).toContain("canWriteEvents(request.user, parsed.data.venueId)");
    expect(slice).toContain("VENUE_SCOPE_MISMATCH");
    expect(slice.indexOf("VENUE_SCOPE_MISMATCH")).toBeLessThan(slice.indexOf("tx.insert(events)"));
  });

  it("source contract: the phase-patch route gates on its joined event's venue", async () => {
    const source = await readFile(resolve("src/routes/events.ts"), "utf-8");
    const slice = source.slice(source.indexOf("export async function eventPhaseRoutes"));
    expect(slice).toContain("requireEventWriteRole");
    expect(slice).toContain("canWriteEvents(request.user, joined.event.venueId)");
    expect(slice).not.toContain("canAccessResource");
    expect(slice.indexOf("canWriteEvents")).toBeLessThan(slice.indexOf("db.update(eventPhases)"));
  });
});
