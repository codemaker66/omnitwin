import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LAYOUT_STYLES } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { transitionBookingCore, type MutationActor } from "../services/booking-mutations.js";
import { proposeWindowCore, type ProposalDeny } from "../services/window-proposals.js";

// Goal 19 S6 — the contract a client can only create or move a HOLD: proved
// on real rows, never through a mock. The client's side is admitted by the
// live event link (goal 15's revocation contract holds here too), the office
// by its venue, nobody else; the hold carries the hygiene the Diary demands
// with the office as its owner; a replayed key is the same hold; a decided
// (inked) window is no longer the client's to move; and the client can never
// ink.
//
// Never loads .env and never falls back to DATABASE_URL. The target must be
// the explicitly named disposable cluster for this slice on this machine.
process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_S6_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_s6_test" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Window proposal tests require the explicit disposable database venviewer_s6_test on 127.0.0.1");
  }
}

function isDeny(result: unknown): result is ProposalDeny {
  return typeof result === "object" && result !== null && "ok" in result && (result as { readonly ok: unknown }).ok === false;
}
function granted<T>(result: T | ProposalDeny): Exclude<T, ProposalDeny> {
  if (isDeny(result)) throw new Error(`expected success, got ${result.code}: ${result.error}`);
  return result as Exclude<T, ProposalDeny>;
}
function refused(result: unknown): ProposalDeny {
  if (!isDeny(result)) throw new Error("expected a refusal");
  return result;
}

const DAY = "2030-05-10";
const at = (hhmm: string, day = DAY): string => `${day}T${hhmm}:00.000Z`;

describe.skipIf(target === undefined)("window proposals on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `s6_proposals_${randomUUID()}`, max: 8,
      options: "-c statement_timeout=10000 -c lock_timeout=8000" });
    const name = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    expect(name).toBe("venviewer_s6_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
  }, 180_000);

  afterAll(async () => { await pool.end(); });

  interface Fixture {
    readonly venueId: string;
    readonly roomId: string;
    readonly otherRoomId: string;
    readonly eventId: string;
    readonly configurationId: string;
    readonly admin: MutationActor & { readonly name: string };
    readonly staff: MutationActor & { readonly name: string };
    readonly manager: MutationActor & { readonly name: string };
    readonly sales: MutationActor & { readonly name: string };
    readonly hallkeeper: MutationActor & { readonly name: string };
    readonly client: MutationActor & { readonly name: string };
    readonly planner: MutationActor & { readonly name: string };
    readonly stranger: MutationActor & { readonly name: string };
  }

  async function fixture(): Promise<Fixture> {
    const venueId = randomUUID(), otherVenueId = randomUUID(), roomId = randomUUID(), otherRoomId = randomUUID();
    const eventId = randomUUID(), configurationId = randomUUID();
    const outline = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    for (const id of [venueId, otherVenueId]) {
      await db.insert(schema.venues).values({ id, name: "TEST ONLY s6 proposals", slug: id, address: "Disposable fixture" });
    }
    await db.insert(schema.spaces).values([
      { id: roomId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10", heightM: "7", floorPlanOutline: outline },
      { id: otherRoomId, venueId: otherVenueId, name: "Elsewhere", slug: "elsewhere", widthM: "9", lengthM: "9", heightM: "3", floorPlanOutline: outline },
    ]);
    const person = (role: string, name: string, venue: string | null = venueId) => ({ id: randomUUID(), role, venueId: venue, name, platformRole: "none" as const });
    const people = {
      admin: person("admin", "Isla Office"), staff: person("staff", "Fiona Desk"), manager: person("manager", "Morven Manager"),
      sales: person("sales", "Rab Sales"), hallkeeper: person("hallkeeper", "Callum Hallkeeper"),
      client: person("client", "Morag Client", null), planner: person("planner", "Pat Planner", null), stranger: person("client", "Somebody Else", null),
    };
    for (const p of Object.values(people)) {
      await db.insert(schema.users).values({ id: p.id, venueId: p.venueId, name: p.name, email: `${p.id}@s6.invalid`, role: p.role });
    }
    await db.insert(schema.events).values({ id: eventId, venueId, name: "Fixture dinner", eventType: "dinner", createdBy: people.admin.id, guestCount: 120 });
    // The client's plan, linked to the event: the one path that admits a client.
    await db.insert(schema.configurations).values({
      id: configurationId, spaceId: roomId, venueId, userId: people.client.id, name: "The client plan", layoutStyle: LAYOUT_STYLES[0],
    });
    await db.insert(schema.eventConfigurationLinks).values({ id: randomUUID(), eventId, configurationId, linkType: "source_configuration" });
    // The planner's own plan on the same event.
    const plannerPlan = randomUUID();
    await db.insert(schema.configurations).values({
      id: plannerPlan, spaceId: roomId, venueId, userId: people.planner.id, name: "The planner plan", layoutStyle: LAYOUT_STYLES[0],
    });
    await db.insert(schema.eventConfigurationLinks).values({ id: randomUUID(), eventId, configurationId: plannerPlan, linkType: "source_configuration" });
    return { venueId, roomId, otherRoomId, eventId, configurationId, ...people };
  }

  const propose = (f: Fixture, actor: MutationActor & { readonly name: string }, from: string, to: string, key = randomUUID(), spaceId?: string) =>
    proposeWindowCore(db, actor, f.eventId, { spaceId: spaceId ?? f.roomId, startsAt: at(from), endsAt: at(to), idempotencyKey: key });

  async function stored(bookingId: string) {
    const [row] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    if (row === undefined) throw new Error("missing booking");
    return row;
  }

  it("lets the client propose a window as a hold the office owns, with the Diary's hygiene, and answers the client's narrow slot", async () => {
    const f = await fixture();
    const made = granted(await propose(f, f.client, "18:00", "23:00"));
    expect(made.replay).toBe(false);
    expect(made.slot).toMatchObject({ kind: "hold", title: "Fixture dinner", space: { id: f.roomId, name: "Grand Hall" }, startsAt: at("18:00"), endsAt: at("23:00") });
    expect(Object.keys(made.slot).sort()).toEqual(["bookingId", "endsAt", "kind", "space", "startsAt", "title"]);
    const row = await stored(made.slot.bookingId);
    expect(row).toMatchObject({ kind: "hold", status: "active", eventId: f.eventId, spaceId: f.roomId, createdBy: f.client.id, rank: 1, ownerUserId: f.admin.id });
    expect(row.decisionAt).not.toBeNull();
    expect(row.nextActionDueAt).not.toBeNull();
    expect(row.nextAction).toContain("Morag Client");
    expect(row.decisionAt?.getTime()).toBeLessThan(Date.parse(at("18:00")));
  });

  it("replays the same key as the same hold, and moves the hold on a new key instead of making a second", async () => {
    const f = await fixture();
    const key = randomUUID();
    const first = granted(await propose(f, f.client, "18:00", "23:00", key));
    const again = granted(await propose(f, f.client, "18:00", "23:00", key));
    expect(again.replay).toBe(true);
    expect(again.slot.bookingId).toBe(first.slot.bookingId);
    const moved = granted(await propose(f, f.client, "19:00", "23:30"));
    expect(moved.replay).toBe(false);
    expect(moved.slot.bookingId).toBe(first.slot.bookingId);
    expect(await stored(first.slot.bookingId)).toMatchObject({ startsAt: new Date(at("19:00")), endsAt: new Date(at("23:30")), kind: "hold" });
    const holds = await db.select({ id: schema.bookings.id }).from(schema.bookings)
      .where(and(eq(schema.bookings.eventId, f.eventId), eq(schema.bookings.createdBy, f.client.id)));
    expect(holds).toHaveLength(1);
  });

  it("admits a planner by their own link and the office at its venue; refuses manager, sales and hallkeeper", async () => {
    const f = await fixture();
    granted(await propose(f, f.planner, "12:00", "16:00"));
    const byStaff = granted(await propose(f, f.staff, "09:00", "11:00"));
    expect((await stored(byStaff.slot.bookingId)).ownerUserId).toBe(f.staff.id);
    for (const actor of [f.manager, f.sales, f.hallkeeper]) {
      expect(refused(await propose(f, actor, "12:00", "16:00")).status, actor.role).toBe(403);
    }
  });

  it("refuses a client with no link, and closes the door the instant the plan is deleted", async () => {
    const f = await fixture();
    expect(refused(await propose(f, f.stranger, "18:00", "23:00")).status).toBe(403);
    granted(await propose(f, f.client, "18:00", "23:00"));
    await db.update(schema.configurations).set({ deletedAt: new Date() }).where(eq(schema.configurations.id, f.configurationId));
    expect(refused(await propose(f, f.client, "19:00", "23:00")).status).toBe(403);
  });

  it("keeps the hold a hold: the client can never ink, and a window the office inked is no longer theirs to move", async () => {
    const f = await fixture();
    const made = granted(await propose(f, f.client, "18:00", "23:00"));
    expect(await transitionBookingCore(db, f.client, made.slot.bookingId, { toState: "ink" })).toMatchObject({ ok: false, status: 403 });
    expect(await transitionBookingCore(db, f.staff, made.slot.bookingId, { toState: "ink" })).toMatchObject({ ok: true });
    const decided = refused(await propose(f, f.client, "19:00", "23:30"));
    expect(decided.status).toBe(409);
    expect(decided.code).toBe("WINDOW_DECIDED");
    expect(await stored(made.slot.bookingId)).toMatchObject({ kind: "ink", startsAt: new Date(at("18:00")) });
  });

  it("refuses a window that has already ended, a room of another venue, and an event that does not exist", async () => {
    const f = await fixture();
    expect(refused(await propose(f, f.client, "18:00", "23:00", randomUUID(), f.otherRoomId)).code).toBe("SPACE_VENUE_MISMATCH");
    const past = refused(await proposeWindowCore(db, f.client, f.eventId, {
      spaceId: f.roomId, startsAt: "2020-01-01T18:00:00.000Z", endsAt: "2020-01-01T23:00:00.000Z", idempotencyKey: randomUUID(),
    }));
    expect(past.code).toBe("WINDOW_PAST");
    expect(refused(await proposeWindowCore(db, f.client, randomUUID(), {
      spaceId: f.roomId, startsAt: at("18:00"), endsAt: at("23:00"), idempotencyKey: randomUUID(),
    })).status).toBe(404);
  });
});
