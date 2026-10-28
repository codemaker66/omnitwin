import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { validateEnv } from "../env.js";
import { uploadRoutes } from "../routes/uploads.js";

// ---------------------------------------------------------------------------
// The URLs private uploads are written and read through, made by the real
// SigV4 presigner (no mocks; signing is offline). A mocked presigner cannot
// see two things that decide whether R2 accepts or misuses an upload:
//
//   - the SDK's default checksum: since 3.729 it presigns a PUT with the
//     CRC32 of an empty body unless the client asks for WHEN_REQUIRED;
//   - Content-Type, which the presigner leaves unsigned unless told, so the
//     bytes could be stored as a type other than the one declared.
// ---------------------------------------------------------------------------

const PRIVATE_BUCKET = "omnitwin-private-uploads-test";
const VENUE_ID = "00000000-0000-4000-8000-000000000001";
const FILE_ID = "00000000-0000-4000-8000-000000000005";

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
  PRIVATE_UPLOADS_R2_BUCKET: PRIVATE_BUCKET,
});

const STAFF = {
  authorization: `Bearer ${JSON.stringify({ id: "staff-user", email: "staff@private-uploads.invalid", role: "staff", venueId: VENUE_ID })}`,
};

const listedKey = `private/venues/${VENUE_ID}/venue-files/${FILE_ID}.pdf`;

/** Inserts echo their values back; every select returns the one listed file. */
function fakeDb(): Database {
  const row = {
    id: FILE_ID, fileKey: listedKey, filename: "floor-plan.pdf", contentType: "application/pdf",
    contentLengthBytes: 2048, sha256: null, context: "venue", contextId: VENUE_ID,
    visibility: "private", uploadedBy: "staff-user", uploadedAt: "2026-10-18T12:00:00.000Z",
  };
  const db = {} as Database;
  Reflect.set(db, "insert", () => ({
    values: (values: Record<string, unknown>) => ({ returning: () => Promise.resolve([{ id: FILE_ID, ...values }]) }),
  }));
  Reflect.set(db, "select", () => {
    const chain = { from: () => chain, where: () => chain, orderBy: () => Promise.resolve([row]) };
    return chain;
  });
  return db;
}

describe("private upload URLs from the real presigner", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    server = Fastify();
    await server.register(uploadRoutes, { db: fakeDb(), env: ENV, prefix: "/uploads" });
    await server.ready();
  });
  afterAll(async () => { await server.close(); });

  it("presigns the PUT for the private bucket with the type signed and no default checksum", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/uploads/presigned",
      headers: STAFF,
      payload: { filename: "floor-plan.pdf", contentType: "application/pdf", contentLengthBytes: 2048, context: "venue", contextId: VENUE_ID },
    });
    expect(response.statusCode).toBe(201);
    const { uploadUrl, fileKey } = response.json<{ data: { uploadUrl: string; fileKey: string } }>().data;
    const url = new URL(uploadUrl);

    expect(url.protocol).toBe("https:");
    expect(url.host).toBe("privateaccount.r2.cloudflarestorage.com");
    expect(decodeURIComponent(url.pathname)).toBe(`/${PRIVATE_BUCKET}/${fileKey}`);
    expect(url.searchParams.get("X-Amz-Credential")?.startsWith("PRIVATEACCESSKEY/")).toBe(true);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect([...url.searchParams.keys()].filter((name) => name.toLowerCase().startsWith("x-amz-checksum"))).toEqual([]);
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("signs the read for the private bucket, host only, for five minutes", async () => {
    const response = await server.inject({ method: "GET", url: `/uploads/venue/${VENUE_ID}`, headers: STAFF });
    expect(response.statusCode).toBe(200);
    const [file] = response.json<{ data: { readUrl: string | null }[] }>().data;
    const url = new URL(file?.readUrl ?? "about:blank");

    expect(url.host).toBe("privateaccount.r2.cloudflarestorage.com");
    expect(decodeURIComponent(url.pathname)).toBe(`/${PRIVATE_BUCKET}/${listedKey}`);
    expect(url.searchParams.get("X-Amz-Credential")?.startsWith("PRIVATEACCESSKEY/")).toBe(true);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });
});
