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

const SPACE_ID = "00000000-0000-0000-0000-000000000010";
const CONFIG_ID = "00000000-0000-0000-0000-000000000050";
const ASSET_ID = "00000000-0000-0000-0000-000000000020";
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
      payload: { objects: [{ assetDefinitionId: ASSET_ID, positionX: 0, positionY: 0, positionZ: 0 }] },
    });
    expect(res.statusCode).not.toBe(401);
  });

  it("accepts empty objects array (passes validation)", async () => {
    const res = await server.inject({
      method: "POST", url: `/public/configurations/${CONFIG_ID}/objects/batch`,
      payload: { objects: [] },
    });
    // Not 400 = passed Zod validation (may be 500 from mock DB)
    expect(res.statusCode).not.toBe(400);
  });

  it("returns 400 for invalid config ID", async () => {
    const res = await server.inject({
      method: "POST", url: "/public/configurations/bad-id/objects/batch",
      payload: { objects: [{ assetDefinitionId: ASSET_ID, positionX: 0, positionY: 0, positionZ: 0 }] },
    });
    expect(res.statusCode).toBe(400);
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
// Claim scope tripwire — punch list #14
//
// The claim endpoint previously linked enquiries by `guestEmail` only,
// which meant claiming config A would silently reassign every unowned
// enquiry from the same email address (including enquiries for unrelated
// configs B, C, D...). The fix scopes the link to `configurationId` and
// wraps both updates in a transaction so they're atomic.
//
// These tests read the route source code and pin five structural
// properties of the fix. Behavioural verification of the cross-config
// bleed scenario is deferred to integration.test.ts (currently bit-rotted
// — see project_integration_test_rot.md memory). When that file is
// resurrected, add an end-to-end test that creates two enquiries with
// different `configurationId` values and the same email, claims one,
// and asserts only one is reassigned.
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

  it("wraps the two updates in db.transaction (atomicity)", async () => {
    const { codeOnly } = await readClaimConfigSource();
    expect(codeOnly).toContain("db.transaction(");
  });

  it("filters enquiries by configurationId (correct scope)", async () => {
    const { codeOnly } = await readClaimConfigSource();
    expect(codeOnly).toContain("eq(enquiries.configurationId,");
  });

  it("does NOT filter enquiries by guestEmail (bug eliminated)", async () => {
    const { codeOnly } = await readClaimConfigSource();
    // The original bug: linking enquiries by email scoped the side effect
    // to "every enquiry from this address" instead of "every enquiry for
    // this config". Comments may still mention guestEmail for context;
    // the negative check runs against code only.
    expect(codeOnly).not.toContain("eq(enquiries.guestEmail,");
  });

  it("emits an audit log on claim (observability)", async () => {
    const { codeOnly } = await readClaimConfigSource();
    expect(codeOnly).toContain("request.log.info");
    expect(codeOnly).toContain("configuration claimed");
  });

  it("captures linkedEnquiryCount for the audit log", async () => {
    const { codeOnly } = await readClaimConfigSource();
    expect(codeOnly).toContain("linkedEnquiryCount");
  });
});

// ---------------------------------------------------------------------------
// POST /public/configurations/:configId/thumbnail — punch list #24
//
// Stores the orthographic capture (PNG data URL) in configurations.thumbnailUrl.
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

  it("returns 400 for non-PNG data URL", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/public/configurations/${CONFIG_ID}/thumbnail`,
      payload: { thumbnailUrl: "data:image/jpeg;base64,/9j/4AAQ" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when thumbnail exceeds size limit", async () => {
    // 270 KB string limit (≈200 KB decoded PNG). Generate a string over the limit.
    const huge = "data:image/png;base64," + "A".repeat(280_000);
    const res = await server.inject({
      method: "POST",
      url: `/public/configurations/${CONFIG_ID}/thumbnail`,
      payload: { thumbnailUrl: huge },
    });
    expect(res.statusCode).toBe(400);
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

  it("validates thumbnailUrl starts with PNG data URL prefix", async () => {
    const { codeOnly } = await readSource();
    expect(codeOnly).toContain('startsWith("data:image/png;base64,');
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
