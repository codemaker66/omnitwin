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

interface Plan { readonly id: string; revision: number; readonly shortCode: string; readonly claimSecret: string; readonly notesIncluded?: boolean }

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
  const staffId = randomUUID();

  /** A new plan, made from `from` (the create route takes ten an hour from
   *  one address, and this suite makes nine from the default one). */
  async function newPlan(from?: string): Promise<Plan> {
    const response = await server.inject({
      method: "POST", url: "/public/configurations", payload: { spaceId },
      ...(from === undefined ? {} : { remoteAddress: from }),
    });
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
    await db.insert(schema.users).values({ id: staffId, name: "TEST ONLY guest privacy staff", email: `${staffId}@guest-privacy.invalid`, role: "staff", venueId });

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
  interface PlanRead {
    readonly reviewNote: string | null; readonly metadata: unknown; readonly objects: readonly StoredPiece[];
    readonly notesIncluded?: boolean;
  }
  /** How a save presents itself: the plan's secret, and whether it says the
   *  notes it carries came from a read that included them. */
  interface SavedAs { readonly secret?: string; readonly notesIncluded?: boolean }

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

  async function read(planId: string, secret?: string): Promise<{ body: string; plan: PlanRead; cacheControl: unknown }> {
    const response = await server.inject({ method: "GET", url: `/public/configurations/${planId}`, ...asHolder(secret) });
    expect(response.statusCode, response.body.slice(0, 300)).toBe(200);
    return { body: response.body, plan: response.json<{ data: PlanRead }>().data, cacheControl: response.headers["cache-control"] };
  }

  /** The browser that made the plan, saving a document it read with its notes:
   *  what the planner sends for a plan made here. */
  function asMaker(plan: Plan): SavedAs {
    return { secret: plan.claimSecret, notesIncluded: true };
  }

  async function send(plan: Plan, pieces: readonly Record<string, unknown>[], as: SavedAs = {}): Promise<{ statusCode: number; body: string }> {
    const response = await server.inject({
      method: "POST", url: `/public/configurations/${plan.id}/objects/batch`, ...asHolder(as.secret),
      payload: { expectedRevision: plan.revision, objects: pieces, ...(as.notesIncluded === undefined ? {} : { notesIncluded: as.notesIncluded }) },
    });
    return { statusCode: response.statusCode, body: response.body };
  }

  async function save(plan: Plan, pieces: readonly Record<string, unknown>[], as: SavedAs = {}): Promise<{ body: string; objects: readonly StoredPiece[] }> {
    const response = await send(plan, pieces, as);
    expect(response.statusCode, response.body.slice(0, 300)).toBe(200);
    const data = (JSON.parse(response.body) as { data: { revision: number; objects: StoredPiece[] } }).data;
    plan.revision = data.revision;
    return { body: response.body, objects: data.objects };
  }

  /** Each piece's note, by where it stands. */
  function notesByPosition(pieces: readonly StoredPiece[]): Record<string, unknown> {
    return Object.fromEntries(pieces.map((stored) => [String(Number(stored.positionX)), stored.metadata?.["notes"] ?? null]));
  }

  /** Where the pieces stand that say they hold a note this reader is not shown. */
  function heldAt(pieces: readonly StoredPiece[]): number[] {
    return pieces.filter((stored) => stored.metadata?.["noteHeld"] === true).map((stored) => Number(stored.positionX));
  }

  /** The plan as the browser that made it reads it. */
  async function asMade(plan: Plan): Promise<PlanRead> {
    return (await read(plan.id, plan.claimSecret)).plan;
  }

  async function venueWrites(planId: string): Promise<void> {
    await pool.query(
      "UPDATE configurations SET review_note = $2, metadata = $3::jsonb WHERE id = $1",
      [planId, REVIEW, JSON.stringify({ instructions: { accessNotes: ACCESS } })],
    );
  }

  it("gives a plan's piece notes, review note and event instructions only to the browser that made it", async () => {
    const plan = await newPlan();
    // A new plan holds no note, so the browser that made it starts with them all.
    expect(plan.notesIncluded).toBe(true);
    await save(plan, [piece(2, ALLERGY), piece(4)], asMaker(plan));
    await venueWrites(plan.id);

    // Anyone with the id still sees the layout itself.
    for (const stranger of [undefined, "not-the-secret-this-plan-was-given"]) {
      const { body, plan: seen, cacheControl } = await read(plan.id, stranger);
      expect(seen.objects.map((stored) => Number(stored.positionX))).toEqual([2, 4]);
      expect(notesByPosition(seen.objects)).toEqual({ 2: null, 4: null });
      expect({ reviewNote: seen.reviewNote, metadata: seen.metadata }).toEqual({ reviewNote: null, metadata: null });
      for (const kept of [ALLERGY, REVIEW, ACCESS]) expect(body.includes(kept), kept).toBe(false);
      // The read says its notes are left out, and which pieces hold one, so
      // the planner neither offers an empty note to write over nor sends this
      // copy back as the whole truth.
      expect(seen.notesIncluded).toBe(false);
      expect(heldAt(seen.objects)).toEqual([2]);
      // Two answers at one address: neither is kept by anything in between.
      expect(cacheControl).toBe("private, no-store");
    }

    // The browser that made it reads everything, as before, and is told so.
    const { plan: own, cacheControl } = await read(plan.id, plan.claimSecret);
    expect(notesByPosition(own.objects)).toEqual({ 2: ALLERGY, 4: null });
    expect(own.reviewNote).toBe(REVIEW);
    expect(own.metadata).toEqual({ instructions: { accessNotes: ACCESS } });
    expect(own.notesIncluded).toBe(true);
    expect(heldAt(own.objects)).toEqual([]);
    expect(cacheControl).toBe("private, no-store");

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

  /** A plan the maker has saved with a noted piece at 2 and a bare one at 4. */
  async function planWithOneNote(from?: string): Promise<{ plan: Plan; withNote: StoredPiece; bare: StoredPiece }> {
    const plan = await newPlan(from);
    const made = await save(plan, [piece(2, ALLERGY), piece(4)], asMaker(plan));
    const withNote = made.objects.find((stored) => stored.metadata?.["notes"] === ALLERGY);
    const bare = made.objects.find((stored) => stored.metadata?.["notes"] === undefined);
    if (withNote === undefined || bare === undefined) throw new Error("Fixture pieces not stored");
    return { plan, withNote, bare };
  }

  it("lets a browser without the secret move pieces and add notes, and shows it the notes it wrote but never one the plan held", async () => {
    const { plan, withNote, bare } = await planWithOneNote();

    // A friend opens the link: no notes. They move the noted piece (sending it
    // back as they saw it, without its note), write on the bare one, add a third.
    const friend = { ...plan };
    const theirSave = await save(friend, [
      piece(3, undefined, withNote.id),
      piece(4, "TEST ONLY from a friend", bare.id),
      piece(6, "TEST ONLY a new table"),
    ]);
    // The answer keeps what this save wrote, so the planner that adopts it
    // does not wipe the note just typed; the held note stays out of it, and
    // its piece says it holds one.
    expect(notesByPosition(theirSave.objects)).toEqual({ 3: null, 4: "TEST ONLY from a friend", 6: "TEST ONLY a new table" });
    expect(heldAt(theirSave.objects)).toEqual([3]);
    expect(theirSave.body.includes(ALLERGY)).toBe(false);

    // The maker still has their note, on the piece where the friend left it,
    // and now reads the friend's.
    expect(notesByPosition((await asMade(plan)).objects))
      .toEqual({ 3: ALLERGY, 4: "TEST ONLY from a friend", 6: "TEST ONLY a new table" });

    // When the friend opens the link again, they are shown none of the three:
    // nothing says the browser asking is the one that wrote two of them.
    const reopened = (await read(plan.id)).plan;
    expect(notesByPosition(reopened.objects)).toEqual({ 3: null, 4: null, 6: null });
    expect(heldAt(reopened.objects)).toEqual([3, 4, 6]);
  });

  it("refuses a save that would change a note its sender was not shown, without saying which piece or anything of the note", async () => {
    const { plan, withNote, bare } = await planWithOneNote();
    const before = await asMade(plan);

    // Answering 200 and keeping the old note threw the person's words away
    // unseen. The whole save is refused instead, so nothing is half-stored.
    const friend = { ...plan };
    const refused = await send(friend, [piece(7, "TEST ONLY overwritten", withNote.id), piece(8, undefined, bare.id)]);
    expect(refused.statusCode, refused.body.slice(0, 300)).toBe(409);
    // The refusal is its code and its sentence. Naming the piece would let one
    // save try a guess at every held note and read off which were right.
    expect(Object.keys(JSON.parse(refused.body) as Record<string, unknown>).sort()).toEqual(["code", "error"]);
    expect(JSON.parse(refused.body)).toMatchObject({ code: "NOTE_HELD" });
    expect(refused.body.includes(ALLERGY)).toBe(false);
    expect(refused.body.includes(withNote.id)).toBe(false);
    expect(await asMade(plan)).toEqual(before);

    // The plan's revision did not move: the same save without that note lands.
    const moved = await save(friend, [piece(7, undefined, withNote.id), piece(8, undefined, bare.id)]);
    expect(notesByPosition(moved.objects)).toEqual({ 7: null, 8: null });
    expect(notesByPosition((await asMade(plan)).objects)).toEqual({ 7: ALLERGY, 8: null });
  });

  it("does not answer as though a held note was cleared: the note stays and its piece says so", async () => {
    const { plan, withNote, bare } = await planWithOneNote();

    // A piece sent without its note is how a browser that never saw the note
    // sends it, so it cannot mean "clear".
    const cleared = await save({ ...plan }, [piece(2, undefined, withNote.id), piece(4, undefined, bare.id)]);
    expect(heldAt(cleared.objects)).toEqual([2]);
    expect(notesByPosition((await asMade(plan)).objects)).toEqual({ 2: ALLERGY, 4: null });
  });

  it("lets a browser without the secret go on writing, correct and clear a note it wrote, by naming the note it replaces", async () => {
    const { plan, withNote, bare } = await planWithOneNote();
    const friend = { ...plan };
    const others = [piece(2, undefined, withNote.id)];

    // The planner saves three seconds after a pause, so a note is often
    // stored half-written and finished by the next save.
    await save(friend, [...others, piece(4, "TEST ONLY VIP ta", bare.id)]);
    const finished = await save(friend, [...others, { ...piece(4, "TEST ONLY VIP table by the door", bare.id), replacesNote: "TEST ONLY VIP ta" }]);
    expect(notesByPosition(finished.objects)).toEqual({ 2: null, 4: "TEST ONLY VIP table by the door" });
    expect(notesByPosition((await asMade(plan)).objects)).toEqual({ 2: ALLERGY, 4: "TEST ONLY VIP table by the door" });

    // Naming a note the piece does not hold shows nothing was read: refused.
    const guessed = await send(friend, [...others, { ...piece(4, "TEST ONLY guess", bare.id), replacesNote: "TEST ONLY not it" }]);
    expect(guessed.statusCode).toBe(409);
    expect(JSON.parse(guessed.body)).toMatchObject({ code: "NOTE_HELD" });

    // And it can take its own note off again.
    const cleared = await save(friend, [...others, { ...piece(4, undefined, bare.id), replacesNote: "TEST ONLY VIP table by the door" }]);
    expect(heldAt(cleared.objects)).toEqual([2]);
    expect(notesByPosition((await asMade(plan)).objects)).toEqual({ 2: ALLERGY, 4: null });
  });

  it("keeps every note when the maker's browser saves a copy that was read without them", async () => {
    // The review's regression. A page that read the plan without its notes
    // (a tab of the web app from before this change, or any read without the
    // secret) keeps unsaved work on the device. The maker's browser restores
    // it and saves, presenting the secret: the pieces arrive without their
    // notes. Which browser is saving says nothing about what the saved copy
    // was read with, so without the save's own word the notes stay.
    const { plan, withNote, bare } = await planWithOneNote();
    const restored = await save(plan, [piece(3, undefined, withNote.id), piece(5, undefined, bare.id)], { secret: plan.claimSecret });
    // The maker's browser is still shown its notes in the answer.
    expect(notesByPosition(restored.objects)).toEqual({ 3: ALLERGY, 5: null });
    expect(notesByPosition((await asMade(plan)).objects)).toEqual({ 3: ALLERGY, 5: null });

    // Saying the notes were read is not enough without the secret either.
    await save({ ...plan }, [piece(3, undefined, withNote.id), piece(5, undefined, bare.id)], { notesIncluded: true });
    expect(notesByPosition((await asMade(plan)).objects)).toEqual({ 3: ALLERGY, 5: null });
  });

  it("still lets the browser that made the plan change and clear its own notes", async () => {
    const plan = await newPlan();
    const made = await save(plan, [piece(2, ALLERGY)], asMaker(plan));
    const id = made.objects[0]?.id;
    if (id === undefined) throw new Error("Fixture piece not stored");

    const changed = await save(plan, [piece(2, "TEST ONLY changed", id)], asMaker(plan));
    expect(notesByPosition(changed.objects)).toEqual({ 2: "TEST ONLY changed" });

    await save(plan, [piece(2, undefined, id)], asMaker(plan));
    expect(notesByPosition((await asMade(plan)).objects)).toEqual({ 2: null });
  });

  it("stores no held-note mark sent to the public save, and passes on none found on a row", async () => {
    const { plan, withNote, bare } = await planWithOneNote();
    const marked = { ...piece(4, undefined, bare.id), metadata: { clothed: false, groupId: null, noteHeld: true } };
    const saved = await save({ ...plan }, [piece(2, undefined, withNote.id), marked]);
    expect(heldAt(saved.objects)).toEqual([2]);
    expect(heldAt((await asMade(plan)).objects)).toEqual([]);

    // Nor is a mark that reached the row some other way (the signed-in save
    // stores a piece's details as sent) passed on: only a piece that holds a
    // note is said to hold one.
    await pool.query(`UPDATE placed_objects SET metadata = metadata || '{"noteHeld": true}'::jsonb WHERE id = $1`, [bare.id]);
    expect(heldAt((await read(plan.id)).plan.objects)).toEqual([2]);
  });

  it("keeps the notes of a plan that has no claim secret from every anonymous reader", async () => {
    // Plans made before claim secrets (migration 0102) have none to present.
    const plan = await newPlan();
    await save(plan, [piece(2, ALLERGY)], asMaker(plan));
    await pool.query("DELETE FROM configuration_claim_secrets WHERE configuration_id = $1", [plan.id]);

    const { body, plan: seen } = await read(plan.id, plan.claimSecret);
    expect(notesByPosition(seen.objects)).toEqual({ 2: null });
    expect(heldAt(seen.objects)).toEqual([2]);
    expect(seen.notesIncluded).toBe(false);
    expect(body.includes(ALLERGY)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // What a save leaves out. A piece left out of a save is removed, and its
  // note with it (lib/placed-object-batch.ts). A save not taken as the whole
  // truth never read the plan's notes, so it may remove any piece except one
  // that holds a note (the release lead's ruling R-D on #389). Each case
  // makes its plan from its own address (see newPlan).
  // -------------------------------------------------------------------------

  const HELD_PIECE_OMITTED = "Nothing was saved: this save would remove a piece with a note that cannot be shown here. Reload the page to put it back.";

  /** The plan's revision, and how many versions its history holds, as the database has them. */
  async function history(planId: string): Promise<{ revision: number | undefined; versions: number }> {
    const plan = await pool.query<{ revision: number }>("SELECT revision FROM configurations WHERE id = $1", [planId]);
    const versions = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM configuration_layout_revisions WHERE configuration_id = $1", [planId]);
    return { revision: plan.rows[0]?.revision, versions: Number(versions.rows[0]?.n) };
  }

  it("refuses, whole, a save without the plan's notes that leaves out a piece holding a note", async () => {
    const { plan, withNote, bare } = await planWithOneNote("198.51.100.1");
    const before = await asMade(plan);
    const kept = await history(plan.id);

    // A phone that opened the link keeps work without the noted piece (Keep
    // mine over a newer version, an Undo, a page from before the planner
    // knew which pieces hold a note) and saves it.
    const friend = { ...plan };
    const refused = await send(friend, [piece(4, undefined, bare.id)]);
    // What was answered and what the plan still holds, in one assertion.
    expect({ statusCode: refused.statusCode, kept: notesByPosition((await asMade(plan)).objects) })
      .toEqual({ statusCode: 409, kept: { 2: ALLERGY, 4: null } });
    // Its own code: the planner answers NOTE_HELD by forgetting its own words
    // over held notes and sending again, which cannot put a piece back.
    expect(JSON.parse(refused.body)).toEqual({ code: "HELD_PIECE_OMITTED", error: HELD_PIECE_OMITTED });
    expect(refused.body.includes(withNote.id)).toBe(false);
    // Nothing stored: no piece removed, no revision taken, no history row.
    expect(await asMade(plan)).toEqual(before);
    expect(await history(plan.id)).toEqual(kept);

    // The maker's own browser, saving a copy it read without the notes, is
    // held the same way; so is a save that says it read them, without the
    // secret to show for it.
    for (const as of [{ secret: plan.claimSecret }, { notesIncluded: true }]) {
      const alsoRefused = await send(friend, [piece(4, undefined, bare.id)], as);
      expect(alsoRefused.statusCode, alsoRefused.body.slice(0, 300)).toBe(409);
      expect(JSON.parse(alsoRefused.body)).toEqual({ code: "HELD_PIECE_OMITTED", error: HELD_PIECE_OMITTED });
    }
    expect(await history(plan.id)).toEqual(kept);

    // The same save, sending the held piece as it was shown, lands.
    const moved = await save(friend, [piece(2, undefined, withNote.id), piece(6, undefined, bare.id)]);
    expect(heldAt(moved.objects)).toEqual([2]);
    expect(notesByPosition((await asMade(plan)).objects)).toEqual({ 2: ALLERGY, 6: null });
  });

  it("still lets a save without the plan's notes remove a piece that holds none", async () => {
    const { plan, withNote } = await planWithOneNote("198.51.100.2");
    const removed = await save({ ...plan }, [piece(2, undefined, withNote.id)]);
    expect(heldAt(removed.objects)).toEqual([2]);
    expect(notesByPosition((await asMade(plan)).objects)).toEqual({ 2: ALLERGY });
  });

  it("still lets the browser that made the plan, saving with its notes, remove a piece that holds one", async () => {
    const { plan, bare } = await planWithOneNote("198.51.100.3");
    await save(plan, [piece(4, undefined, bare.id)], asMaker(plan));
    expect(notesByPosition((await asMade(plan)).objects)).toEqual({ 4: null });
  });

  it("still lets venue staff, signed in, remove a piece that holds a note", async () => {
    const { plan, bare } = await planWithOneNote("198.51.100.4");
    const staff = { id: staffId, email: `${staffId}@guest-privacy.invalid`, role: "staff", platformRole: "none", venueId };
    const response = await server.inject({
      method: "POST", url: `/configurations/${plan.id}/objects/batch`,
      headers: { authorization: `Bearer ${JSON.stringify(staff)}` },
      payload: { expectedRevision: plan.revision, objects: [piece(4, undefined, bare.id)] },
    });
    expect(response.statusCode, response.body.slice(0, 300)).toBe(200);
    expect(notesByPosition((await asMade(plan)).objects)).toEqual({ 4: null });
  });

  it("looks for a held piece once the save holds the plan, so a note written while it waits is kept", async () => {
    // A signed-in write holds the plan's row (as the staff piece routes do,
    // FOR SHARE) and puts a note on the bare piece, while a friend's save
    // that leaves that piece out waits behind it.
    const { plan, withNote, bare } = await planWithOneNote("198.51.100.5");
    const LATE = "TEST ONLY written while the save waited";
    const holder = await pool.connect();
    let open = false;
    try {
      await holder.query("BEGIN");
      open = true;
      await holder.query("SELECT id FROM configurations WHERE id = $1 FOR SHARE", [plan.id]);
      await holder.query(
        "UPDATE placed_objects SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('notes', $2::text) WHERE id = $1",
        [bare.id, LATE]);
      const holderPid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;

      const pending = send({ ...plan }, [piece(2, undefined, withNote.id)]);
      let waiting = false;
      for (let attempt = 0; attempt < 500 && !waiting; attempt += 1) {
        const blocked = await pool.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [holderPid]);
        waiting = Number(blocked.rows[0]?.n) > 0;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting, "the save never waited behind the plan's row").toBe(true);
      await holder.query("COMMIT");
      open = false;

      const answered = await pending;
      expect({ statusCode: answered.statusCode, kept: notesByPosition((await asMade(plan)).objects) })
        .toEqual({ statusCode: 409, kept: { 2: ALLERGY, 4: LATE } });
      expect(JSON.parse(answered.body)).toEqual({ code: "HELD_PIECE_OMITTED", error: HELD_PIECE_OMITTED });
    } finally {
      if (open) await holder.query("ROLLBACK");
      holder.release();
    }
  }, 60_000);
});
