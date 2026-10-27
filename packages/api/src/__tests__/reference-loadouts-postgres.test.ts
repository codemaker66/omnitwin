import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { validateEnv } from "../env.js";
import { referenceLoadoutRoutes } from "../routes/reference-loadouts.js";

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
});
