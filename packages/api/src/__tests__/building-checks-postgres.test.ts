import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addRotaDays, rotaLocalDate, type BuildingCheck, type BuildingChecksDay } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { buildingCheckRoutes } from "../routes/building-checks.js";
import { markBuildingCheck, unmarkBuildingCheck } from "../services/building-checks.js";
import type { RequestActor } from "../services/requests.js";

// ---------------------------------------------------------------------------
// Opening and lock-up (T-693) on the migrated disposable platform database:
//   - an administrator writes the venue's lists, each change from the list
//     they saw; a check taken off is retired and its ticked days keep it;
//   - the floor ticks a check on the board's day: two ticks at once write
//     one; a tick is taken back by whoever made it, or the office; and ticks
//     keep to the venue's board day, and last night's for a few hours after
//     the board rolls;
//   - a past day reads its list as it stood then;
//   - two administrators saving one list at once: one lands, one is refused;
//   - nobody else plans the lists, and another venue reads and ticks nothing.
// Never reads DATABASE_URL or an env file.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Building check tests require the explicit disposable platform database");
  }
}

const TODAY = rotaLocalDate(Date.now(), "Europe/London");

describe.skipIf(target === undefined)("opening and lock-up, on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `building_checks_${randomUUID()}`, max: 6,
      options: "-c statement_timeout=10000 -c lock_timeout=8000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(buildingCheckRoutes, { db, prefix: "/venues" });
    await server.ready();
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  async function fixture() {
    const venueId = randomUUID(), otherVenueId = randomUUID();
    const people = { admin: randomUUID(), staff: randomUUID(), hallkeeper: randomUUID(), porter: randomUUID(), other: randomUUID() };
    await db.insert(schema.venues).values([
      { id: venueId, name: "TEST ONLY building", slug: venueId, address: "Disposable fixture", timezone: "Europe/London" },
      { id: otherVenueId, name: "TEST ONLY another venue", slug: otherVenueId, address: "Disposable fixture", timezone: "Europe/London" },
    ]);
    await db.insert(schema.users).values([
      { id: people.admin, venueId, name: "Elaine", email: `${people.admin}@checks.invalid`, role: "admin" },
      { id: people.staff, venueId, name: "Fiona", email: `${people.staff}@checks.invalid`, role: "staff" },
      { id: people.hallkeeper, venueId, name: "Jamie", email: `${people.hallkeeper}@checks.invalid`, role: "hallkeeper" },
      { id: people.porter, venueId, name: "Ngozi", email: `${people.porter}@checks.invalid`, role: "hallkeeper" },
      { id: people.other, venueId: otherVenueId, name: "Elsewhere", email: `${people.other}@checks.invalid`, role: "admin" },
    ]);
    return { venueId, otherVenueId, people };
  }

  type Fixture = Awaited<ReturnType<typeof fixture>>;
  type Who = keyof Fixture["people"];

  function as(f: Fixture, who: Who): { authorization: string } {
    const id = f.people[who];
    const role = { admin: "admin", staff: "staff", hallkeeper: "hallkeeper", porter: "hallkeeper", other: "admin" }[who];
    const name = { admin: "Elaine", staff: "Fiona", hallkeeper: "Jamie", porter: "Ngozi", other: "Elsewhere" }[who];
    const venueId = who === "other" ? f.otherVenueId : f.venueId;
    return { authorization: `Bearer ${JSON.stringify({ id, email: `${id}@checks.invalid`, name, role, platformRole: "none", venueId })}` };
  }

  async function call(f: Fixture, who: Who, method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: Record<string, unknown>) {
    const response = await server.inject({ method, url, headers: as(f, who), ...(payload === undefined ? {} : { payload }) });
    const body = response.body === "" ? {} : response.json<{ data?: unknown; code?: string }>();
    return { status: response.statusCode, data: body.data, code: body.code };
  }

  async function day(f: Fixture, who: Who = "hallkeeper", date = TODAY): Promise<BuildingChecksDay> {
    const read = await call(f, who, "GET", `/venues/${f.venueId}/building-checks?day=${date}`);
    expect(read.status).toBe(200);
    return read.data as BuildingChecksDay;
  }

  it("lets an administrator write the venue's lists, each change from the list they saw", async () => {
    const f = await fixture();
    expect(await day(f)).toEqual({ day: TODAY, opening: [], lockup: [] });
    const first = await call(f, "admin", "PUT", `/venues/${f.venueId}/building-checks/lockup`, {
      expected: [], items: [{ label: " Fire doors shut " }, { label: "Alarm set" }],
    });
    expect(first.status).toBe(200);
    const [doors, alarm] = first.data as BuildingCheck[];
    expect([doors?.label, alarm?.label]).toEqual(["Fire doors shut", "Alarm set"]);

    // Moved, renamed, one added: the same checks keep their ids.
    const second = await call(f, "staff", "PUT", `/venues/${f.venueId}/building-checks/lockup`, {
      expected: [doors?.id, alarm?.id], items: [{ id: alarm?.id, label: "Alarm set, zone 1" }, { id: doors?.id, label: "Fire doors shut" }, { label: "Keys back in the safe" }],
    });
    expect((second.data as BuildingCheck[]).map((check) => [check.id === alarm?.id, check.label])).toEqual([
      [true, "Alarm set, zone 1"], [false, "Fire doors shut"], [false, "Keys back in the safe"],
    ]);
    // A change from the list as it first was is refused, and changes nothing.
    const stale = await call(f, "admin", "PUT", `/venues/${f.venueId}/building-checks/lockup`, { expected: [doors?.id, alarm?.id], items: [] });
    expect([stale.status, stale.code]).toEqual([409, "STALE_CHECKS"]);
    expect((await day(f)).lockup).toHaveLength(3);
    // The floor does not write the lists, and another venue's check cannot be named.
    expect((await call(f, "hallkeeper", "PUT", `/venues/${f.venueId}/building-checks/opening`, { expected: [], items: [{ label: "x" }] })).status).toBe(403);
    const foreign = await call(f, "admin", "PUT", `/venues/${f.venueId}/building-checks/opening`, { expected: [], items: [{ id: randomUUID(), label: "x" }] });
    expect([foreign.status, foreign.code]).toEqual([400, "UNKNOWN_CHECK"]);
  });

  it("lets the floor tick a check on the day, once however many tap, and take it back", async () => {
    const f = await fixture();
    const [alarm] = (await call(f, "admin", "PUT", `/venues/${f.venueId}/building-checks/opening`, { expected: [], items: [{ label: "Alarm unset" }] })).data as BuildingCheck[];
    const url = `/venues/${f.venueId}/building-checks/${alarm?.id ?? ""}/marks`;
    const [a, b] = await Promise.all([
      call(f, "hallkeeper", "POST", url, { day: TODAY }),
      call(f, "porter", "POST", url, { day: TODAY }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((a.data as BuildingCheck).mark).toEqual((b.data as BuildingCheck).mark);
    expect(["Jamie", "Ngozi"]).toContain((a.data as BuildingCheck).mark?.doneByName);
    expect((await day(f)).opening[0]?.mark).toEqual((a.data as BuildingCheck).mark);
    // Another day's board starts unticked.
    expect((await day(f, "hallkeeper", addRotaDays(TODAY, 1))).opening[0]?.mark).toBeNull();

    // Whoever's tap landed takes it back.
    const ticker: Who = (a.data as BuildingCheck).mark?.doneByName === "Jamie" ? "hallkeeper" : "porter";
    const back = await call(f, ticker, "DELETE", `${url}?day=${TODAY}`);
    expect((back.data as BuildingCheck).mark).toBeNull();
    expect((await day(f)).opening[0]?.mark).toBeNull();

    // Only near today: next week's board cannot be ticked.
    const far = await call(f, "hallkeeper", "POST", url, { day: addRotaDays(TODAY, 7) });
    expect([far.status, far.code]).toEqual([400, "CHECK_DAY_OUT_OF_RANGE"]);
  });

  it("keeps a check taken off the list on a day it was ticked, and off the days after", async () => {
    const f = await fixture();
    const [lights] = (await call(f, "admin", "PUT", `/venues/${f.venueId}/building-checks/lockup`, { expected: [], items: [{ label: "Lights off" }] })).data as BuildingCheck[];
    await call(f, "hallkeeper", "POST", `/venues/${f.venueId}/building-checks/${lights?.id ?? ""}/marks`, { day: TODAY });
    await call(f, "admin", "PUT", `/venues/${f.venueId}/building-checks/lockup`, { expected: [lights?.id], items: [] });
    expect((await day(f)).lockup).toMatchObject([{ label: "Lights off", retired: true, mark: { doneByName: "Jamie" } }]);
    expect((await day(f, "hallkeeper", addRotaDays(TODAY, 1))).lockup).toEqual([]);
    // A check off the list cannot be ticked again, but its tick can still be taken back.
    const retired = await call(f, "porter", "POST", `/venues/${f.venueId}/building-checks/${lights?.id ?? ""}/marks`, { day: TODAY });
    expect(retired.status).toBe(404);
    const back = await call(f, "hallkeeper", "DELETE", `/venues/${f.venueId}/building-checks/${lights?.id ?? ""}/marks?day=${TODAY}`);
    expect([back.status, (back.data as BuildingCheck).mark]).toEqual([200, null]);
    expect((await day(f)).lockup).toEqual([]);
  });

  it("takes a tick back only for whoever made it, or the office", async () => {
    const f = await fixture();
    const [alarm] = (await call(f, "admin", "PUT", `/venues/${f.venueId}/building-checks/lockup`, { expected: [], items: [{ label: "Alarm set" }] })).data as BuildingCheck[];
    const url = `/venues/${f.venueId}/building-checks/${alarm?.id ?? ""}/marks`;
    const ticked = await call(f, "hallkeeper", "POST", url, { day: TODAY });
    expect((ticked.data as BuildingCheck).mark).toMatchObject({ doneByUserId: f.people.hallkeeper, doneByName: "Jamie" });
    const colleague = await call(f, "porter", "DELETE", `${url}?day=${TODAY}`);
    expect([colleague.status, colleague.code]).toEqual([403, "TICK_NOT_YOURS"]);
    expect((await day(f)).lockup[0]?.mark?.doneByName).toBe("Jamie");
    expect((await call(f, "staff", "DELETE", `${url}?day=${TODAY}`)).status).toBe(200);
    expect((await day(f)).lockup[0]?.mark).toBeNull();
  });

  it("keeps ticks to the venue's board day, and last night's for a few hours after the board rolls", async () => {
    const f = await fixture();
    // The venue's board rolls at 04:00 (December is on GMT).
    await db.insert(schema.venueSettings).values({ venueId: f.venueId, requestEscalationSeconds: 300, dayBoundaryHour: 4 });
    const [alarm] = (await call(f, "admin", "PUT", `/venues/${f.venueId}/building-checks/lockup`, { expected: [], items: [{ label: "Alarm set" }] })).data as BuildingCheck[];
    const actor: RequestActor = { id: f.people.hallkeeper, name: "Jamie", role: "hallkeeper", venueId: f.venueId, platformRole: "none" };
    const at = (iso: string) => () => new Date(iso);
    const tick = (day: string, now: string) => markBuildingCheck(db, actor, f.venueId, alarm?.id ?? "", day, at(now));
    // 05:00 Sunday: the board shows Sunday, and Saturday night's lock-up may still be ticked.
    expect(await tick("2026-12-05", "2026-12-06T05:00:00.000Z")).toMatchObject({ mark: { doneByName: "Jamie" } });
    expect(await tick("2026-12-06", "2026-12-06T05:00:00.000Z")).toMatchObject({ mark: { doneByName: "Jamie" } });
    expect(await tick("2026-12-07", "2026-12-06T05:00:00.000Z")).toMatchObject({ status: 400, code: "CHECK_DAY_OUT_OF_RANGE" });
    // 03:30 Sunday is still Saturday's board.
    expect(await tick("2026-12-06", "2026-12-06T03:30:00.000Z")).toMatchObject({ status: 400, code: "CHECK_DAY_OUT_OF_RANGE" });
    // By Sunday afternoon, Saturday is history, to tick and to take back.
    expect(await tick("2026-12-05", "2026-12-06T13:00:00.000Z")).toMatchObject({ status: 400, code: "CHECK_DAY_OUT_OF_RANGE" });
    expect(await unmarkBuildingCheck(db, actor, f.venueId, alarm?.id ?? "", "2026-12-05", at("2026-12-06T13:00:00.000Z")))
      .toMatchObject({ status: 400, code: "CHECK_DAY_OUT_OF_RANGE" });
  });

  it("reads a past day's list as it stood that day", async () => {
    const f = await fixture();
    const created = new Date("2026-11-01T09:00:00.000Z");
    const [doors, lights, keys] = await db.insert(schema.venueBuildingChecks).values([
      { venueId: f.venueId, kind: "lockup", label: "Fire doors shut", sortOrder: 0, createdAt: created },
      { venueId: f.venueId, kind: "lockup", label: "Lights off", sortOrder: 1, createdAt: created, retiredAt: new Date("2026-11-10T09:00:00.000Z") },
      { venueId: f.venueId, kind: "lockup", label: "Keys back in the safe", sortOrder: 2, createdAt: new Date("2026-11-10T09:00:00.000Z") },
    ]).returning();
    await db.insert(schema.venueBuildingCheckMarks).values({
      venueId: f.venueId, checkId: doors?.id ?? "", boardDay: "2026-11-05", doneAt: new Date("2026-11-05T23:10:00.000Z"), doneByName: "Jamie",
    });
    const lockup = async (date: string) => (await day(f, "hallkeeper", date)).lockup.map((check) => [check.label, check.retired, check.mark?.doneByName ?? null]);
    // The 5th: the list as it was, the missed check still missed, nothing written later.
    expect(await lockup("2026-11-05")).toEqual([["Fire doors shut", false, "Jamie"], ["Lights off", false, null]]);
    expect(await lockup("2026-11-09")).toEqual([["Fire doors shut", false, null], ["Lights off", false, null]]);
    // The 10th: lights off the list, keys on it.
    expect(await lockup("2026-11-10")).toEqual([["Fire doors shut", false, null], ["Keys back in the safe", false, null]]);
    expect([lights?.id, keys?.id].every((id) => typeof id === "string")).toBe(true);
  });

  it("lets one of two administrators saving one list at once land, and refuses the other", async () => {
    const f = await fixture();
    const [doors] = (await call(f, "admin", "PUT", `/venues/${f.venueId}/building-checks/lockup`, { expected: [], items: [{ label: "Fire doors shut" }] })).data as BuildingCheck[];
    let expected = [doors?.id ?? ""];
    for (let round = 0; round < 8; round += 1) {
      const both = await Promise.all([
        call(f, "admin", "PUT", `/venues/${f.venueId}/building-checks/lockup`, { expected, items: [...expected.map((id) => ({ id, label: "Fire doors shut" })), { label: `Elaine's ${String(round)}` }] }),
        call(f, "staff", "PUT", `/venues/${f.venueId}/building-checks/lockup`, { expected, items: [...expected.map((id) => ({ id, label: "Fire doors shut" })), { label: `Fiona's ${String(round)}` }] }),
      ]);
      expect(both.map((result) => result.status).sort()).toEqual([200, 409]);
      expected = (both.find((result) => result.status === 200)?.data as BuildingCheck[]).map((check) => check.id);
    }
    expect((await day(f)).lockup).toHaveLength(9);
  });

  it("refuses a day that is not a date, and records a long name at the box", async () => {
    const f = await fixture();
    expect((await call(f, "hallkeeper", "GET", `/venues/${f.venueId}/building-checks?day=2026-02-30`)).status).toBe(400);
    const [alarm] = (await call(f, "admin", "PUT", `/venues/${f.venueId}/building-checks/opening`, { expected: [], items: [{ label: "Alarm unset" }] })).data as BuildingCheck[];
    const id = f.people.hallkeeper;
    const response = await server.inject({
      method: "POST", url: `/venues/${f.venueId}/building-checks/${alarm?.id ?? ""}/marks`, payload: { day: TODAY },
      headers: { authorization: `Bearer ${JSON.stringify({ id, email: `${id}@checks.invalid`, name: "J".repeat(200), role: "hallkeeper", platformRole: "none", venueId: f.venueId })}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: BuildingCheck }>().data.mark?.doneByName).toHaveLength(160);
  });

  it("keeps each venue to its own lists and ticks", async () => {
    const f = await fixture();
    const [alarm] = (await call(f, "admin", "PUT", `/venues/${f.venueId}/building-checks/opening`, { expected: [], items: [{ label: "Alarm unset" }] })).data as BuildingCheck[];
    expect((await call(f, "other", "GET", `/venues/${f.venueId}/building-checks?day=${TODAY}`)).status).toBe(403);
    expect((await call(f, "other", "PUT", `/venues/${f.venueId}/building-checks/opening`, { expected: [alarm?.id], items: [] })).status).toBe(403);
    // Through their own venue's path, ours reads as absent.
    expect((await call(f, "other", "POST", `/venues/${f.otherVenueId}/building-checks/${alarm?.id ?? ""}/marks`, { day: TODAY })).status).toBe(404);
    expect((await call(f, "other", "GET", `/venues/${f.otherVenueId}/building-checks?day=${TODAY}`)).data).toEqual({ day: TODAY, opening: [], lockup: [] });
  });
});
