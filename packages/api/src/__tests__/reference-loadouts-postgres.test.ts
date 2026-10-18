import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import type { Database } from "../db/client.js";
import { validateEnv } from "../env.js";
import { referenceLoadoutRoutes } from "../routes/reference-loadouts.js";

// ---------------------------------------------------------------------------
// Reference loadout photos on isolated PostgreSQL, signed by the real SigV4
// presigner (no mocks):
//
//   - only the venue's own staff read a loadout; others get 401/403;
//   - a photo's readUrl is a five-minute URL signed for the PRIVATE bucket
//     with the private token, never the publicly served one;
//   - a reference_photos row that points at a file outside the loadout's
//     upload scope (here, another venue's enquiry attachment) is neither
//     signed, counted nor used as the cover.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const testUrl = process.env["VENVIEWER_REFERENCE_LOADOUTS_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_reference_loadouts_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Reference loadout tests require their explicit isolated loopback database");
  }
}

const PRIVATE_BUCKET = "omnitwin-private-uploads-test";
const PUBLIC_BUCKET = "omnitwin-uploads-test";
const ENV = validateEnv({
  DATABASE_URL: "postgresql://unused/unused",
  R2_ACCOUNT_ID: "publicaccount",
  R2_ACCESS_KEY_ID: "PUBLICACCESSKEY",
  R2_SECRET_ACCESS_KEY: "public-secret",
  R2_BUCKET_NAME: PUBLIC_BUCKET,
  R2_PUBLIC_URL: "https://pub-public-test.r2.dev",
  PRIVATE_UPLOADS_R2_ACCOUNT_ID: "privateaccount",
  PRIVATE_UPLOADS_R2_ACCESS_KEY_ID: "PRIVATEACCESSKEY",
  PRIVATE_UPLOADS_R2_SECRET_ACCESS_KEY: "private-secret",
  PRIVATE_UPLOADS_R2_BUCKET: PRIVATE_BUCKET,
});

describe.skipIf(testUrl === undefined)("reference loadout photos on isolated PostgreSQL", () => {
  const run = randomUUID().slice(0, 8);
  const venue = randomUUID();
  const otherVenue = randomUUID();
  const space = randomUUID();
  const staff = randomUUID();
  const outsider = randomUUID();
  const loadout = randomUUID();
  const ownFile = randomUUID();
  const strayFile = randomUUID();
  const ownKey = `private/venues/${venue}/loadouts/${loadout}/${randomUUID()}.jpg`;
  const strayKey = `private/venues/${otherVenue}/enquiries/${randomUUID()}/${randomUUID()}.pdf`;

  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;

  function as(id: string, venueId: string): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id, email: `staff-${run}@example.test`, role: "staff", venueId })}` };
  }

  const base = `/venues/${venue}/spaces/${space}/loadouts`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: `reference_loadouts_${run}`, max: 4 });
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
    await db.insert(schema.venues).values([
      { id: venue, name: "TEST ONLY Trades Hall", slug: `loadouts-${run}`, address: "Disposable fixture", timezone: "Europe/London" },
      { id: otherVenue, name: "TEST ONLY elsewhere", slug: `loadouts-other-${run}`, address: "Disposable fixture", timezone: "Europe/London" },
    ]);
    await db.insert(schema.spaces).values({
      id: space, venueId: venue, name: "Grand Hall", slug: "grand-hall", sortOrder: 0,
      widthM: "21.00", lengthM: "10.50", heightM: "7.00",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
    });
    await db.insert(schema.users).values([
      { id: staff, venueId: venue, name: "Venue Staff", email: `staff-${run}@example.test`, role: "staff" },
      { id: outsider, venueId: otherVenue, name: "Other Staff", email: `other-${run}@example.test`, role: "staff" },
    ]);
    await db.insert(schema.referenceLoadouts).values({ id: loadout, venueId: venue, spaceId: space, name: "Masonic dinner", createdBy: staff });
    await db.insert(schema.files).values([
      { id: ownFile, fileKey: ownKey, filename: "top-table.jpg", contentType: "image/jpeg", context: "loadout", contextId: loadout, visibility: "private", uploadedBy: staff },
      // Another venue's enquiry attachment, which a bad row below points at.
      { id: strayFile, fileKey: strayKey, filename: "contract.pdf", contentType: "application/pdf", context: "enquiry", contextId: randomUUID(), visibility: "private", uploadedBy: outsider },
    ]);
    await db.insert(schema.referencePhotos).values([
      { loadoutId: loadout, fileId: strayFile, caption: "Should never be signed", sortOrder: 0 },
      { loadoutId: loadout, fileId: ownFile, caption: "Top table", sortOrder: 1 },
    ]);

    server = Fastify();
    await server.register(referenceLoadoutRoutes, { db, env: ENV, prefix: "/venues/:venueId/spaces/:spaceId/loadouts" });
    await server.ready();
  }, 300_000);

  afterAll(async () => {
    await server?.close();
    if (pool !== undefined) {
      await pool.query("DELETE FROM reference_photos WHERE loadout_id = $1", [loadout]);
      await pool.query("DELETE FROM reference_loadouts WHERE id = $1", [loadout]);
      await pool.query("DELETE FROM files WHERE id = ANY($1::uuid[])", [[ownFile, strayFile]]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[staff, outsider]]);
      await pool.query("DELETE FROM spaces WHERE id = $1", [space]);
      await pool.query("DELETE FROM venues WHERE id = ANY($1::uuid[])", [[venue, otherVenue]]);
      await pool.end();
    }
  }, 60_000);

  it("refuses anonymous readers and other venues' staff", async () => {
    for (const url of [base, `${base}/${loadout}`]) {
      expect((await server.inject({ method: "GET", url })).statusCode, url).toBe(401);
      expect((await server.inject({ method: "GET", url, headers: as(outsider, otherVenue) })).statusCode, url).toBe(403);
    }
  });

  it("counts and covers only the photos uploaded into the loadout's own scope", async () => {
    const res = await server.inject({ method: "GET", url: base, headers: as(staff, venue) });
    expect(res.statusCode).toBe(200);
    const [row] = (JSON.parse(res.body) as { data: { id: string; photoCount: number; coverFileKey: string | null }[] }).data;
    expect(row).toMatchObject({ id: loadout, photoCount: 1, coverFileKey: ownKey });
    expect(res.body).not.toContain(strayKey);
  });

  it("signs the loadout's own photo for the private bucket, five minutes, with the private token", async () => {
    const res = await server.inject({ method: "GET", url: `${base}/${loadout}`, headers: as(staff, venue) });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(strayKey);
    expect(res.body).not.toContain(PUBLIC_BUCKET);

    const { photos } = (JSON.parse(res.body) as { data: { photos: { fileId: string; readUrl: string | null }[] } }).data;
    expect(photos.map((photo) => photo.fileId)).toEqual([ownFile]);
    const readUrl = new URL(photos[0]?.readUrl ?? "about:blank");

    // Path style, as every R2 client here: <account>.r2.cloudflarestorage.com/<bucket>/<key>.
    expect(readUrl.protocol).toBe("https:");
    expect(readUrl.host).toBe("privateaccount.r2.cloudflarestorage.com");
    expect(decodeURIComponent(readUrl.pathname)).toBe(`/${PRIVATE_BUCKET}/${ownKey}`);
    expect(readUrl.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(readUrl.searchParams.get("X-Amz-Credential")?.startsWith("PRIVATEACCESSKEY/")).toBe(true);
    expect(readUrl.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(readUrl.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/u);
  });
});
