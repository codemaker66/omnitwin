import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;
beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

const SPACE_ID = "00000000-0000-4000-8000-000000000010";
const CONFIG_ID = "00000000-0000-4000-8000-000000000050";
const ASSET_ID = "00000000-0000-4000-8000-000000000020";
const adminToken = (): string => signToken({ id: "u1", email: "admin@test.com", role: "admin", venueId: "v1" });

// ---------------------------------------------------------------------------
// POST /public/configurations — create anonymous preview
// ---------------------------------------------------------------------------

describe("POST /public/configurations", () => {
  it("does not require auth", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/configurations",
      payload: { spaceId: SPACE_ID },
    });
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 400 for missing spaceId", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/configurations",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid spaceId", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/configurations",
      payload: { spaceId: "not-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts optional name", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/configurations",
      payload: { spaceId: SPACE_ID, name: "My Layout" },
    });
    expect(res.statusCode).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /public/configurations/:configId/objects/batch
// ---------------------------------------------------------------------------

describe("POST /public/configurations/:configId/objects/batch", () => {
  it("does not require auth", async () => {
    const res = await server.inject({
      method: "POST", url: `/public/configurations/${CONFIG_ID}/objects/batch`,
      payload: {
        expectedRevision: 1,
        objects: [{ assetDefinitionId: ASSET_ID, positionX: 0, positionY: 0, positionZ: 0 }],
      },
    });
    expect(res.statusCode).not.toBe(401);
  });

  it("accepts empty objects array (passes validation)", async () => {
    const res = await server.inject({
      method: "POST", url: `/public/configurations/${CONFIG_ID}/objects/batch`,
      payload: { expectedRevision: 1, objects: [] },
    });
    // Not 400 = passed Zod validation (may be 500 from mock DB)
    expect(res.statusCode).not.toBe(400);
  });

  // F15 tripwire: the route must verify assetDefinitionIds exist before
  // inserting. If a future refactor removes the check, this test fails.
  it("route source includes assetDefinitionId existence check (F15 tripwire)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve("src/routes/public-configs.ts"),
      "utf-8",
    );
    expect(source).toContain("assetDefinitions.id");
    expect(source).toContain("ASSET_NOT_FOUND");
  });

  it("returns 400 for invalid config ID", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/configurations/bad-id/objects/batch",
      payload: {
        expectedRevision: 1,
        objects: [{ assetDefinitionId: ASSET_ID, positionX: 0, positionY: 0, positionZ: 0 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // GHSA-mrhx-c7xc-m3w5, replayed: an anonymous 1 MiB body of 349,521 bad
  // objects. Without a bound zod reports one issue per object (+100 MB of
  // heap and a reply tens of megabytes long); the .max(500) stops it at one.
  it("refuses a 1 MiB list of bad objects with one issue, not one per object", async () => {
    const payload = `{"expectedRevision":1,"objects":[${"{},".repeat(349_520)}{}]}`;
    expect(payload.length).toBeGreaterThan(1_048_576);
    const res = await server.inject({
      method: "POST", url: `/public/configurations/${CONFIG_ID}/objects/batch`,
      headers: { "content-type": "application/json" },
      payload,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ details: readonly { code: string; path: readonly string[]; maximum: number }[] }>();
    expect(body.details).toHaveLength(1);
    expect(body.details[0]).toMatchObject({ code: "too_big", path: ["objects"], maximum: 500 });
    expect(res.payload.length).toBeLessThan(1_000);
  });
});

describe("public-configs.ts revision conflict guardrails", () => {
  async function readSource(): Promise<string> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    return fs.readFile(path.resolve("src/routes/public-configs.ts"), "utf-8");
  }

  it("requires an expectedRevision on public batch saves", async () => {
    const source = await readSource();
    expect(source).toContain("expectedRevision: z.number().int().min(1)");
  });

  it("uses compare-and-swap revision advancement before writing objects", async () => {
    const source = await readSource();
    expect(source).toContain("eq(configurations.revision, parsed.data.expectedRevision)");
    expect(source).toContain("revision: sql`${configurations.revision} + 1`");
  });

  it("returns a typed revision conflict instead of accepting stale saves", async () => {
    const source = await readSource();
    expect(source).toContain("revisionConflictBody");
    expect(source).toContain("configurationLayoutRevisions");
  });
});

// ---------------------------------------------------------------------------
// GET /public/configurations/:configId
// ---------------------------------------------------------------------------

describe("GET /public/configurations/:configId", () => {
  it("does not require auth", async () => {
    const res = await server.inject({
      method: "GET", url: `/public/configurations/${CONFIG_ID}`,
    });
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 400 for invalid ID", async () => {
    const res = await server.inject({
      method: "GET", url: "/public/configurations/bad-id",
    });
    expect(res.statusCode).toBe(400);
  });

  // Punch list #2: the route MUST filter to isPublicPreview=true so that
  // leaked or guessed UUIDs cannot expose private claimed layouts via the
  // anonymous endpoint.
  //
  // We can't fully exercise the filter against the mock DB (every query
  // throws → 500 instead of 404). But we CAN inspect the source string
  // of the registered route handler — if a future refactor removes the
  // filter, the test fails because the assertion no longer matches.
  // This is a "tripwire" test that pins the SQL clause without needing
  // a real DB.
  it("route handler source includes isPublicPreview filter (tripwire)", async () => {
    // Read the compiled route source directly. If a future change removes
    // the isPublicPreview filter, this assertion will fail and force the
    // engineer to confirm the change is intentional.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const routeSource = await fs.readFile(
      path.resolve("src/routes/public-configs.ts"),
      "utf-8",
    );
    expect(routeSource).toContain("eq(configurations.isPublicPreview, true)");
    // The error message names "Public preview" — pinning this catches a
    // future regression where someone removes the filter and forgets to
    // also revert the user-facing string.
    expect(routeSource).toContain("Public preview configuration not found");
  });

  it("anonymous GET never returns 200 against mock DB (sanity)", async () => {
    // Sanity check that the anonymous path either 404s (no public preview
    // matches) or 500s (mock DB fails) but never silently returns 200.
    const res = await server.inject({
      method: "GET", url: `/public/configurations/${CONFIG_ID}`,
    });
    expect(res.statusCode).not.toBe(200);
    expect(res.statusCode).not.toBe(401); // anonymous endpoint, not auth-gated
  });
});

// ---------------------------------------------------------------------------
// POST /configurations/:configId/claim — authenticated claim
// ---------------------------------------------------------------------------

describe("POST /configurations/:configId/claim", () => {
  it("returns 401 without auth", async () => {
    const res = await server.inject({
      method: "POST", url: `/configurations/${CONFIG_ID}/claim`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("passes auth with valid token (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST", url: `/configurations/${CONFIG_ID}/claim`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { claimSecret: "a".repeat(43) },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(400);
  });

  it("returns 400 for invalid config ID", async () => {
    const res = await server.inject({
      method: "POST", url: "/configurations/bad-id/claim",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Claim scope tripwire — punch list #14, then release audit public-surface-1
//
// The claim endpoint once linked enquiries by `guestEmail`, then by
// `configurationId`; either way a claim handed the claimer a guest's contact
// details. A claim now never touches enquiries, and needs the creating
// browser's secret. These tests pin the structure; the behaviour is proven on
// a migrated database (claim-new-draft-postgres.test.ts) and under row locks
// (route-atomicity-postgres.test.ts).
// ---------------------------------------------------------------------------

describe("claim-config.ts source-of-truth (#14)", () => {
  async function readClaimConfigSource(): Promise<{ raw: string; codeOnly: string }> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const raw = await fs.readFile(
      path.resolve("src/routes/claim-config.ts"),
      "utf-8",
    );
    // Strip comments before negative checks — comments may legitimately
    // mention the legacy buggy filter to document what was removed.
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    return { raw, codeOnly };
  }

  it("claims and consumes the secret in one db.transaction (atomicity)", async () => {
    const { codeOnly } = await readClaimConfigSource();
    expect(codeOnly).toContain("db.transaction(");
    expect(codeOnly).toContain("tx.delete(configurationClaimSecrets)");
  });

  it("never reads or moves enquiries (a guest's details stay the venue's)", async () => {
    const { codeOnly } = await readClaimConfigSource();
    expect(codeOnly).not.toContain("enquiries");
  });

  it("emits an audit log on claim (observability)", async () => {
    const { codeOnly } = await readClaimConfigSource();
    expect(codeOnly).toContain("request.log.info");
    expect(codeOnly).toContain("configuration claimed");
  });
});

// ---------------------------------------------------------------------------
// POST /public/configurations/:configId/thumbnail — punch list #24
//
// Stores the orthographic capture (PNG or JPEG data URL) in configurations.thumbnailUrl.
// The hallkeeper sheet PDF reads this URL to insert the floor plan diagram.
// Without it, the PDF shows a placeholder "Generate from the 3D editor..."
// ---------------------------------------------------------------------------

describe("POST /public/configurations/:configId/thumbnail", () => {
  const SMALL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it("does not require auth (public endpoint)", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/public/configurations/${CONFIG_ID}/thumbnail`,
      payload: { thumbnailUrl: SMALL_PNG },
    });
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 400 for invalid config ID", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/public/configurations/bad-id/thumbnail",
      payload: { thumbnailUrl: SMALL_PNG },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing thumbnailUrl", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/public/configurations/${CONFIG_ID}/thumbnail`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for non-data-URL string", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/public/configurations/${CONFIG_ID}/thumbnail`,
      payload: { thumbnailUrl: "https://evil.com/image.png" },
    });
    expect(res.statusCode).toBe(400);
  });

  it.each([
    ["PNG bytes labelled JPEG", "data:image/jpeg;base64,iVBORw0KGgo="],
    ["JPEG bytes labelled PNG", "data:image/png;base64,/9j/4AAQ"],
    ["text labelled PNG", "data:image/png;base64,YQ=="],
  ])("returns 400 for a mislabelled payload (%s)", async (_kind, thumbnailUrl) => {
    const res = await server.inject({
      method: "POST",
      url: `/public/configurations/${CONFIG_ID}/thumbnail`,
      payload: { thumbnailUrl },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a data URL the sheet cannot embed (WebP)", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/public/configurations/${CONFIG_ID}/thumbnail`,
      payload: { thumbnailUrl: "data:image/webp;base64,UklGRg==" },
    });
    expect(res.statusCode).toBe(400);
  });

  // A valid signature is not enough: nothing but the image may be stored under the cap.
  it.each([
    ["junk after the signature", "data:image/png;base64,iVBORw0KGgoAAAA!"],
    ["a space inside", "data:image/png;base64,iVBORw0KGgoAA AA"],
    ["URL-safe base64", "data:image/png;base64,iVBORw0KGgoAA-_"],
    ["a length base64 cannot have", "data:image/png;base64,iVBORw0KGgoAAA"],
    ["characters outside ASCII", "data:image/png;base64,iVBORw0KGgoAAAA\u{1F600}\u{1F600}"],
  ])("returns 400 for a payload that is not plain base64 throughout (%s)", async (_kind, thumbnailUrl) => {
    const res = await server.inject({
      method: "POST",
      url: `/public/configurations/${CONFIG_ID}/thumbnail`,
      payload: { thumbnailUrl },
    });
    expect(res.statusCode).toBe(400);
  });

  /** A PNG data URL of `length` characters, plain base64 throughout: only the cap can refuse it. */
  function pngOfLength(length: number): string {
    const head = "data:image/png;base64,iVBORw0KGgoAAAA";
    return head + "A".repeat(length - head.length);
  }

  it("returns 400 when thumbnail exceeds size limit", async () => {
    // 270,000-character limit (about 200 KB decoded), refused by the cap alone.
    const res = await server.inject({
      method: "POST",
      url: `/public/configurations/${CONFIG_ID}/thumbnail`,
      payload: { thumbnailUrl: pngOfLength(270_002) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ details: readonly { code: string }[] }>().details.map((issue) => issue.code)).toEqual(["too_big"]);
  });

  it("passes validation just inside the size limit (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/public/configurations/${CONFIG_ID}/thumbnail`,
      payload: { thumbnailUrl: pngOfLength(269_998) },
    });
    expect(res.statusCode).not.toBe(400);
  });

  it("passes validation with a valid PNG data URL (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/public/configurations/${CONFIG_ID}/thumbnail`,
      payload: { thumbnailUrl: SMALL_PNG },
    });
    // Not 400 = passed Zod validation. Not 401 = no auth required.
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  it("passes validation with a JPEG data URL, the planner's plan thumbnail (fails at DB)", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/public/configurations/${CONFIG_ID}/thumbnail`,
      payload: { thumbnailUrl: "data:image/jpeg;base64,/9j/4AAQ" },
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
  });

  it("takes the Grand Hall's own default plan capture, within the cap", async () => {
    // The planner lab's Grand Hall (160 guests, sky off) as Send layout captures it:
    // PLAN_THUMBNAIL, 800×533 JPEG at 0.85, encoded by Chrome (5 Nov 2026), 96,443
    // characters. As PNG the same plan was 685,350 characters, and this route refused it.
    const jpeg = readFileSync(resolve(import.meta.dirname, "fixtures/grand-hall-plan-thumbnail.jpg"));
    const thumbnailUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    expect(thumbnailUrl.length).toBeLessThanOrEqual(270_000);
    const res = await server.inject({
      method: "POST",
      url: `/public/configurations/${CONFIG_ID}/thumbnail`,
      payload: { thumbnailUrl },
    });
    expect(res.statusCode).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Thumbnail endpoint security — source-grep tripwire (#24)
// ---------------------------------------------------------------------------

describe("public-configs.ts thumbnail security — source-grep (#24)", () => {
  async function readSource(): Promise<{ raw: string; codeOnly: string }> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const raw = await fs.readFile(path.resolve("src/routes/public-configs.ts"), "utf-8");
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    return { raw, codeOnly };
  }

  it("validates thumbnailUrl as a PNG or JPEG data URL by its decoded bytes", async () => {
    // The refusals above are the guard; this keeps the check from being swapped for a label test.
    const { codeOnly } = await readSource();
    expect(codeOnly).toMatch(/\.refine\(isThumbnailDataUrl,/);
    expect(codeOnly).toContain('prefix: "data:image/png;base64,", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]');
    expect(codeOnly).toContain('prefix: "data:image/jpeg;base64,", signature: [0xff, 0xd8, 0xff]');
  });

  it("enforces a size cap on the thumbnail body", async () => {
    const { codeOnly } = await readSource();
    expect(codeOnly).toContain("MAX_THUMBNAIL_STRING_LEN");
    expect(codeOnly).toMatch(/MAX_THUMBNAIL_STRING_LEN\s*=\s*270[_0]*0/);
  });

  it("restricts to public preview configs only", async () => {
    const { codeOnly } = await readSource();
    // Must filter by isPublicPreview=true so claimed configs can't be
    // mutated via the public path.
    expect(codeOnly).toMatch(/thumbnail[\s\S]*?eq\(configurations\.isPublicPreview,\s*true\)/);
  });

  it("applies rate limiting to the thumbnail endpoint", async () => {
    const { codeOnly } = await readSource();
    // The route definition must include a rateLimit config
    expect(codeOnly).toMatch(/thumbnail[\s\S]{0,200}?rateLimit/);
  });
});
