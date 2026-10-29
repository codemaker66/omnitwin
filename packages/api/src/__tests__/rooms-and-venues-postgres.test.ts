import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { spaceRoutes } from "../routes/spaces.js";
import { venueRoutes } from "../routes/venues.js";
import { insertBoundBookings } from "../services/event-binding.js";

// ---------------------------------------------------------------------------
// Rooms and venues on migrated PostgreSQL (admin-venues-3, -4, -5): a room
// still booked ahead cannot be deleted out from under its Diary; a room's or
// a venue's address that is already held answers 409, never 500, deleted
// holders included; a deleted room can be restored; and a venue's rooms come
// back in the venue's own order however the rows sit on disk.
//
// Never loads .env and never falls back to DATABASE_URL. The target is the
// explicitly named disposable cluster the request tests use.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_REQUESTS_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_lane9_test" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Room tests require the explicit disposable database venviewer_lane9_test on 127.0.0.1");
  }
}

const OUTLINE = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

describe.skipIf(target === undefined)("rooms and venues on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `rooms_${randomUUID()}`, max: 8, options: "-c statement_timeout=10000" });
    const name = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    expect(name).toBe("venviewer_lane9_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(venueRoutes, { db, prefix: "/venues" });
    await server.register(spaceRoutes, { db, prefix: "/venues/:venueId/spaces" });
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    if (server !== undefined) await server.close();
    if (pool !== undefined) await pool.end();
  });

  interface Person { readonly id: string; readonly role: string; readonly venueId: string | null; readonly platformRole?: string }

  function as(person: Person): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id: person.id, email: `${person.id}@rooms.invalid`, name: "Fixture person", role: person.role, venueId: person.venueId, platformRole: person.platformRole ?? "none" })}` };
  }

  async function fixture() {
    const venueId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY rooms", slug: venueId, address: "Disposable fixture" });
    const admin: Person = { id: randomUUID(), role: "admin", venueId };
    const hallkeeper: Person = { id: randomUUID(), role: "hallkeeper", venueId };
    for (const person of [admin, hallkeeper]) {
      await db.insert(schema.users).values({ id: person.id, venueId, name: "Fixture person", email: `${person.id}@rooms.invalid`, role: person.role });
    }
    return { venueId, admin, hallkeeper };
  }

  async function addRoom(venueId: string, by: Person, name: string, sortOrder = 0) {
    return server.inject({
      method: "POST", url: `/venues/${venueId}/spaces`, headers: as(by),
      payload: { name, slug: name.toLowerCase().replaceAll(" ", "-"), heightM: 7, floorPlanOutline: OUTLINE, sortOrder },
    });
  }

  async function roomId(venueId: string, by: Person, name: string, sortOrder = 0): Promise<string> {
    const res = await addRoom(venueId, by, name, sortOrder);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { data: { id: string } }).data.id;
  }

  async function roomNames(venueId: string): Promise<readonly string[]> {
    const res = await server.inject({ method: "GET", url: `/venues/${venueId}` });
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { data: { spaces: readonly { name: string }[] } }).data.spaces.map((space) => space.name);
  }

  const remove = (venueId: string, id: string, by: Person) => server.inject({ method: "DELETE", url: `/venues/${venueId}/spaces/${id}`, headers: as(by) });

  it("refuses to delete a room still booked ahead, says what holds it, and deletes it once the booking is released (admin-venues-3)", async () => {
    const f = await fixture();
    const hall = await roomId(f.venueId, f.admin, "Grand Hall");
    const [booking] = await insertBoundBookings(db, [{
      venueId: f.venueId, spaceId: hall, kind: "ink", title: "The Smith wedding", createdBy: f.admin.id,
      startsAt: new Date(Date.now() + 30 * 86_400_000), endsAt: new Date(Date.now() + 30 * 86_400_000 + 6 * 3_600_000),
    }]);
    if (booking === undefined) throw new Error("expected a booking");

    const refused = await remove(f.venueId, hall, f.admin);
    expect(refused.statusCode).toBe(409);
    expect(JSON.parse(refused.body)).toEqual({
      error: "Grand Hall has 1 booking still to come. Release or move them on the Diary before deleting the room.",
      code: "ROOM_HAS_BOOKINGS", details: { bookings: 1, phases: 0 },
    });
    expect(await roomNames(f.venueId)).toEqual(["Grand Hall"]);

    // A phase of an event still to come holds it too.
    await db.update(schema.bookings).set({ status: "released" }).where(eq(schema.bookings.id, booking.id));
    const [event] = await db.insert(schema.events).values({ venueId: f.venueId, name: "Spring fair", createdBy: f.admin.id }).returning();
    if (event === undefined) throw new Error("expected an event");
    const [phase] = await db.insert(schema.eventPhases).values({
      eventId: event.id, spaceId: hall, name: "Doors", sortOrder: 0, startsAt: new Date(Date.now() + 86_400_000), durationMinutes: 60,
    }).returning();
    const byPhase = await remove(f.venueId, hall, f.admin);
    expect(byPhase.statusCode).toBe(409);
    expect((JSON.parse(byPhase.body) as { details: unknown }).details).toEqual({ bookings: 0, phases: 1 });

    // Once nothing is to come, and only by the venue's administrators.
    await db.update(schema.eventPhases).set({ startsAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(schema.eventPhases.id, phase?.id ?? ""));
    expect((await remove(f.venueId, hall, f.hallkeeper)).statusCode).toBe(403);
    expect((await remove(f.venueId, hall, f.admin)).statusCode).toBe(204);
    expect(await roomNames(f.venueId)).toEqual([]);
  });

  it("answers a deleted room's address with 409, never 500, and restores the room it belongs to (admin-venues-3)", async () => {
    const f = await fixture();
    const hall = await roomId(f.venueId, f.admin, "Grand Hall");
    expect((await remove(f.venueId, hall, f.admin)).statusCode).toBe(204);

    const again = await addRoom(f.venueId, f.admin, "Grand Hall");
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body)).toEqual({
      error: "\"Grand Hall\" was deleted and still has this room's address. Restore it, or give the new room another name.",
      code: "SLUG_EXISTS", details: { deletedSpaceId: hall, deletedSpaceName: "Grand Hall" },
    });

    const restore = (by: Person) => server.inject({ method: "POST", url: `/venues/${f.venueId}/spaces/${hall}/restore`, headers: as(by) });
    expect((await restore(f.hallkeeper)).statusCode).toBe(403);
    const restored = await restore(f.admin);
    expect(restored.statusCode).toBe(200);
    expect((JSON.parse(restored.body) as { data: { id: string } }).data.id).toBe(hall);
    expect(await roomNames(f.venueId)).toEqual(["Grand Hall"]);
    expect((await restore(f.admin)).statusCode).toBe(404);
    // A live room's address is refused in plain words too.
    expect(JSON.parse((await addRoom(f.venueId, f.admin, "Grand Hall")).body)).toMatchObject({ code: "SLUG_EXISTS" });
  });

  it("lets one of two rooms added at once with the same address in, and answers the other 409 (admin-venues-3)", async () => {
    const f = await fixture();
    const results = await Promise.all([addRoom(f.venueId, f.admin, "Robert Adam Room"), addRoom(f.venueId, f.admin, "Robert Adam Room")]);
    expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
  });

  it("returns a venue's rooms in its own order, whichever row was written last (admin-venues-4)", async () => {
    const f = await fixture();
    const first = await roomId(f.venueId, f.admin, "Grand Hall", 0);
    await roomId(f.venueId, f.admin, "Robert Adam Room", 1);
    await roomId(f.venueId, f.admin, "Saloon", 2);
    await roomId(f.venueId, f.admin, "Courtyard", 2);
    // An update writes the row anew, at the end of the table.
    const patched = await server.inject({ method: "PATCH", url: `/venues/${f.venueId}/spaces/${first}`, headers: as(f.admin), payload: { description: "The main hall" } });
    expect(patched.statusCode).toBe(200);
    const order = ["Grand Hall", "Robert Adam Room", "Courtyard", "Saloon"];
    expect(await roomNames(f.venueId)).toEqual(order);
    const listed = await server.inject({ method: "GET", url: `/venues/${f.venueId}/spaces` });
    expect((JSON.parse(listed.body) as { data: readonly { name: string }[] }).data.map((space) => space.name)).toEqual(order);
  });

  it("answers a deleted venue's slug, and the loser of two creates at once, with 409, never 500 (admin-venues-5)", async () => {
    const platform: Person = { id: randomUUID(), role: "admin", venueId: null, platformRole: "admin" };
    await db.insert(schema.users).values({ id: platform.id, venueId: null, name: "Fixture person", email: `${platform.id}@rooms.invalid`, role: "admin", platformRole: "admin" });
    const create = (slug: string) => server.inject({ method: "POST", url: "/venues", headers: as(platform), payload: { name: "TEST ONLY venue", slug, address: "Disposable fixture" } });

    const slug = `fixture-${randomUUID().slice(0, 8)}`;
    const made = await create(slug);
    expect(made.statusCode, made.body).toBe(201);
    const id = (JSON.parse(made.body) as { data: { id: string } }).data.id;
    expect((await server.inject({ method: "DELETE", url: `/venues/${id}`, headers: as(platform) })).statusCode).toBeLessThan(300);
    const again = await create(slug);
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body)).toMatchObject({ code: "SLUG_EXISTS" });

    const raced = `fixture-${randomUUID().slice(0, 8)}`;
    const results = await Promise.all([create(raced), create(raced)]);
    expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
  });
});
