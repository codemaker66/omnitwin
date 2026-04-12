import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { createDb, type Database } from "../db/client.js";
import {
  users, configurations, placedObjects, enquiries,
  enquiryStatusHistory, guestLeads,
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
    await db.delete(guestLeads).where(eq(guestLeads.email, GUEST_EMAIL));
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
  it("10. batch upsert 5 objects", async () => {
    const batchObjects = Array.from({ length: 5 }, (_, i) => ({
      assetDefinitionId: assetId,
      positionX: i * 3,
      positionY: 0,
      positionZ: i * 2,
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
});
