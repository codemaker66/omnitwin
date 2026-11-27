import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReferenceLoadoutRowSchema } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { validateEnv } from "../env.js";
import { referenceLoadoutRoutes } from "../routes/reference-loadouts.js";
import { referencePhotoRoutes } from "../routes/reference-photos.js";

// ---------------------------------------------------------------------------
// The reference loadouts list on the migrated platform database. Its photo
// count and cover photo are correlated subqueries; an unqualified "id" inside
// them resolves to the subquery's own tables (reference_photos, files), which
// made every list request fail with "column reference id is ambiguous" in
// production (Sentry VENVIEWER-API-1) and counted the wrong rows. The list is
// read by the venue's staff, and counts only photos uploaded into the
// loadout's own scope (T-668; reference-loadouts-private-postgres.test.ts
// covers the refusals and the signing).
// ---------------------------------------------------------------------------

// The create and rename below authenticate with the test-mode bearer.
process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Reference loadout tests require the explicit disposable platform database");
  }
}

const OUTLINE = [{ x: -10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, { x: -10, y: 5 }];
// The private-upload connection the routes sign with; nothing is fetched.
const ENV = validateEnv({
  DATABASE_URL: "postgresql://unused/unused",
  R2_ACCOUNT_ID: "publicaccount",
  R2_ACCESS_KEY_ID: "PUBLICACCESSKEY",
  R2_SECRET_ACCESS_KEY: "public-secret",
  R2_BUCKET_NAME: "omnitwin-uploads-test",
  R2_PUBLIC_URL: "https://pub-public-test.r2.dev",
  PRIVATE_UPLOADS_R2_ACCOUNT_ID: "privateaccount",
  PRIVATE_UPLOADS_R2_ACCESS_KEY_ID: "PRIVATEACCESSKEY",
  PRIVATE_UPLOADS_R2_SECRET_ACCESS_KEY: "private-secret",
  PRIVATE_UPLOADS_R2_BUCKET: "omnitwin-private-uploads-test",
});

interface ListedLoadout { readonly name: string; readonly photoCount: number; readonly coverFileKey: string | null }

describe.skipIf(target === undefined)("reference loadouts list through the real route and PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `reference_loadouts_${randomUUID()}` });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(referenceLoadoutRoutes, { db, env: ENV, prefix: "/venues/:venueId/spaces/:spaceId/loadouts" });
    await server.register(referencePhotoRoutes, { db, prefix: "/loadouts/:loadoutId/photos" });
    await server.ready();
  });

  afterAll(async () => {
    if (server !== undefined) await server.close();
    if (pool !== undefined) await pool.end();
  });

  async function seedRoom(): Promise<{ venueId: string; spaceId: string; otherSpaceId: string; userId: string }> {
    const venueId = randomUUID();
    const spaceId = randomUUID();
    const otherSpaceId = randomUUID();
    const userId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY loadouts", slug: `loadouts-${venueId}`, address: "Disposable fixture" });
    await db.insert(schema.spaces).values([spaceId, otherSpaceId].map((id, index) => ({
      id, venueId, name: `Room ${String(index)}`, slug: `room-${id}`, widthM: "20", lengthM: "10", heightM: "6",
      floorPlanOutline: OUTLINE, sortOrder: index,
    })));
    await db.insert(schema.users).values({ id: userId, email: `${userId}@loadouts.invalid`, name: "Fixture", role: "staff", venueId });
    return { venueId, spaceId, otherSpaceId, userId };
  }

  async function addPhoto(venueId: string, loadoutId: string, userId: string, sortOrder: number): Promise<string> {
    const fileKey = `private/venues/${venueId}/loadouts/${loadoutId}/${randomUUID()}.jpg`;
    const [file] = await db.insert(schema.files).values({
      fileKey, filename: "setup.jpg", contentType: "image/jpeg", context: "loadout", contextId: loadoutId, uploadedBy: userId,
    }).returning({ id: schema.files.id });
    if (file === undefined) throw new Error("File fixture was not inserted");
    await db.insert(schema.referencePhotos).values({ loadoutId, fileId: file.id, sortOrder });
    return fileKey;
  }

  it("answers a create and a rename with the row the web's own schema reads (dash-ops-4)", async () => {
    const { venueId, spaceId, userId } = await seedRoom();
    const headers = { authorization: `Bearer ${JSON.stringify({ id: userId, email: `${userId}@loadouts.invalid`, name: "Fixture", role: "staff", venueId })}` };
    const created = await server.inject({ method: "POST", url: `/venues/${venueId}/spaces/${spaceId}/loadouts`, headers, payload: { name: "Wedding reset" } });
    expect(created.statusCode, created.body).toBe(201);
    const row = ReferenceLoadoutRowSchema.parse(created.json<{ data: unknown }>().data);
    expect(row).toMatchObject({ spaceId, venueId, name: "Wedding reset", description: null });

    const renamed = await server.inject({ method: "PATCH", url: `/venues/${venueId}/spaces/${spaceId}/loadouts/${row.id}`, headers, payload: { name: "Dinner reset" } });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(ReferenceLoadoutRowSchema.parse(renamed.json<{ data: unknown }>().data)).toMatchObject({ id: row.id, name: "Dinner reset" });
  });

  it("lists each loadout in the room with its own photo count and first photo as cover", async () => {
    const { venueId, spaceId, otherSpaceId, userId } = await seedRoom();
    const loadout = (name: string, minutes: number, space = spaceId, deletedAt: Date | null = null) => ({
      id: randomUUID(), venueId, spaceId: space, name, createdBy: userId, deletedAt,
      createdAt: new Date(Date.UTC(2026, 9, 26, 9, minutes)),
    });
    const dinner = loadout("Dinner rounds", 0);
    const theatre = loadout("Theatre", 1);
    const elsewhere = loadout("Other room", 2, otherSpaceId);
    const removed = loadout("Removed", 3, spaceId, new Date());
    await db.insert(schema.referenceLoadouts).values([dinner, theatre, elsewhere, removed]);
    await addPhoto(venueId, dinner.id, userId, 1);
    const cover = await addPhoto(venueId, dinner.id, userId, 0);
    await addPhoto(venueId, elsewhere.id, userId, 0);

    const staff = { authorization: `Bearer ${JSON.stringify({ id: userId, email: `${userId}@loadouts.invalid`, role: "staff", venueId })}` };
    const response = await server.inject({ method: "GET", url: `/venues/${venueId}/spaces/${spaceId}/loadouts`, headers: staff });

    expect(response.statusCode).toBe(200);
    const listed = response.json<{ data: ListedLoadout[] }>().data
      .map(({ name, photoCount, coverFileKey }) => ({ name, photoCount, coverFileKey }));
    expect(listed).toEqual([
      { name: "Dinner rounds", photoCount: 2, coverFileKey: cover },
      { name: "Theatre", photoCount: 0, coverFileKey: null },
    ]);
  });

  // Release audit, contract-a-2. Every photo write answered with the bare
  // reference_photos row, which has no file key, name or type. The web reads a
  // photo with those (it draws the picture from the key), so each successful
  // link, caption and reorder was reported as a failure, and a retry linked the
  // same photo twice.
  it("answers each photo write with the photo as the detail read gives it, its file's key, name and type included (contract-a-2)", async () => {
    const { venueId, spaceId, userId } = await seedRoom();
    const headers = { authorization: `Bearer ${JSON.stringify({ id: userId, email: `${userId}@loadouts.invalid`, name: "Fixture", role: "staff", venueId })}` };
    const loadoutId = randomUUID();
    await db.insert(schema.referenceLoadouts).values({ id: loadoutId, venueId, spaceId, name: "TEST ONLY photo contract", createdBy: userId });
    /** A photo as the browser's upload leaves it: a files row in this loadout's scope, not yet linked. */
    const uploaded = async (filename: string): Promise<{ id: string; fileKey: string }> => {
      const fileKey = `private/venues/${venueId}/loadouts/${loadoutId}/${randomUUID()}.jpg`;
      const [file] = await db.insert(schema.files).values({
        fileKey, filename, contentType: "image/jpeg", context: "loadout", contextId: loadoutId, uploadedBy: userId,
      }).returning({ id: schema.files.id });
      if (file === undefined) throw new Error("File fixture was not inserted");
      return { id: file.id, fileKey };
    };
    const wide = await uploaded("wide.jpg");
    const close = await uploaded("close.jpg");
    const asRead = (file: { id: string; fileKey: string }, filename: string, caption: string | null, sortOrder: number): Record<string, unknown> =>
      ({ id: expect.any(String) as unknown, fileId: file.id, caption, sortOrder, fileKey: file.fileKey, filename, contentType: "image/jpeg" });

    const linked = await server.inject({ method: "POST", url: `/loadouts/${loadoutId}/photos`, headers, payload: { fileId: wide.id, caption: "From the door" } });
    expect(linked.statusCode, linked.body).toBe(201);
    const first = linked.json<{ data: { id: string } }>().data;
    expect(first).toEqual(asRead(wide, "wide.jpg", "From the door", 0));

    const second = await server.inject({ method: "POST", url: `/loadouts/${loadoutId}/photos`, headers, payload: { fileId: close.id } });
    expect(second.statusCode, second.body).toBe(201);
    const secondPhoto = second.json<{ data: { id: string } }>().data;
    expect(secondPhoto).toEqual(asRead(close, "close.jpg", null, 1));

    const captioned = await server.inject({ method: "PATCH", url: `/loadouts/${loadoutId}/photos/${first.id}`, headers, payload: { caption: "From the stage" } });
    expect(captioned.statusCode, captioned.body).toBe(200);
    expect(captioned.json<{ data: unknown }>().data).toEqual({ ...asRead(wide, "wide.jpg", "From the stage", 0), id: first.id });

    const reordered = await server.inject({ method: "POST", url: `/loadouts/${loadoutId}/photos/reorder`, headers, payload: { photoIds: [secondPhoto.id, first.id] } });
    expect(reordered.statusCode, reordered.body).toBe(200);
    const inOrder = reordered.json<{ data: unknown[] }>().data;
    expect(inOrder).toEqual([
      { ...asRead(close, "close.jpg", null, 0), id: secondPhoto.id },
      { ...asRead(wide, "wide.jpg", "From the stage", 1), id: first.id },
    ]);

    // Exactly what opening the loadout then reads, with each photo's
    // five-minute signed read URL beside it (T-668).
    const detail = await server.inject({ method: "GET", url: `/venues/${venueId}/spaces/${spaceId}/loadouts/${loadoutId}`, headers });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json<{ data: { photos: unknown[] } }>().data.photos).toEqual([
      { ...asRead(close, "close.jpg", null, 0), id: secondPhoto.id, readUrl: expect.stringContaining(close.fileKey) as unknown },
      { ...asRead(wide, "wide.jpg", "From the stage", 1), id: first.id, readUrl: expect.stringContaining(wide.fileKey) as unknown },
    ]);
  });
});
