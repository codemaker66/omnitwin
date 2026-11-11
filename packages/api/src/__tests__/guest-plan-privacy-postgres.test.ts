import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema.js";

// ---------------------------------------------------------------------------
// Who can find and read a guest's plan (final review, TENANCY-3).
//
// A guest's plan is public: anyone holding its id can open it. The id is one
// lookup away from the plan's six-character code, so how fast codes can be
// tried decides how findable every plan is.
//
// This drives the whole app, with its real rate limiter, on the migrated
// database.
//
// Opt-in, disposable PostgreSQL only. The server it builds is pointed at the
// validated URL in-process; .env is never consulted.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Guest plan privacy tests require the explicit disposable platform database");
  }
}

interface Plan { readonly id: string; revision: number; readonly shortCode: string; readonly claimSecret: string }

const NOON = Date.UTC(2026, 10, 11, 12, 0, 0);
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/** A well-formed six-character code nobody was given. */
function madeUpCode(n: number): string {
  const digits = [n % 31, Math.floor(n / 31) % 31].map((digit) => CODE_ALPHABET.charAt(digit));
  return `zzzz${digits.join("")}`;
}

describe.skipIf(target === undefined)("who can find and read a guest's plan, through the whole app", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const venueId = randomUUID();
  const spaceId = randomUUID();
  const chairId = randomUUID();

  async function newPlan(): Promise<Plan> {
    const response = await server.inject({ method: "POST", url: "/public/configurations", payload: { spaceId } });
    expect(response.statusCode, response.body.slice(0, 300)).toBe(201);
    return response.json<{ data: Plan }>().data;
  }

  async function lookUp(code: string): Promise<{ statusCode: number; status: string | undefined; configId: string | undefined }> {
    const response = await server.inject({ method: "GET", url: `/layouts/resolve?path=${encodeURIComponent(`/plan/${code}`)}` });
    const body = response.json<{ status?: string; configId?: string }>();
    return { statusCode: response.statusCode, status: body.status, configId: body.configId };
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `guest_plan_privacy_${randomUUID()}`, max: 2 });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    const db = drizzle(pool, { schema });
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY guest privacy venue", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Room", slug: "room", widthM: "20", lengthM: "20", heightM: "4",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] });
    await db.insert(schema.assetDefinitions).values({ id: chairId, name: "TEST ONLY guest privacy chair", category: "chair", widthM: "0.5", depthM: "0.5", heightM: "0.9" });

    process.env["DATABASE_URL"] = target;
    process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
    const { buildServer } = await import("../index.js");
    server = await buildServer();
  }, 180_000);

  afterEach(() => { vi.useRealTimers(); });

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  it("answers thirty code lookups a minute from one address, then refuses guesses until the minute is out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOON);
    const plan = await newPlan();

    // The plan's own code still finds it.
    expect(await lookUp(plan.shortCode)).toEqual({ statusCode: 200, status: "canonical", configId: plan.id });

    const guesses: number[] = [];
    for (let n = 0; n < 29; n += 1) guesses.push((await lookUp(madeUpCode(n))).statusCode);
    expect(guesses.filter((status) => status !== 200)).toEqual([]);

    // The thirty-first lookup in the minute, whatever it asks for, is refused.
    expect((await lookUp(madeUpCode(29))).statusCode).toBe(429);
    expect((await lookUp(plan.shortCode)).statusCode).toBe(429);

    vi.setSystemTime(NOON + 61_000);
    expect(await lookUp(plan.shortCode)).toEqual({ statusCode: 200, status: "canonical", configId: plan.id });
  }, 60_000);

  // -------------------------------------------------------------------------
  // What a holder of the id reads. A piece's note is whatever the guest typed
  // on a table ("nut allergy, seat by the door"), and the venue's review note
  // and event instructions sit on the same row. Only the browser that made the
  // plan, which alone was given its claim secret, reads them back; staff read
  // them signed in, through the authenticated route.
  // -------------------------------------------------------------------------

  const ALLERGY = "TEST ONLY nut allergy, seat by the door";
  const REVIEW = "TEST ONLY review: move the bar off the fire exit";
  const ACCESS = "TEST ONLY two wheelchair users at the top table";

  interface StoredPiece { readonly id: string; readonly positionX: string; readonly metadata: Record<string, unknown> | null }
  interface PlanRead { readonly reviewNote: string | null; readonly metadata: unknown; readonly objects: readonly StoredPiece[] }

  function asHolder(secret: string | undefined): { headers?: Record<string, string> } {
    return secret === undefined ? {} : { headers: { "x-plan-claim-secret": secret } };
  }

  function piece(x: number, notes?: string, id?: string): Record<string, unknown> {
    return {
      ...(id === undefined ? {} : { id }),
      assetDefinitionId: chairId, positionX: x, positionY: 0, positionZ: 5,
      rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: x,
      metadata: { clothed: false, groupId: null, ...(notes === undefined ? {} : { notes }) },
    };
  }

  async function read(planId: string, secret?: string): Promise<{ body: string; plan: PlanRead }> {
    const response = await server.inject({ method: "GET", url: `/public/configurations/${planId}`, ...asHolder(secret) });
    expect(response.statusCode, response.body.slice(0, 300)).toBe(200);
    return { body: response.body, plan: response.json<{ data: PlanRead }>().data };
  }

  async function save(plan: Plan, pieces: readonly Record<string, unknown>[], secret?: string): Promise<{ body: string; objects: readonly StoredPiece[] }> {
    const response = await server.inject({
      method: "POST", url: `/public/configurations/${plan.id}/objects/batch`, ...asHolder(secret),
      payload: { expectedRevision: plan.revision, objects: pieces },
    });
    expect(response.statusCode, response.body.slice(0, 300)).toBe(200);
    const data = response.json<{ data: { revision: number; objects: StoredPiece[] } }>().data;
    plan.revision = data.revision;
    return { body: response.body, objects: data.objects };
  }

  /** Each piece's note, by where it stands. */
  function notesByPosition(pieces: readonly StoredPiece[]): Record<string, unknown> {
    return Object.fromEntries(pieces.map((stored) => [String(Number(stored.positionX)), stored.metadata?.["notes"] ?? null]));
  }

  async function venueWrites(planId: string): Promise<void> {
    await pool.query(
      "UPDATE configurations SET review_note = $2, metadata = $3::jsonb WHERE id = $1",
      [planId, REVIEW, JSON.stringify({ instructions: { accessNotes: ACCESS } })],
    );
  }

  it("gives a plan's piece notes, review note and event instructions only to the browser that made it", async () => {
    const plan = await newPlan();
    await save(plan, [piece(2, ALLERGY), piece(4)], plan.claimSecret);
    await venueWrites(plan.id);

    // Anyone with the id still sees the layout itself.
    for (const stranger of [undefined, "not-the-secret-this-plan-was-given"]) {
      const { body, plan: seen } = await read(plan.id, stranger);
      expect(seen.objects.map((stored) => Number(stored.positionX))).toEqual([2, 4]);
      expect(notesByPosition(seen.objects)).toEqual({ 2: null, 4: null });
      expect({ reviewNote: seen.reviewNote, metadata: seen.metadata }).toEqual({ reviewNote: null, metadata: null });
      for (const kept of [ALLERGY, REVIEW, ACCESS]) expect(body.includes(kept), kept).toBe(false);
    }

    // The browser that made it reads everything, as before.
    const { plan: own } = await read(plan.id, plan.claimSecret);
    expect(notesByPosition(own.objects)).toEqual({ 2: ALLERGY, 4: null });
    expect(own.reviewNote).toBe(REVIEW);
    expect(own.metadata).toEqual({ instructions: { accessNotes: ACCESS } });

    // The same holds for the picture upload's answer, which returns the plan's row.
    for (const secret of [undefined, plan.claimSecret]) {
      const picture = await server.inject({
        method: "POST", url: `/public/configurations/${plan.id}/thumbnail`, ...asHolder(secret),
        payload: { thumbnailUrl: "data:image/png;base64,iVBORw0KGgo=" },
      });
      expect(picture.statusCode, picture.body.slice(0, 300)).toBe(200);
      expect(picture.body.includes(REVIEW)).toBe(secret !== undefined);
      expect(picture.body.includes(ACCESS)).toBe(secret !== undefined);
    }
  });

  it("lets a browser without the secret move pieces and add notes, but never read, change or clear a note the plan holds", async () => {
    const plan = await newPlan();
    const made = await save(plan, [piece(2, ALLERGY), piece(4)], plan.claimSecret);
    const withNote = made.objects.find((stored) => stored.metadata?.["notes"] === ALLERGY);
    const bare = made.objects.find((stored) => stored.metadata?.["notes"] === undefined);
    if (withNote === undefined || bare === undefined) throw new Error("Fixture pieces not stored");

    // A friend opens the link: no notes. They move the noted piece (sending it
    // back as they saw it, without its note), write on the bare one, add a third.
    const friend = { ...plan };
    const theirSave = await save(friend, [
      piece(3, undefined, withNote.id),
      piece(4, "TEST ONLY from a friend", bare.id),
      piece(6, "TEST ONLY a new table"),
    ]);
    // Their own save's answer tells them no note either.
    expect(notesByPosition(theirSave.objects)).toEqual({ 3: null, 4: null, 6: null });
    expect(theirSave.body.includes(ALLERGY)).toBe(false);

    // The maker still has their note, on the piece where the friend left it,
    // and now reads the friend's.
    expect(notesByPosition((await read(plan.id, plan.claimSecret)).plan.objects))
      .toEqual({ 3: ALLERGY, 4: "TEST ONLY from a friend", 6: "TEST ONLY a new table" });

    // Nor can the note be overwritten by somebody who could not read it.
    await save(friend, [piece(3, "TEST ONLY overwritten", withNote.id)]);
    expect(notesByPosition((await read(plan.id, plan.claimSecret)).plan.objects)).toEqual({ 3: ALLERGY });
  });

  it("still lets the browser that made the plan change and clear its own notes", async () => {
    const plan = await newPlan();
    const made = await save(plan, [piece(2, ALLERGY)], plan.claimSecret);
    const id = made.objects[0]?.id;
    if (id === undefined) throw new Error("Fixture piece not stored");

    const changed = await save(plan, [piece(2, "TEST ONLY changed", id)], plan.claimSecret);
    expect(notesByPosition(changed.objects)).toEqual({ 2: "TEST ONLY changed" });

    await save(plan, [piece(2, undefined, id)], plan.claimSecret);
    expect(notesByPosition((await read(plan.id, plan.claimSecret)).plan.objects)).toEqual({ 2: null });
  });

  it("keeps the notes of a plan that has no claim secret from every anonymous reader", async () => {
    // Plans made before claim secrets (migration 0102) have none to present.
    const plan = await newPlan();
    await save(plan, [piece(2, ALLERGY)], plan.claimSecret);
    await pool.query("DELETE FROM configuration_claim_secrets WHERE configuration_id = $1", [plan.id]);

    const { body, plan: seen } = await read(plan.id, plan.claimSecret);
    expect(notesByPosition(seen.objects)).toEqual({ 2: null });
    expect(body.includes(ALLERGY)).toBe(false);
  });
});
