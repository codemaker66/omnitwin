import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { buildSheetPaperCheckUrl } from "@omnitwin/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { claimConfigRoutes } from "../routes/claim-config.js";
import { enquiryRoutes } from "../routes/enquiries.js";
import { placedObjectRoutes } from "../routes/placed-objects.js";
import { publicConfigRoutes } from "../routes/public-configs.js";
import { cleanupPreviewConfigurations } from "../services/cleanup.js";

// ---------------------------------------------------------------------------
// Claiming a plan into an account (release audit, batch C parts 1 and 4).
//
// /plan creates every new plan through POST /public/configurations, which
// stores it with no owner. A signed-in person's editor then saves through the
// authenticated batch route, which answers only the owner or the venue floor,
// so the editor claims the draft right after creating it.
//
// A plan's id is shared (/plan/<id>, "Copy layout link"), so the claim needs
// the secret the create route gave the browser that made the plan, a claim
// never moves the guest's enquiries, and a plan the venue has linked to an
// event is never claimable (public-surface-1). This proves, on the real routes
// and a migrated database, both the refusals and the creator's path.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Claim tests require the explicit disposable platform database");
  }
}

interface Person { readonly id: string; readonly role: string; readonly venueId: string | null }
interface Draft { readonly id: string; readonly revision: number; readonly claimSecret: string }

describe.skipIf(target === undefined)("claiming a plan on the migrated disposable database", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  const venueId = randomUUID();
  const spaceId = randomUUID();
  const chairId = randomUUID();
  const client: Person = { id: randomUUID(), role: "client", venueId: null };
  const partner: Person = { id: randomUUID(), role: "client", venueId: null };
  const staff: Person = { id: randomUUID(), role: "staff", venueId };
  const planner: Person = { id: randomUUID(), role: "planner", venueId: null };

  function as(person: Person): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id: person.id, email: `${person.id}@claim.invalid`, role: person.role, platformRole: "none", venueId: person.venueId })}` };
  }

  /** What /plan does for everyone: a new plan through the public route. */
  async function newDraft(): Promise<Draft> {
    const response = await server.inject({ method: "POST", url: "/public/configurations", payload: { spaceId } });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ data: Draft }>().data;
  }

  async function claim(configId: string, person: Person, claimSecret?: string): Promise<{ statusCode: number; body: string; code: string | undefined }> {
    const response = await server.inject({
      method: "POST", url: `/configurations/${configId}/claim`, headers: as(person),
      ...(claimSecret === undefined ? {} : { payload: { claimSecret } }),
    });
    return { statusCode: response.statusCode, body: response.body, code: response.json<{ code?: string }>().code };
  }

  function signedInSave(configId: string, revision: number, person: Person): Promise<{ statusCode: number; body: string }> {
    return server.inject({
      method: "POST", url: `/configurations/${configId}/objects/batch`, headers: as(person),
      payload: { expectedRevision: revision, objects: [{
        assetDefinitionId: chairId, positionX: 1, positionY: 0, positionZ: 1,
        rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: 0,
      }] },
    });
  }

  async function row(configId: string): Promise<typeof schema.configurations.$inferSelect | undefined> {
    const [found] = await db.select().from(schema.configurations).where(eq(schema.configurations.id, configId)).limit(1);
    return found;
  }

  async function secretKept(configId: string): Promise<boolean> {
    const found = await db.select().from(schema.configurationClaimSecrets)
      .where(eq(schema.configurationClaimSecrets.configurationId, configId));
    return found.length === 1;
  }

  /** The enquiry a guest sends with their plan: their details, for the venue alone. */
  async function guestEnquiry(configId: string): Promise<string> {
    const [enquiry] = await db.insert(schema.enquiries).values({
      venueId, spaceId, configurationId: configId, userId: null, state: "submitted",
      name: "Guest", email: "guest@claim.invalid", guestName: "Guest", guestEmail: "guest@claim.invalid",
      guestPhone: "+44 7700 900000", message: "TEST ONLY: our wedding",
    }).returning({ id: schema.enquiries.id });
    if (enquiry === undefined) throw new Error("Enquiry fixture not written");
    return enquiry.id;
  }

  async function enquiryIdsSeenBy(person: Person): Promise<readonly string[]> {
    const response = await server.inject({ method: "GET", url: "/enquiries?limit=100", headers: as(person) });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ data: { id: string }[] }>().data.map((enquiry) => enquiry.id);
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `claim_new_draft_${randomUUID()}`, max: 4 });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY claim venue", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Room", slug: "room", widthM: "20", lengthM: "20", heightM: "4",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] });
    await db.insert(schema.users).values([
      { id: client.id, name: "Claim client", email: `${client.id}@claim.invalid`, role: "client" },
      { id: partner.id, name: "Claim partner", email: `${partner.id}@claim.invalid`, role: "client" },
      { id: staff.id, name: "Claim staff", email: `${staff.id}@claim.invalid`, role: "staff", venueId },
      { id: planner.id, name: "Claim planner", email: `${planner.id}@claim.invalid`, role: "planner" },
    ]);
    await db.insert(schema.assetDefinitions).values({ id: chairId, name: "TEST ONLY claim chair", category: "chair", widthM: "0.5", depthM: "0.5", heightM: "0.9" });
    server = Fastify();
    await server.register(publicConfigRoutes, { db, prefix: "/public" });
    await server.register(placedObjectRoutes, { db, prefix: "/configurations/:configId/objects" });
    await server.register(claimConfigRoutes, { db, prefix: "/configurations" });
    await server.register(enquiryRoutes, { db, prefix: "/enquiries" });
    await server.ready();
  }, 60000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  it("gives the creating browser a claim secret, stores only its hash, and never returns either on a read", async () => {
    const draft = await newDraft();
    expect(draft.claimSecret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const [stored] = await db.select().from(schema.configurationClaimSecrets)
      .where(eq(schema.configurationClaimSecrets.configurationId, draft.id));
    expect(stored?.secretHash).toMatch(/^[a-f0-9]{64}$/u);
    // Reading the plan, as anyone with its link can, returns neither.
    const read = await server.inject({ method: "GET", url: `/public/configurations/${draft.id}` });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.body).not.toContain(draft.claimSecret);
    expect(read.body).not.toContain(stored?.secretHash ?? "missing");
  });

  it("refuses a signed-in client's save to a new plan nobody owns, and accepts it once its creator claims it", async () => {
    const draft = await newDraft();
    expect(await row(draft.id)).toMatchObject({ userId: null, isPublicPreview: true });

    const refused = await signedInSave(draft.id, draft.revision, client);
    expect(refused.statusCode).toBe(403);

    const claimed = await claim(draft.id, client, draft.claimSecret);
    expect(claimed.statusCode, claimed.body).toBe(200);
    expect(await row(draft.id)).toMatchObject({ userId: client.id, isPublicPreview: false, visibility: "private" });
    expect(await secretKept(draft.id)).toBe(false);

    const saved = await signedInSave(draft.id, draft.revision, client);
    expect(saved.statusCode, saved.body).toBe(200);
  });

  it("refuses a signed-in partner who has only the link, and keeps the guest's enquiry out of their sight", async () => {
    const draft = await newDraft();
    const enquiryId = await guestEnquiry(draft.id);
    const other = await newDraft();

    expect((await claim(draft.id, partner)).statusCode).toBe(400);
    const guessed = await claim(draft.id, partner, "x".repeat(43));
    expect(guessed.statusCode).toBe(403);
    expect(guessed.code).toBe("NOT_PLAN_CREATOR");
    // A secret for another plan proves nothing about this one.
    expect((await claim(draft.id, partner, other.claimSecret)).statusCode).toBe(403);

    expect(await row(draft.id)).toMatchObject({ userId: null, isPublicPreview: true });
    expect(await secretKept(draft.id)).toBe(true);
    expect(await enquiryIdsSeenBy(partner)).not.toContain(enquiryId);
  });

  it("leaves the guest's enquiry with the venue when the plan's creator claims it", async () => {
    const draft = await newDraft();
    const enquiryId = await guestEnquiry(draft.id);
    expect((await claim(draft.id, client, draft.claimSecret)).statusCode).toBe(200);

    const [enquiry] = await db.select({ userId: schema.enquiries.userId }).from(schema.enquiries)
      .where(eq(schema.enquiries.id, enquiryId));
    expect(enquiry?.userId).toBeNull();
    expect(await enquiryIdsSeenBy(client)).not.toContain(enquiryId);
    expect(await enquiryIdsSeenBy(staff)).toContain(enquiryId);
  });

  it("never lets a plan the venue linked to an event be claimed, even by its creator", async () => {
    const draft = await newDraft();
    const eventId = randomUUID();
    await db.insert(schema.events).values({ id: eventId, venueId, name: "TEST ONLY claim event", createdBy: staff.id });
    await db.insert(schema.eventConfigurationLinks).values({ eventId, configurationId: draft.id, linkType: "source_configuration" });

    const refused = await claim(draft.id, client, draft.claimSecret);
    expect(refused.statusCode).toBe(409);
    expect(refused.code).toBe("CONFIGURATION_IN_VENUE_WORK");
    expect(await row(draft.id)).toMatchObject({ userId: null, isPublicPreview: true });
    expect(await secretKept(draft.id)).toBe(true);
  });

  // The commonest path (auditor's verifiers, 26 Oct): a member of the venue's
  // staff opens a guest's /plan link from an enquiry and signs in. The guest's
  // plan must stay the guest's, and still open for them.
  it("does not let a member of staff who opens a guest's link take the guest's plan", async () => {
    const draft = await newDraft();
    const enquiryId = await guestEnquiry(draft.id);

    expect((await claim(draft.id, staff)).statusCode).toBe(400);
    expect((await claim(draft.id, staff, "s".repeat(43))).statusCode).toBe(403);

    expect(await row(draft.id)).toMatchObject({ userId: null, isPublicPreview: true, visibility: "public" });
    const guestRead = await server.inject({ method: "GET", url: `/public/configurations/${draft.id}` });
    expect(guestRead.statusCode, guestRead.body).toBe(200);
    // The guest, holding the secret, can still make it theirs.
    expect((await claim(draft.id, client, draft.claimSecret)).statusCode).toBe(200);
    const [enquiry] = await db.select({ userId: schema.enquiries.userId }).from(schema.enquiries)
      .where(eq(schema.enquiries.id, enquiryId));
    expect(enquiry?.userId).toBeNull();
  });

  // A working sheet's QR prints the layout id (`c`); anyone who reads the
  // paper has it. A staff layout linked to an event must not be claimable by
  // a client or planner account that read the sheet, nor by its own creator.
  it("does not let a layout id read from a printed sheet's QR be claimed", async () => {
    const draft = await newDraft();
    const eventId = randomUUID();
    await db.insert(schema.events).values({ id: eventId, venueId, name: "TEST ONLY sheet event", createdBy: staff.id });
    await db.insert(schema.eventConfigurationLinks).values({ eventId, configurationId: draft.id, linkType: "source_configuration" });
    const qrLink = new URL(buildSheetPaperCheckUrl("https://venviewer.com", { kind: "working", configId: draft.id }));
    const idOnPaper = qrLink.searchParams.get("c");
    expect(idOnPaper).toBe(draft.id);
    if (idOnPaper === null) throw new Error("The sheet link carries no layout id");

    for (const reader of [planner, client]) {
      expect((await claim(idOnPaper, reader)).statusCode).toBe(400);
      expect((await claim(idOnPaper, reader, "q".repeat(43))).statusCode).toBe(403);
    }
    expect((await claim(idOnPaper, staff, draft.claimSecret)).code).toBe("CONFIGURATION_IN_VENUE_WORK");
    expect(await row(draft.id)).toMatchObject({ userId: null, isPublicPreview: true });
  });

  it("never lets a plan made before claim secrets be claimed", async () => {
    const draft = await newDraft();
    await db.delete(schema.configurationClaimSecrets)
      .where(eq(schema.configurationClaimSecrets.configurationId, draft.id));
    expect((await claim(draft.id, client, draft.claimSecret)).statusCode).toBe(403);
    expect((await row(draft.id))?.userId).toBeNull();
  });

  it("lets venue staff save an unclaimed plan but leaves it ownerless until its creator claims it", async () => {
    const draft = await newDraft();
    const saved = await signedInSave(draft.id, draft.revision, staff);
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await row(draft.id))?.userId).toBeNull();

    expect((await claim(draft.id, staff, draft.claimSecret)).statusCode).toBe(200);
    expect((await row(draft.id))?.userId).toBe(staff.id);
  });

  it("keeps a claimed plan out of the preview sweep, however long it is left", async () => {
    const draft = await newDraft();
    expect((await claim(draft.id, client, draft.claimSecret)).statusCode).toBe(200);
    const longAgo = new Date(Date.now() - 60 * 24 * 3_600_000);
    await db.update(schema.configurations).set({ createdAt: longAgo, updatedAt: longAgo })
      .where(eq(schema.configurations.id, draft.id));

    await cleanupPreviewConfigurations(db);
    expect(await row(draft.id)).toMatchObject({ userId: client.id });
  });

  it("does not let anyone take a plan that is already claimed, even with its spent secret", async () => {
    const draft = await newDraft();
    expect((await claim(draft.id, client, draft.claimSecret)).statusCode).toBe(200);
    const second = await claim(draft.id, staff, draft.claimSecret);
    expect(second.statusCode).toBe(409);
    expect((await row(draft.id))?.userId).toBe(client.id);
  });
});
