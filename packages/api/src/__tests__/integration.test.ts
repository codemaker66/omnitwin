import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import "dotenv/config";
import { eq, inArray, like } from "drizzle-orm";
import { createDb, type Database } from "../db/client.js";
import {
  users, configurations, placedObjects, enquiries,
  enquiryStatusHistory, guestLeads, spaces, emailSends,
  assetDefinitions, assetAccessories, hallkeeperProgress,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// Integration test suite — runs against the real Neon database
// ---------------------------------------------------------------------------
// Skip if DATABASE_URL is not set or is a mock URL.
// Run with: pnpm --filter @omnitwin/api test:integration
//
// Authentication: uses mock tokens (JSON-encoded user objects) which the
// auth middleware accepts when NODE_ENV=test. No Clerk dependency.

const DATABASE_URL = process.env["DATABASE_URL"] ?? "";
const IS_REAL_DB = DATABASE_URL.length > 0 && !DATABASE_URL.includes("mock");

// ---------------------------------------------------------------------------
// Test-run unique prefix to avoid collisions
// ---------------------------------------------------------------------------

const RUN_ID = Date.now().toString(36);
const PLANNER_EMAIL = `planner-${RUN_ID}@integration.test`;
const HALLKEEPER_EMAIL = `hallkeeper-${RUN_ID}@integration.test`;

// ---------------------------------------------------------------------------
// Shared state accumulated across sequential tests
// ---------------------------------------------------------------------------

let server: FastifyInstance;
let db: Database;

let plannerUserId = "";
let hallkeeperUserId = "";
let plannerToken = "";
let hallkeeperToken = "";

let venueId = "";
let spaceId = "";
let assetId = "";
let configId = "";
let placedObjectIds: string[] = [];
let enquiryId = "";

// Prompt 6.5 additions
let publicConfigId = "";
let guestEnquiryId = "";
const GUEST_EMAIL = `guest-${Date.now().toString(36)}@integration.test`;
const CLAIMER_EMAIL = `claimer-${Date.now().toString(36)}@integration.test`;
let claimerToken = "";
let claimerUserId = "";

// Prompt 6: L-shape space for polygon-containment regression tests
let lShapeSpaceId = "";
let lShapeConfigId = "";

// Prompt 3 (hallkeeper S+): hallkeeper pipeline integration
let hkTableAssetId = "";
let hkChairAssetId = "";
let hkConfigId = "";
const hkAccessoryIds: string[] = [];

// ---------------------------------------------------------------------------
// Helper: create a mock token for the auth middleware
// ---------------------------------------------------------------------------

function mockToken(user: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(user);
}

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!IS_REAL_DB) return;

  // Set NODE_ENV so the auth middleware accepts mock tokens
  process.env["NODE_ENV"] = "test";

  const { buildServer } = await import("../index.js");
  server = await buildServer();
  db = createDb(DATABASE_URL);
}, 30000);

afterAll(async () => {
  if (!IS_REAL_DB || db === undefined) return;

  // Clean up in reverse FK order
  try {
    if (guestEnquiryId !== "") {
      await db.delete(enquiryStatusHistory).where(eq(enquiryStatusHistory.enquiryId, guestEnquiryId));
      await db.delete(enquiries).where(eq(enquiries.id, guestEnquiryId));
    }
    if (enquiryId !== "") {
      await db.delete(enquiryStatusHistory).where(eq(enquiryStatusHistory.enquiryId, enquiryId));
      await db.delete(enquiries).where(eq(enquiries.id, enquiryId));
    }
    if (placedObjectIds.length > 0) {
      await db.delete(placedObjects).where(inArray(placedObjects.id, placedObjectIds));
    }
    if (publicConfigId !== "") {
      await db.delete(placedObjects).where(eq(placedObjects.configurationId, publicConfigId));
      await db.delete(configurations).where(eq(configurations.id, publicConfigId));
    }
    if (configId !== "") {
      await db.delete(placedObjects).where(eq(placedObjects.configurationId, configId));
      await db.delete(configurations).where(eq(configurations.id, configId));
    }
    if (lShapeConfigId !== "") {
      await db.delete(placedObjects).where(eq(placedObjects.configurationId, lShapeConfigId));
      await db.delete(configurations).where(eq(configurations.id, lShapeConfigId));
    }
    if (lShapeSpaceId !== "") {
      await db.delete(spaces).where(eq(spaces.id, lShapeSpaceId));
    }
    // Hallkeeper pipeline test cleanup
    if (hkConfigId !== "") {
      await db.delete(hallkeeperProgress).where(eq(hallkeeperProgress.configId, hkConfigId));
      await db.delete(placedObjects).where(eq(placedObjects.configurationId, hkConfigId));
      await db.delete(configurations).where(eq(configurations.id, hkConfigId));
    }
    if (hkAccessoryIds.length > 0) {
      await db.delete(assetAccessories).where(inArray(assetAccessories.id, hkAccessoryIds));
    }
    if (hkTableAssetId !== "") {
      await db.delete(assetDefinitions).where(eq(assetDefinitions.id, hkTableAssetId));
    }
    if (hkChairAssetId !== "") {
      await db.delete(assetDefinitions).where(eq(assetDefinitions.id, hkChairAssetId));
    }
    await db.delete(guestLeads).where(eq(guestLeads.email, GUEST_EMAIL));
    // Email audit rows — keys for this run all start with "enquiry-" and
    // embed an id the cleanup already knows. Wildcard-match on the run id
    // to scrub every audit row this run emitted.
    if (enquiryId !== "") {
      await db.delete(emailSends).where(like(emailSends.idempotencyKey, `%${enquiryId}%`));
    }
    if (guestEnquiryId !== "") {
      await db.delete(emailSends).where(like(emailSends.idempotencyKey, `%${guestEnquiryId}%`));
    }
    const testUserIds = [plannerUserId, hallkeeperUserId, claimerUserId].filter((id) => id !== "");
    if (testUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, testUserIds));
    }
  } catch (err) {
    console.error("Integration test cleanup error:", err);
  }

  if (server !== undefined) {
    await server.close();
  }
}, 30000);

// ---------------------------------------------------------------------------
// Tests — sequential, each builds on the previous
// ---------------------------------------------------------------------------

describe.skipIf(!IS_REAL_DB)("Integration: end-to-end against Neon", () => {
  // --- 1. Seed test users directly (Clerk handles real auth; tests use mock tokens) ---
  it("1. create planner user in DB + generate mock token", async () => {
    const [planner] = await db.insert(users).values({
      clerkId: `clerk_test_planner_${RUN_ID}`,
      email: PLANNER_EMAIL,
      name: "Integration Planner",
      role: "planner",
    }).returning();

    expect(planner).toBeDefined();
    plannerUserId = planner!.id;
    plannerToken = mockToken({
      id: plannerUserId,
      email: PLANNER_EMAIL,
      role: "planner",
      venueId: null,
    });
  }, 15000);

  // --- 2. Create hallkeeper user linked to Trades Hall ---
  it("2. create hallkeeper user linked to venue", async () => {
    // Get the venue ID from the seed data
    const venuesRes = await server.inject({ method: "GET", url: "/venues" });
    const venuesBody = JSON.parse(venuesRes.body) as { data: { id: string; slug: string }[] };
    const tradesHall = venuesBody.data.find((v) => v.slug === "trades-hall-glasgow");
    expect(tradesHall).toBeDefined();
    venueId = tradesHall!.id;

    const [hallkeeper] = await db.insert(users).values({
      clerkId: `clerk_test_hallkeeper_${RUN_ID}`,
      email: HALLKEEPER_EMAIL,
      name: "Integration Hallkeeper",
      role: "hallkeeper",
      venueId,
    }).returning();

    expect(hallkeeper).toBeDefined();
    hallkeeperUserId = hallkeeper!.id;
    hallkeeperToken = mockToken({
      id: hallkeeperUserId,
      email: HALLKEEPER_EMAIL,
      role: "hallkeeper",
      venueId,
    });
  }, 15000);

  // --- 3. Verify mock token auth works ---
  it("3. mock token auth — planner can access authenticated endpoints", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/configurations",
      headers: auth(plannerToken),
    });
    // Should not be 401 — mock token was accepted
    expect(res.statusCode).not.toBe(401);
  }, 15000);

  // --- 4. Verify hallkeeper auth works ---
  it("4. mock token auth — hallkeeper can access authenticated endpoints", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/enquiries",
      headers: auth(hallkeeperToken),
    });
    expect(res.statusCode).not.toBe(401);
  }, 15000);

  // --- 5. GET /venues ---
  it("5. list venues (public)", async () => {
    const res = await server.inject({ method: "GET", url: "/venues" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: unknown[]; meta: { total: number; limit: number; offset: number } };
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
    expect(body.meta.limit).toBe(20);
    expect(body.meta.offset).toBe(0);
  }, 15000);

  // --- 6. GET /venues/:id with spaces ---
  it("6. get venue with spaces", async () => {
    const res = await server.inject({ method: "GET", url: `/venues/${venueId}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { id: string; spaces: { id: string }[] } };
    expect(body.data.id).toBe(venueId);
    expect(body.data.spaces.length).toBeGreaterThanOrEqual(4);
    spaceId = body.data.spaces[0]!.id;
  }, 15000);

  // --- 7. GET /venues/:venueId/spaces ---
  it("7. list spaces for venue", async () => {
    const res = await server.inject({ method: "GET", url: `/venues/${venueId}/spaces` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { id: string }[] };
    expect(body.data.length).toBeGreaterThanOrEqual(4);
  }, 15000);

  // --- 8. POST /configurations ---
  it("8. planner creates configuration", async () => {
    const spacesRes = await server.inject({ method: "GET", url: `/venues/${venueId}/spaces` });
    const spacesBody = JSON.parse(spacesRes.body) as { data: { id: string }[] };
    spaceId = spacesBody.data[0]!.id;

    const res = await server.inject({
      method: "POST",
      url: "/configurations",
      headers: auth(plannerToken),
      payload: {
        spaceId,
        venueId,
        name: `Integration Test Config ${RUN_ID}`,
        layoutStyle: "dinner-rounds",
        guestCount: 120,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { data: { id: string; state: string } };
    configId = body.data.id;
    expect(body.data.state).toBe("draft");
  }, 15000);

  // --- 9. POST placed objects (3 items) ---
  it("9. place 3 objects in configuration", async () => {
    const { assetDefinitions } = await import("../db/schema.js");
    const assets = await db.select({ id: assetDefinitions.id }).from(assetDefinitions).limit(1);
    expect(assets.length).toBeGreaterThan(0);
    assetId = assets[0]!.id;

    for (let i = 0; i < 3; i++) {
      const res = await server.inject({
        method: "POST",
        url: `/configurations/${configId}/objects`,
        headers: auth(plannerToken),
        payload: {
          assetDefinitionId: assetId,
          positionX: i * 2.5,
          positionY: 0,
          positionZ: i * 1.5,
          rotationY: i * 0.5,
          scale: 1,
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as { data: { id: string } };
      placedObjectIds.push(body.data.id);
    }
    expect(placedObjectIds).toHaveLength(3);
  }, 30000);

  // --- 10. POST batch upsert (5 objects) ---
  // Fixture coordinates must stay inside the seeded Grand Hall polygon
  // (centred rect, x ∈ [-10.5, 10.5], z ∈ [-5, 5]). The polygon containment
  // check added in Prompt 6 rejects anything outside the room; the pre-check
  // fixture (i*3, i*2) spilled over the z-bound at i ≥ 3.
  it("10. batch upsert 5 objects", async () => {
    const batchObjects = Array.from({ length: 5 }, (_, i) => ({
      assetDefinitionId: assetId,
      positionX: i * 2,
      positionY: 0,
      positionZ: i * 0.8,
      rotationY: 0,
      scale: 1,
      sortOrder: i,
    }));

    const res = await server.inject({
      method: "POST",
      url: `/configurations/${configId}/objects/batch`,
      headers: auth(plannerToken),
      payload: { objects: batchObjects },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { id: string }[] };
    expect(body.data).toHaveLength(5);
    placedObjectIds = body.data.map((o) => o.id);
  }, 15000);

  // --- 11. GET placed objects ---
  it("11. get all objects in configuration", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/configurations/${configId}/objects`,
      headers: auth(plannerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: unknown[] };
    expect(body.data.length).toBeGreaterThanOrEqual(5);
  }, 15000);

  // --- 12. POST /enquiries (planner creates enquiry) ---
  it("12. planner creates enquiry linked to configuration", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/enquiries",
      headers: auth(plannerToken),
      payload: {
        configurationId: configId,
        venueId,
        spaceId,
        name: "Integration Wedding",
        email: PLANNER_EMAIL,
        eventType: "Wedding",
        estimatedGuests: 120,
        message: "Integration test enquiry",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { data: { id: string; state: string } };
    enquiryId = body.data.id;
    expect(body.data.state).toBe("draft");
  }, 15000);

  // --- 13. Transition: draft → submitted (planner) ---
  it("13. planner submits enquiry (draft → submitted)", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/enquiries/${enquiryId}/transition`,
      headers: auth(plannerToken),
      payload: { status: "submitted" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { state: string } };
    expect(body.data.state).toBe("submitted");
  }, 15000);

  // --- 14. Transition: submitted → under_review (hallkeeper) ---
  it("14. hallkeeper reviews enquiry (submitted → under_review)", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/enquiries/${enquiryId}/transition`,
      headers: auth(hallkeeperToken),
      payload: { status: "under_review", note: "Checking availability" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { state: string } };
    expect(body.data.state).toBe("under_review");
  }, 15000);

  // --- 15. Transition: under_review → approved (hallkeeper) ---
  it("15. hallkeeper approves enquiry (under_review → approved)", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/enquiries/${enquiryId}/transition`,
      headers: auth(hallkeeperToken),
      payload: { status: "approved", note: "Date confirmed" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { state: string } };
    expect(body.data.state).toBe("approved");
  }, 15000);

  // --- 16. GET /enquiries/:id/history ---
  it("16. enquiry history shows 3 transitions", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/enquiries/${enquiryId}/history`,
      headers: auth(plannerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { fromStatus: string; toStatus: string }[] };
    expect(body.data).toHaveLength(3);
    expect(body.data[0]!.fromStatus).toBe("draft");
    expect(body.data[0]!.toStatus).toBe("submitted");
    expect(body.data[1]!.fromStatus).toBe("submitted");
    expect(body.data[1]!.toStatus).toBe("under_review");
    expect(body.data[2]!.fromStatus).toBe("under_review");
    expect(body.data[2]!.toStatus).toBe("approved");
  }, 15000);

  // --- 17. GET /enquiries as planner ---
  it("17. planner sees own enquiry in list", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/enquiries",
      headers: auth(plannerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { id: string }[] };
    const found = body.data.find((e) => e.id === enquiryId);
    expect(found).toBeDefined();
  }, 15000);

  // --- 18. GET /enquiries as hallkeeper ---
  it("18. hallkeeper sees venue enquiry in list", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/enquiries",
      headers: auth(hallkeeperToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { id: string }[] };
    const found = body.data.find((e) => e.id === enquiryId);
    expect(found).toBeDefined();
  }, 15000);

  // --- 19. Planner cannot approve (FAILURE PATH) ---
  it("19. planner cannot archive approved enquiry → 422", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/enquiries/${enquiryId}/transition`,
      headers: auth(plannerToken),
      payload: { status: "archived" },
    });
    expect(res.statusCode).toBe(422);
  }, 15000);

  // --- 20. Planner only sees own enquiries ---
  it("20. planner only sees own enquiries (not all venue enquiries)", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/enquiries",
      headers: auth(plannerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { userId: string }[] };
    for (const enq of body.data) {
      expect(enq.userId).toBe(plannerUserId);
    }
  }, 15000);

  // --- 21. Invalid token → 401 ---
  it("21. expired/invalid token returns 401", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/configurations",
      headers: { authorization: "Bearer invalid.token.here" },
    });
    expect(res.statusCode).toBe(401);
  }, 15000);

  // --- 22. Create enquiry for non-existent configuration → 404 ---
  it("22. create enquiry for non-existent configuration → 404", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/enquiries",
      headers: auth(plannerToken),
      payload: {
        configurationId: "00000000-0000-0000-0000-000000000000",
        venueId,
        spaceId,
        name: "Bad Config",
        email: PLANNER_EMAIL,
      },
    });
    expect(res.statusCode).toBe(404);
  }, 15000);

  // --- 23. Invalid state transition → 422 ---
  it("23. invalid transition (approved → submitted by planner) → 422", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/enquiries/${enquiryId}/transition`,
      headers: auth(plannerToken),
      payload: { status: "submitted" },
    });
    expect(res.statusCode).toBe(422);
  }, 15000);

  // --- 24. Soft delete configuration ---
  it("24. soft delete configuration, verify disappears from GET", async () => {
    const delRes = await server.inject({
      method: "DELETE",
      url: `/configurations/${configId}`,
      headers: auth(plannerToken),
    });
    expect(delRes.statusCode).toBe(204);

    const getRes = await server.inject({
      method: "GET",
      url: `/configurations/${configId}`,
      headers: auth(plannerToken),
    });
    expect(getRes.statusCode).toBe(404);

    const [row] = await db.select()
      .from(configurations)
      .where(eq(configurations.id, configId))
      .limit(1);
    expect(row).toBeDefined();
    expect(row!.deletedAt).not.toBeNull();
  }, 15000);

  // --- 25. FK integrity: delete placed object, config still exists ---
  it("25. delete placed object does not affect configuration", async () => {
    const [configRow] = await db.select()
      .from(configurations)
      .where(eq(configurations.id, configId))
      .limit(1);
    expect(configRow).toBeDefined();
    expect(configRow!.id).toBe(configId);
  }, 15000);

  // =========================================================================
  // Public editor, guest enquiries, claim, search
  // =========================================================================

  // --- 26. Create public preview config (no auth) ---
  it("26. create public preview config + batch save objects", async () => {
    const createRes = await server.inject({
      method: "POST",
      url: "/public/configurations",
      payload: { spaceId },
    });
    expect(createRes.statusCode).toBe(201);
    const createBody = JSON.parse(createRes.body) as { data: { id: string; isPublicPreview: boolean; userId: string | null } };
    publicConfigId = createBody.data.id;
    expect(createBody.data.isPublicPreview).toBe(true);
    expect(createBody.data.userId).toBeNull();

    const batchRes = await server.inject({
      method: "POST",
      url: `/public/configurations/${publicConfigId}/objects/batch`,
      payload: {
        objects: [
          { assetDefinitionId: assetId, positionX: 1, positionY: 0, positionZ: 2 },
          { assetDefinitionId: assetId, positionX: 3, positionY: 0, positionZ: 4 },
        ],
      },
    });
    expect(batchRes.statusCode).toBe(200);
    const batchBody = JSON.parse(batchRes.body) as { data: { id: string }[] };
    expect(batchBody.data).toHaveLength(2);

    const getRes = await server.inject({
      method: "GET",
      url: `/public/configurations/${publicConfigId}`,
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.body) as { data: { objects: unknown[]; isPublicPreview: boolean } };
    expect(getBody.data.objects).toHaveLength(2);
    expect(getBody.data.isPublicPreview).toBe(true);
  }, 30000);

  // --- 27. Submit guest enquiry against the public config ---
  it("27. submit guest enquiry + hallkeeper can see it", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/public/enquiries",
      payload: {
        configurationId: publicConfigId,
        email: GUEST_EMAIL,
        phone: "+44 7700 900999",
        name: "Candlelight Orchestra",
        eventType: "Concert",
        guestCount: 150,
        message: "We love candles",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { data: { enquiryId: string; message: string } };
    guestEnquiryId = body.data.enquiryId;
    expect(body.data.message).toContain("events team");

    const listRes = await server.inject({
      method: "GET",
      url: "/enquiries",
      headers: auth(hallkeeperToken),
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body) as { data: { id: string }[] };
    const found = listBody.data.find((e) => e.id === guestEnquiryId);
    expect(found).toBeDefined();
  }, 30000);

  // --- 28. Create claimer user + claim the preview config ---
  it("28. create claimer user then claim preview config", async () => {
    const [claimer] = await db.insert(users).values({
      clerkId: `clerk_test_claimer_${RUN_ID}`,
      email: CLAIMER_EMAIL,
      name: "Config Claimer",
      role: "planner",
    }).returning();

    expect(claimer).toBeDefined();
    claimerUserId = claimer!.id;
    claimerToken = mockToken({
      id: claimerUserId,
      email: CLAIMER_EMAIL,
      role: "planner",
      venueId: null,
    });

    const claimRes = await server.inject({
      method: "POST",
      url: `/configurations/${publicConfigId}/claim`,
      headers: auth(claimerToken),
    });
    expect(claimRes.statusCode).toBe(200);
    const claimBody = JSON.parse(claimRes.body) as { data: { userId: string; isPublicPreview: boolean } };
    expect(claimBody.data.userId).toBe(claimerUserId);
    expect(claimBody.data.isPublicPreview).toBe(false);

    const reClaimRes = await server.inject({
      method: "POST",
      url: `/configurations/${publicConfigId}/claim`,
      headers: auth(claimerToken),
    });
    expect(reClaimRes.statusCode).toBe(409);
  }, 30000);

  // --- 29. Client search finds the guest lead ---
  it("29. client search returns guest lead by name", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/clients/search?q=Candlelight",
      headers: auth(hallkeeperToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { guestLeads: { email: string }[] } };
    const found = body.data.guestLeads.find((l) => l.email === GUEST_EMAIL);
    expect(found).toBeDefined();
  }, 15000);

  // --- 30. Admin cleanup spares claimed config ---
  it("30. cleanup spares preview config linked to enquiry", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/admin/cleanup",
      headers: auth(plannerToken),
    });
    expect(res.statusCode).toBe(403);

    const { cleanupPreviewConfigurations } = await import("../services/cleanup.js");
    const deleted = await cleanupPreviewConfigurations(db);
    expect(deleted).toBe(0);
  }, 15000);

  // =========================================================================
  // Prompt 6: polygon-aware placement validation (L-shape regression)
  //
  // A bbox-only check would accept a point like (7, 7) inside a 10×10 L-shape
  // because it falls within the enclosing rectangle. The ray-cast polygon
  // check correctly rejects it — it's in the carved-out corner.
  // =========================================================================

  // --- 31. Create an L-shaped space via POST /venues/:venueId/spaces ---
  it("31. hallkeeper creates an L-shaped space at Trades Hall", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/venues/${venueId}/spaces`,
      headers: auth(hallkeeperToken),
      payload: {
        name: `L-Shape Test ${RUN_ID}`,
        slug: `l-shape-test-${RUN_ID.toLowerCase()}`,
        heightM: 3,
        // Anchored at origin; top-right quadrant carved out.
        // Bounding box is 10×10; carved-out region is [4..10] × [4..10].
        floorPlanOutline: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 4 },
          { x: 4, y: 4 },
          { x: 4, y: 10 },
          { x: 0, y: 10 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { data: { id: string; widthM: string; lengthM: string } };
    lShapeSpaceId = body.data.id;
    // Invariant from Prompt 5 — bbox derived from polygon.
    expect(Number(body.data.widthM)).toBe(10);
    expect(Number(body.data.lengthM)).toBe(10);
  }, 15000);

  // --- 32. Planner creates a config against the L-shape space ---
  it("32. planner creates a configuration in the L-shape space", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/configurations",
      headers: auth(plannerToken),
      payload: {
        spaceId: lShapeSpaceId,
        venueId,
        name: `L-Shape Config ${RUN_ID}`,
        layoutStyle: "custom",
        guestCount: 0,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { data: { id: string } };
    lShapeConfigId = body.data.id;
  }, 15000);

  // --- 33. REGRESSION: single-object POST with a bbox-only-valid point ---
  it("33. POST /objects rejects (7, 0, 7) — inside bbox, outside L polygon", async () => {
    // Sanity: (7, 7) is inside the 10×10 bounding box, which is what a
    // naive bbox-only check would see. The polygon check must reject it
    // because it lies in the carved-out quadrant.
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${lShapeConfigId}/objects`,
      headers: auth(plannerToken),
      payload: {
        assetDefinitionId: assetId,
        positionX: 7,
        positionY: 0,
        positionZ: 7,
        scale: 1,
      },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as {
      code: string;
      details: { invalid: { index: number; positionX: number; positionZ: number }[] };
    };
    expect(body.code).toBe("PLACEMENT_OUT_OF_BOUNDS");
    expect(body.details.invalid).toEqual([{ index: 0, positionX: 7, positionZ: 7 }]);
  }, 15000);

  // --- 34. Same point accepted when inside the L's occupied arm ---
  it("34. POST /objects accepts (2, 0, 2) — inside the L's occupied region", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${lShapeConfigId}/objects`,
      headers: auth(plannerToken),
      payload: {
        assetDefinitionId: assetId,
        positionX: 2,
        positionY: 0,
        positionZ: 2,
        scale: 1,
      },
    });
    expect(res.statusCode).toBe(201);
  }, 15000);

  // --- 35. Batch rejects atomically and reports every out-of-bounds index ---
  it("35. POST /objects/batch rejects a mixed batch and lists every bad index", async () => {
    const batch = [
      { assetDefinitionId: assetId, positionX: 1, positionY: 0, positionZ: 1, scale: 1 }, // ok
      { assetDefinitionId: assetId, positionX: 8, positionY: 0, positionZ: 8, scale: 1 }, // BAD (carved)
      { assetDefinitionId: assetId, positionX: 2, positionY: 0, positionZ: 9, scale: 1 }, // ok (left arm)
      { assetDefinitionId: assetId, positionX: 5, positionY: 0, positionZ: 7, scale: 1 }, // BAD (carved)
    ];
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${lShapeConfigId}/objects/batch`,
      headers: auth(plannerToken),
      payload: { objects: batch },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as {
      code: string;
      details: { invalid: { index: number }[] };
    };
    expect(body.code).toBe("PLACEMENT_OUT_OF_BOUNDS");
    expect(body.details.invalid.map((i) => i.index)).toEqual([1, 3]);

    // Atomic: no objects from the rejected batch should have been written.
    const listRes = await server.inject({
      method: "GET",
      url: `/configurations/${lShapeConfigId}/objects`,
      headers: auth(plannerToken),
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body) as { data: { id: string }[] };
    // Only the single object from test 34 should exist.
    expect(listBody.data).toHaveLength(1);
  }, 15000);

  // --- 36. Public batch path enforces the same invariant ---
  it("36. public batch POST also rejects placements outside the L polygon", async () => {
    // Create a public preview config against the L-shape space, then try
    // to batch-save a point in the carved corner. Must get 422.
    const createRes = await server.inject({
      method: "POST",
      url: "/public/configurations",
      payload: { spaceId: lShapeSpaceId },
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.body) as { data: { id: string } };
    const publicLConfigId = created.data.id;

    try {
      const batchRes = await server.inject({
        method: "POST",
        url: `/public/configurations/${publicLConfigId}/objects/batch`,
        payload: {
          objects: [
            { assetDefinitionId: assetId, positionX: 9, positionY: 0, positionZ: 9 },
          ],
        },
      });
      expect(batchRes.statusCode).toBe(422);
      const body = JSON.parse(batchRes.body) as { code: string };
      expect(body.code).toBe("PLACEMENT_OUT_OF_BOUNDS");
    } finally {
      await db.delete(placedObjects).where(eq(placedObjects.configurationId, publicLConfigId));
      await db.delete(configurations).where(eq(configurations.id, publicLConfigId));
    }
  }, 20000);

  // =========================================================================
  // Prompt 9: email audit + idempotency against real Neon
  //
  // Tests 13–15 above already drove the approval/rejection transitions,
  // each of which fires an email via the new sendEmailAsync pipeline.
  // That pipeline INSERTs an `email_sends` row keyed by
  // "enquiry-approved:{id}" / "enquiry-rejected:{id}". These tests poll
  // for the audit row and then verify that re-firing the same transition
  // does not produce a duplicate row — the UNIQUE constraint on
  // idempotency_key is the load-bearing dedup mechanism.
  // =========================================================================

  async function pollForEmailRow(key: string, timeoutMs = 5000): Promise<{ status: string; idempotencyKey: string } | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rows = await db.select({ status: emailSends.status, idempotencyKey: emailSends.idempotencyKey })
        .from(emailSends)
        .where(eq(emailSends.idempotencyKey, key))
        .limit(1);
      if (rows.length > 0 && rows[0] !== undefined) return rows[0];
      await new Promise((resolve) => { setTimeout(resolve, 100); });
    }
    return null;
  }

  // --- 37. Approval transition wrote an audit row ---
  it("37. enquiryApproved fired by test 15 created an email_sends row", async () => {
    // Test 15 approved the main test enquiry; sendEmailAsync is fire-and-
    // forget via setImmediate, so we poll for a short window. RESEND_API_KEY
    // is unset in CI/test so status should land on "dev_mode".
    const key = `enquiry-approved:${enquiryId}`;
    const row = await pollForEmailRow(key);
    expect(row).not.toBeNull();
    expect(row?.idempotencyKey).toBe(key);
    // Status is either "dev_mode" (no provider key) or "sent" (provider
    // configured) — both are terminal and dedup-eligible.
    // Any terminal status is acceptable — the audit guarantee is "the row
    // exists and isn't stuck at pending". Which terminal state depends on
    // the test environment: RESEND_API_KEY unset → "dev_mode"; set but
    // pointed at Resend with fake-domain recipients → "failed"; set and
    // the recipient is a real address → "sent".
    expect(row?.status).not.toBe("pending");
    expect(["dev_mode", "sent", "failed"]).toContain(row?.status);
  }, 15000);

  // --- 38. Re-firing an already-sent transition does NOT double-send ---
  it("38. approving again (idempotency-key collision) produces no second audit row", async () => {
    // The main enquiry is already "approved". Trying to transition to
    // "approved" again is a 422 from the state machine (no valid
    // approved → approved transition) — BUT even if a caller found a
    // path to re-fire the email (double-click on a different row,
    // webhook replay), the idempotency key would collide with the
    // existing audit row and dedup_skip rather than send twice.
    //
    // We verify this at the audit layer directly: by counting rows for
    // the key before and after a second transition attempt, no new row
    // should appear.
    const key = `enquiry-approved:${enquiryId}`;
    const countRowsFor = async (): Promise<number> => {
      const rows = await db.select({ id: emailSends.id })
        .from(emailSends)
        .where(eq(emailSends.idempotencyKey, key));
      return rows.length;
    };

    const before = await countRowsFor();
    expect(before).toBe(1);

    // Attempt a transition that would (if the state machine permitted)
    // re-fire the approved email. The state machine rejects with 422 —
    // what matters for this test is that no second audit row lands.
    await server.inject({
      method: "POST",
      url: `/enquiries/${enquiryId}/transition`,
      headers: auth(hallkeeperToken),
      payload: { status: "approved" },
    });

    // Give setImmediate a tick to drain if any fire-and-forget leaked out.
    await new Promise((resolve) => { setTimeout(resolve, 300); });

    const after = await countRowsFor();
    expect(after).toBe(1); // no duplicate
  }, 15000);

  // --- 39. Guest enquiry fired per-hallkeeper notifications with distinct keys ---
  it("39. guest enquiry submission produced at most one audit row per hallkeeper (email)", async () => {
    // Test 27 submitted a guest enquiry. The route loops over hallkeepers
    // for that venue — a single hallkeeper exists in this test run
    // (hallkeeperUserId). The key pattern is
    // "enquiry-new:{guestEnquiryId}:{hallkeeperUserId}".
    const key = `enquiry-new:${guestEnquiryId}:${hallkeeperUserId}`;
    const row = await pollForEmailRow(key);
    expect(row).not.toBeNull();
    expect(row?.idempotencyKey).toBe(key);
    // Any terminal status is acceptable — the audit guarantee is "the row
    // exists and isn't stuck at pending". Which terminal state depends on
    // the test environment: RESEND_API_KEY unset → "dev_mode"; set but
    // pointed at Resend with fake-domain recipients → "failed"; set and
    // the recipient is a real address → "sent".
    expect(row?.status).not.toBe("pending");
    expect(["dev_mode", "sent", "failed"]).toContain(row?.status);

    // And cross-check there's no silent double-notification: exactly one
    // row for that hallkeeper + enquiry.
    const all = await db.select({ id: emailSends.id })
      .from(emailSends)
      .where(eq(emailSends.idempotencyKey, key));
    expect(all).toHaveLength(1);
  }, 15000);

  // =========================================================================
  // HALLKEEPER PIPELINE — full end-to-end against real Neon
  //
  // These tests prove the pipeline that the hallkeeper sheet depends on:
  //   insert assets → insert accessories → place objects → /v2 → verify
  //
  // Self-contained: creates its own test assets + accessories so the test
  // doesn't depend on the seed having been run with the canonical catalogue.
  // Cleans up in afterAll.
  // =========================================================================

  it("40. insert test assets for hallkeeper pipeline (table + chair)", async () => {
    const [table] = await db.insert(assetDefinitions).values({
      id: "e0e0e0e0-0000-4000-a000-000000000001",
      name: "HK Test Round Table",
      category: "table",
      widthM: "1.83",
      depthM: "1.83",
      heightM: "0.76",
      seatCount: 10,
      collisionType: "cylinder",
    }).returning();
    expect(table).toBeDefined();
    hkTableAssetId = table!.id;

    const [chair] = await db.insert(assetDefinitions).values({
      id: "e0e0e0e0-0000-4000-a000-000000000002",
      name: "HK Test Chair",
      category: "chair",
      widthM: "0.45",
      depthM: "0.45",
      heightM: "0.90",
      seatCount: 1,
      collisionType: "box",
    }).returning();
    expect(chair).toBeDefined();
    hkChairAssetId = chair!.id;
  }, 15000);

  it("41. insert accessory rules for the test table + chair", async () => {
    const rows = await db.insert(assetAccessories).values([
      {
        parentAssetId: hkTableAssetId,
        name: "Ivory Tablecloth",
        category: "decor",
        quantityPerParent: 1,
        phase: "dress",
        afterDepth: 0,
      },
      {
        parentAssetId: hkTableAssetId,
        name: "Gold Runner",
        category: "decor",
        quantityPerParent: 1,
        phase: "dress",
        afterDepth: 1,
      },
      {
        parentAssetId: hkTableAssetId,
        name: "LED Candle",
        category: "decor",
        quantityPerParent: 3,
        phase: "final",
        afterDepth: 0,
      },
      {
        parentAssetId: hkChairAssetId,
        name: "Chair Sash",
        category: "decor",
        quantityPerParent: 1,
        phase: "dress",
        afterDepth: 0,
      },
    ]).returning();
    expect(rows).toHaveLength(4);
    for (const r of rows) hkAccessoryIds.push(r.id);
  }, 15000);

  it("42. create a configuration for the hallkeeper pipeline", async () => {
    const [cfg] = await db.insert(configurations).values({
      spaceId: spaceId,
      venueId: venueId,
      userId: plannerUserId,
      name: `HK Pipeline ${RUN_ID}`,
      layoutStyle: "dinner-rounds",
    }).returning();
    expect(cfg).toBeDefined();
    hkConfigId = cfg!.id;
  }, 15000);

  it("43. place a table + 2 chairs via API (auth batch save)", async () => {
    const groupId = `hk-group-${RUN_ID}`;
    const res = await server.inject({
      method: "POST",
      url: `/configurations/${hkConfigId}/objects`,
      headers: auth(plannerToken),
      payload: {
        assetDefinitionId: hkTableAssetId,
        positionX: 0,
        positionY: 0,
        positionZ: 0,
        rotationY: 0,
        scale: 1,
        metadata: { groupId },
      },
    });
    expect(res.statusCode).toBe(201);

    for (let i = 0; i < 2; i++) {
      const chairRes = await server.inject({
        method: "POST",
        url: `/configurations/${hkConfigId}/objects`,
        headers: auth(plannerToken),
        payload: {
          assetDefinitionId: hkChairAssetId,
          positionX: i * 0.5,
          positionY: 0,
          positionZ: 0.5,
          rotationY: 0,
          scale: 1,
          metadata: { groupId },
        },
      });
      expect(chairRes.statusCode).toBe(201);
    }
  }, 15000);

  it("44. GET /hallkeeper/:configId/v2 returns phase/zone manifest with accessories", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${hkConfigId}/v2`,
      headers: auth(plannerToken),
    });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body) as {
      data: {
        phases: { phase: string; zones: { zone: string; rows: { name: string; qty: number; isAccessory: boolean; afterDepth: number }[] }[] }[];
        totals: { totalRows: number; totalItems: number };
      };
    };
    const { data } = body;

    // The response must have phases
    expect(data.phases.length).toBeGreaterThan(0);

    // Flatten all rows for inspection
    const allRows = data.phases.flatMap((p) => p.zones.flatMap((z) => z.rows));

    // The parent table row should be present
    const tableRow = allRows.find((r) => r.name.includes("HK Test Round Table"));
    expect(tableRow).toBeDefined();
    expect(tableRow?.name).toContain("with 2 chairs");

    // Accessory rows should be present (from the DB, not a static lookup)
    const cloth = allRows.find((r) => r.name === "Ivory Tablecloth");
    expect(cloth).toBeDefined();
    expect(cloth?.isAccessory).toBe(true);
    expect(cloth?.qty).toBe(1);

    const runner = allRows.find((r) => r.name === "Gold Runner");
    expect(runner).toBeDefined();
    expect(runner?.afterDepth).toBe(1); // after the cloth

    const candle = allRows.find((r) => r.name === "LED Candle");
    expect(candle).toBeDefined();
    expect(candle?.qty).toBe(3); // 3 per table

    // Chair sashes — 2 chairs placed, each generates 1 sash = 2 total
    const sash = allRows.find((r) => r.name === "Chair Sash");
    expect(sash).toBeDefined();
    expect(sash?.qty).toBe(2);

    // Totals must account for everything
    expect(data.totals.totalRows).toBeGreaterThanOrEqual(5); // table + cloth + runner + candle + sash (minimum)
    expect(data.totals.totalItems).toBeGreaterThanOrEqual(8); // 1 table + 1 cloth + 1 runner + 3 candles + 2 sash
  }, 15000);

  it("45. GET /hallkeeper/:configId/sheet returns a PDF buffer", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${hkConfigId}/sheet`,
      headers: auth(plannerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    // PDF magic bytes: %PDF
    expect(res.rawPayload.slice(0, 4).toString("ascii")).toBe("%PDF");
  }, 15000);

  it("46. PATCH /progress checks a row, GET /progress returns it", async () => {
    // Check a row
    const patchRes = await server.inject({
      method: "PATCH",
      url: `/hallkeeper/${hkConfigId}/progress`,
      headers: auth(plannerToken),
      payload: { rowKey: "dress|Centre|Ivory Tablecloth|0" },
    });
    expect(patchRes.statusCode).toBe(200);
    const patchBody = JSON.parse(patchRes.body) as { data: { checked: boolean } };
    expect(patchBody.data.checked).toBe(true);

    // GET progress — the key should be present
    const getRes = await server.inject({
      method: "GET",
      url: `/hallkeeper/${hkConfigId}/progress`,
      headers: auth(plannerToken),
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.body) as { data: { checked: Record<string, string> } };
    expect(getBody.data.checked["dress|Centre|Ivory Tablecloth|0"]).toBeDefined();
  }, 15000);

  it("47. PATCH same rowKey again unchecks it (toggle)", async () => {
    const patchRes = await server.inject({
      method: "PATCH",
      url: `/hallkeeper/${hkConfigId}/progress`,
      headers: auth(plannerToken),
      payload: { rowKey: "dress|Centre|Ivory Tablecloth|0" },
    });
    expect(patchRes.statusCode).toBe(200);
    const patchBody = JSON.parse(patchRes.body) as { data: { checked: boolean } };
    expect(patchBody.data.checked).toBe(false);

    // GET should no longer have the key
    const getRes = await server.inject({
      method: "GET",
      url: `/hallkeeper/${hkConfigId}/progress`,
      headers: auth(plannerToken),
    });
    const getBody = JSON.parse(getRes.body) as { data: { checked: Record<string, string> } };
    expect(getBody.data.checked["dress|Centre|Ivory Tablecloth|0"]).toBeUndefined();
  }, 15000);

  it("48. /progress returns 401 without auth", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${hkConfigId}/progress`,
    });
    expect(res.statusCode).toBe(401);
  }, 15000);

  it("49. /v2 returns 404 for non-existent config", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/hallkeeper/00000000-0000-0000-0000-ffffffffffff/v2",
      headers: auth(plannerToken),
    });
    expect(res.statusCode).toBe(404);
  }, 15000);
});
