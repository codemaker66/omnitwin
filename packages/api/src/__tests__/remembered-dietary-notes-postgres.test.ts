import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DIETARY_MEMORY_CONSENT,
  DIETARY_MEMORY_RETENTION,
  RememberedDietaryNoteSchema,
  dietaryMemoryConsentWording,
} from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { dietaryMemoryRoutes } from "../routes/dietary-memory.js";
import { removeUnusedRememberedNotes } from "../services/dietary-memory.js";
import { DIETARY_NOTE_DAYS_AFTER_EVENT, removeLapsedDietaryNotes } from "../services/dietary-retention.js";

// ---------------------------------------------------------------------------
// Remembered allergy notes ("ask once, then remember"), on Goal 12's migrated
// disposable cluster: the migration's constraints, the copy made inside
// PostgreSQL from the client's own layout, the partial unique index and the
// owner-only reads are database behaviour a mock cannot prove. The cluster
// is shared by the platform suites, so every case makes its own people and
// layouts and asserts on its own rows, never on totals.
//
// Never loads .env or falls back to DATABASE_URL.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Remembered dietary note tests require the explicit disposable platform database");
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTE = "Two guests: sesame, severe. One guest: shellfish.";
const BASE = "/account/dietary-notes";

function metadataWith(note: string): Record<string, unknown> {
  return { instructions: { dietary: { vegetarian: 8, vegan: 0, glutenFree: 2, nutFree: 0, halal: 0, kosher: 0, otherAllergies: note } } };
}

interface Person { readonly id: string; readonly role: string; readonly platformRole: "none" | "admin"; readonly venueId: string | null }

describe.skipIf(target === undefined)("remembered allergy notes on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;
  let venueId: string;
  let spaceId: string;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `remembered_dietary_${randomUUID()}`, max: 4,
      options: "-c statement_timeout=10000 -c lock_timeout=8000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    venueId = randomUUID();
    spaceId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY remembered notes", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "10", lengthM: "21", heightM: "8",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 21 }, { x: 0, y: 21 }] });
    server = Fastify();
    await server.register(dietaryMemoryRoutes, { db, prefix: BASE });
    await server.ready();
  });
  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  async function person(role: string, options: { platformRole?: "none" | "admin"; atVenue?: boolean } = {}): Promise<Person> {
    const id = randomUUID();
    const platformRole = options.platformRole ?? "none";
    const personVenue = options.atVenue === true ? venueId : null;
    await db.insert(schema.users).values({
      id, email: `${id}@example.test`, name: `TEST ONLY ${role}`, role, platformRole, venueId: personVenue,
    });
    return { id, role, platformRole, venueId: personVenue };
  }

  async function layout(owner: Person | null, note: string | null): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.configurations).values({
      id, venueId, spaceId, userId: owner?.id ?? null, name: `Annual dinner ${id.slice(0, 4)}`, layoutStyle: "dinner-rounds",
      metadata: note === null ? null : metadataWith(note),
    });
    return id;
  }

  function auth(user: Person): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id: user.id, email: `${user.id}@example.test`, role: user.role, platformRole: user.platformRole, venueId: user.venueId })}` };
  }

  function remember(user: Person, configurationId: string, consentVersion: string = DIETARY_MEMORY_CONSENT.version) {
    return server.inject({ method: "PUT", url: BASE, headers: auth(user), payload: { configurationId, consentVersion } });
  }

  async function listFor(user: Person) {
    const res = await server.inject({ method: "GET", url: BASE, headers: auth(user) });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    return RememberedDietaryNoteSchema.array().parse(res.json<{ data: unknown }>().data);
  }

  async function rowsFor(user: Person) {
    return db.select().from(schema.rememberedDietaryNotes).where(eq(schema.rememberedDietaryNotes.userId, user.id));
  }

  it("keeps nothing for an account that has not ticked the box", async () => {
    const client = await person("client");
    await layout(client, NOTE);
    expect(await listFor(client)).toEqual([]);
    expect(await rowsFor(client)).toEqual([]);
  });

  it("remembers the layout's note with a record of who agreed, when, and the exact words", async () => {
    const client = await person("planner");
    const source = await layout(client, NOTE);
    const before = Date.now();
    const res = await remember(client, source);
    expect(res.statusCode).toBe(200);
    const note = RememberedDietaryNoteSchema.parse(res.json<{ data: unknown }>().data);
    expect(note).toMatchObject({
      venueId, venueName: "TEST ONLY remembered notes", otherAllergies: NOTE, consentWording: dietaryMemoryConsentWording(),
      sourceLayout: { id: source },
    });
    expect(new Date(note.consentedAt).getTime()).toBeGreaterThanOrEqual(before - 5000);

    const [row] = await rowsFor(client);
    expect(row).toMatchObject({ userId: client.id, venueId, note: NOTE, sourceConfigurationId: source, removedAt: null, removedBy: null });
    expect(row?.consentWording).toBe(`${DIETARY_MEMORY_CONSENT.question} ${DIETARY_MEMORY_CONSENT.detail}`);
  });

  it("prefills the next event: the account reads its note for the venue, and a later save replaces it under the same consent", async () => {
    const client = await person("client");
    const first = await layout(client, NOTE);
    expect((await remember(client, first)).statusCode).toBe(200);
    const [remembered] = await listFor(client);
    expect(remembered?.otherAllergies).toBe(NOTE);

    // Next year's dinner: a new layout carrying the note, changed a little.
    const nextNote = `${NOTE} One guest: coeliac.`;
    const next = await layout(client, nextNote);
    const again = await remember(client, next);
    expect(again.statusCode).toBe(200);
    const updated = RememberedDietaryNoteSchema.parse(again.json<{ data: unknown }>().data);
    expect(updated.id).toBe(remembered?.id);
    expect(updated.consentedAt).toBe(remembered?.consentedAt);
    expect(updated.otherAllergies).toBe(nextNote);
    expect(updated.sourceLayout?.id).toBe(next);
    expect(await rowsFor(client)).toHaveLength(1);
  });

  it("lets the client remove it: the note goes, the record of what was agreed stays", async () => {
    const client = await person("client");
    expect((await remember(client, await layout(client, NOTE))).statusCode).toBe(200);
    const [remembered] = await listFor(client);
    if (remembered === undefined) throw new Error("note not remembered");

    const res = await server.inject({ method: "DELETE", url: `${BASE}/${remembered.id}`, headers: auth(client) });
    expect(res.statusCode).toBe(204);
    expect(await listFor(client)).toEqual([]);
    const [row] = await rowsFor(client);
    expect(row).toMatchObject({ note: null, removedBy: "client", consentWording: dietaryMemoryConsentWording() });
    expect(row?.removedAt).toBeInstanceOf(Date);

    const twice = await server.inject({ method: "DELETE", url: `${BASE}/${remembered.id}`, headers: auth(client) });
    expect(twice.statusCode).toBe(404);
  });

  it("never lets another account read, remember from or remove someone else's note, whatever its role", async () => {
    const owner = await person("client");
    const source = await layout(owner, NOTE);
    expect((await remember(owner, source)).statusCode).toBe(200);
    const [remembered] = await listFor(owner);
    if (remembered === undefined) throw new Error("note not remembered");

    const otherClient = await person("client");
    const staff = await person("staff", { atVenue: true });
    const venueAdmin = await person("admin", { atVenue: true });
    const platformAdmin = await person("admin", { platformRole: "admin" });
    for (const reader of [otherClient, staff, venueAdmin, platformAdmin]) {
      expect(await listFor(reader)).toEqual([]);
      const removal = await server.inject({ method: "DELETE", url: `${BASE}/${remembered.id}`, headers: auth(reader) });
      expect(removal.statusCode).toBe(404);
    }
    // Another client cannot remember from the owner's layout; staff cannot
    // agree on anyone's behalf, not even on a layout of their own.
    expect((await remember(otherClient, source)).statusCode).toBe(404);
    const staffAttempt = await remember(staff, await layout(staff, NOTE));
    expect(staffAttempt.statusCode).toBe(403);
    expect(staffAttempt.json<{ error: string }>().error).toContain("The note on this layout is kept for this event.");
    for (const reader of [otherClient, staff]) expect(await rowsFor(reader)).toEqual([]);

    expect((await listFor(owner)).map((note) => note.otherAllergies)).toEqual([NOTE]);
    expect((await server.inject({ method: "GET", url: BASE })).statusCode).toBe(401);
  });

  it("refuses words the client did not read, a layout with no note, and records nothing", async () => {
    const client = await person("client");
    const source = await layout(client, NOTE);
    const stale = await remember(client, source, "2026-01-01");
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ code: string }>().code).toBe("CONSENT_WORDING_CHANGED");

    const blank = await remember(client, await layout(client, "   \n "));
    expect(blank.statusCode).toBe(409);
    expect(blank.json<{ code: string }>().code).toBe("NO_NOTE");
    expect((await remember(client, await layout(client, null))).statusCode).toBe(409);
    expect((await remember(client, randomUUID())).statusCode).toBe(404);
    expect(await rowsFor(client)).toEqual([]);
  });

  it("ends a consent given to other words and records the new one when the client agrees again", async () => {
    const client = await person("client");
    const source = await layout(client, NOTE);
    expect((await remember(client, source)).statusCode).toBe(200);
    await db.update(schema.rememberedDietaryNotes)
      .set({ consentWording: "Remember these? (an earlier wording)" })
      .where(eq(schema.rememberedDietaryNotes.userId, client.id));

    expect((await remember(client, source)).statusCode).toBe(200);
    const rows = await rowsFor(client);
    expect(rows).toHaveLength(2);
    const ended = rows.find((row) => row.removedAt !== null);
    const current = rows.find((row) => row.removedAt === null);
    expect(ended).toMatchObject({ note: null, removedBy: "reworded", consentWording: "Remember these? (an earlier wording)" });
    expect(current).toMatchObject({ note: NOTE, consentWording: dietaryMemoryConsentWording() });
  });

  it(`removes a note unused for ${String(DIETARY_MEMORY_RETENTION.daysUnused)} days, keeping its record, and not before`, async () => {
    const stale = await person("client");
    const fresh = await person("client");
    expect((await remember(stale, await layout(stale, NOTE))).statusCode).toBe(200);
    expect((await remember(fresh, await layout(fresh, NOTE))).statusCode).toBe(200);
    const now = new Date();
    await db.update(schema.rememberedDietaryNotes)
      .set({ updatedAt: new Date(now.getTime() - (DIETARY_MEMORY_RETENTION.daysUnused + 1) * DAY_MS) })
      .where(eq(schema.rememberedDietaryNotes.userId, stale.id));

    const rehearsal = await removeUnusedRememberedNotes(db, { now, dryRun: true });
    expect(rehearsal.removed).toBeGreaterThanOrEqual(1);
    expect((await rowsFor(stale))[0]?.note).toBe(NOTE);

    const pass = await removeUnusedRememberedNotes(db, { now });
    expect(pass.removed).toBeGreaterThanOrEqual(1);
    expect((await rowsFor(stale))[0]).toMatchObject({ note: null, removedBy: "retention" });
    expect((await rowsFor(fresh))[0]).toMatchObject({ note: NOTE, removedAt: null });
  });

  it(`without the tick the layout's note goes ${String(DIETARY_NOTE_DAYS_AFTER_EVENT)} days after the event; with it, the remembered copy stays`, async () => {
    const declined = await person("client");
    const agreed = await person("client");
    const declinedLayout = await layout(declined, NOTE);
    const agreedLayout = await layout(agreed, NOTE);
    expect((await remember(agreed, agreedLayout)).statusCode).toBe(200);
    const eventEnd = new Date(Date.now() - 2 * DAY_MS);
    for (const configurationId of [declinedLayout, agreedLayout]) {
      const eventId = randomUUID();
      await db.insert(schema.events).values({ id: eventId, venueId, name: "TEST ONLY dinner", startsAt: new Date(eventEnd.getTime() - 5 * 3600_000), endsAt: eventEnd });
      await db.insert(schema.eventConfigurationLinks).values({ eventId, configurationId, linkType: "source_configuration" });
    }

    await removeLapsedDietaryNotes(db, { now: new Date(eventEnd.getTime() + (DIETARY_NOTE_DAYS_AFTER_EVENT + 1) * DAY_MS) });
    for (const configurationId of [declinedLayout, agreedLayout]) {
      const [config] = await db.select().from(schema.configurations).where(eq(schema.configurations.id, configurationId));
      expect(config?.metadata).toEqual(metadataWith(""));
    }
    expect(await listFor(declined)).toEqual([]);
    expect((await listFor(agreed)).map((note) => note.otherAllergies)).toEqual([NOTE]);
  });

  it("holds the record's shape in the database: an active row has a note, one per account and venue", async () => {
    const client = await person("client");
    const insert = (note: string | null, removed: boolean) => pool.query(
      `INSERT INTO remembered_dietary_notes (user_id, venue_id, note, consent_wording, removed_at, removed_by)
       VALUES ($1, $2, $3, 'wording', $4, $5)`,
      [client.id, venueId, note, removed ? new Date() : null, removed ? "client" : null],
    );
    await expect(insert(null, false)).rejects.toMatchObject({ code: "23514" });
    await expect(insert(NOTE, true)).rejects.toMatchObject({ code: "23514" });
    await expect(insert("x".repeat(1001), false)).rejects.toMatchObject({ code: "23514" });
    await insert(NOTE, false);
    await expect(insert(NOTE, false)).rejects.toMatchObject({ code: "23505" });
    await insert(null, true);
  });
});
