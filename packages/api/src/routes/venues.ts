import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { UpdateVenueOperatingSettingsSchema } from "@omnitwin/types";
import { venues, spaces } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, authorizePlatformAdmin, isPlatformAdmin } from "../middleware/auth.js";
import { PaginationQuerySchema, paginate } from "../utils/pagination.js";
import { canAdministerVenue, canManageVenue } from "../utils/query.js";
import { readOperatingSettings, writeOperatingSettings } from "../services/venue-operating-settings.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateVenueBody = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/),
  address: z.string().trim().min(1).max(500),
  logoUrl: z.url().nullable().optional(),
  brandColour: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

const UpdateVenueBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  address: z.string().trim().min(1).max(500).optional(),
  logoUrl: z.url().nullable().optional(),
  brandColour: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

const IdParam = z.object({ id: z.uuid() });

// ---------------------------------------------------------------------------
// Public projections
//
// GET /venues and GET /venues/:id answer anyone, signed in or not, and so do
// GET /venues/:venueId/spaces and GET /venues/:venueId/spaces/:id (routes/
// spaces.ts, which reuses PUBLIC_SPACE_COLUMNS). They name the columns a
// member of the public may see instead of selecting the whole row, so a column
// added to `venues` or `spaces` later stays private until someone adds it here
// on purpose. Never list subscriptionStatus, planTier, deletedAt or anything
// else about billing, plans or deletion.
//
// What each column is for (the fields the web client and tools read):
//   venues: id, name, slug, address, logoUrl, brandColour (the venue picker,
//   dashboard and planner), timezone (hallkeeper clocks), latitude and
//   longitude (venue:verify-site checks the stored location against the
//   agreed site; the venue's address is already public).
//   spaces: id, venueId, name, slug, widthM, lengthM, heightM and
//   floorPlanOutline (the room list, planner and editor, on the venue route's
//   nested spaces and on both space routes).
// ---------------------------------------------------------------------------

export const PUBLIC_VENUE_COLUMNS = {
  id: venues.id,
  name: venues.name,
  slug: venues.slug,
  address: venues.address,
  logoUrl: venues.logoUrl,
  brandColour: venues.brandColour,
  timezone: venues.timezone,
  latitude: venues.latitude,
  longitude: venues.longitude,
} as const;

export const PUBLIC_SPACE_COLUMNS = {
  id: spaces.id,
  venueId: spaces.venueId,
  name: spaces.name,
  slug: spaces.slug,
  widthM: spaces.widthM,
  lengthM: spaces.lengthM,
  heightM: spaces.heightM,
  floorPlanOutline: spaces.floorPlanOutline,
} as const;

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function venueRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // GET /venues — public, paginated
  server.get("/", async (request, reply) => {
    const pq = PaginationQuerySchema.safeParse(request.query);
    if (!pq.success) {
      return reply.status(400).send({ error: "Invalid pagination", code: "VALIDATION_ERROR", details: pq.error.issues });
    }

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(venues)
      .where(isNull(venues.deletedAt));

    const total = countResult?.count ?? 0;

    const rows = await db.select(PUBLIC_VENUE_COLUMNS)
      .from(venues)
      .where(isNull(venues.deletedAt))
      .limit(pq.data.limit)
      .offset(pq.data.offset)
      .orderBy(venues.createdAt);

    return paginate(rows, total, pq.data);
  });

  // GET /venues/:id — public, with spaces
  server.get("/:id", async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    // A deleted venue is filtered in the query so its row never leaves the
    // database, and the public projection has no deletedAt to inspect.
    const [venue] = await db.select(PUBLIC_VENUE_COLUMNS)
      .from(venues)
      .where(and(eq(venues.id, params.data.id), isNull(venues.deletedAt)))
      .limit(1);

    if (venue === undefined) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }

    const venueSpaces = await db.select(PUBLIC_SPACE_COLUMNS)
      .from(spaces)
      .where(and(eq(spaces.venueId, venue.id), isNull(spaces.deletedAt)));

    return { data: { ...venue, spaces: venueSpaces } };
  });

  // POST /venues — Venviewer platform admin only
  server.post("/", { preHandler: [authenticate, authorizePlatformAdmin()] }, async (request, reply) => {
    const parsed = CreateVenueBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const existing = await db.select({ id: venues.id }).from(venues).where(and(eq(venues.slug, parsed.data.slug), isNull(venues.deletedAt))).limit(1);
    if (existing.length > 0) {
      return reply.status(409).send({ error: "Slug already exists", code: "SLUG_EXISTS" });
    }

    const [venue] = await db.insert(venues).values({
      name: parsed.data.name,
      slug: parsed.data.slug,
      address: parsed.data.address,
      logoUrl: parsed.data.logoUrl ?? null,
      brandColour: parsed.data.brandColour ?? null,
    }).returning();

    return reply.status(201).send({ data: venue });
  });

  // PATCH /venues/:id — admin or hallkeeper of that venue
  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }
    const parsed = UpdateVenueBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [venue] = await db.select().from(venues).where(eq(venues.id, params.data.id)).limit(1);
    if (venue === undefined || venue.deletedAt !== null) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }

    if (!canAdministerVenue(request.user, venue.id)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const [updated] = await db.update(venues)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(venues.id, params.data.id))
      .returning();

    return { data: updated };
  });

  // GET /venues/:id/operating-settings — anyone who works the venue (goal 19 S7).
  // Null when the venue has never set them: no windows, nothing escalates.
  server.get("/:id/operating-settings", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }
    if (!canManageVenue(request.user, params.data.id)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    return { data: await readOperatingSettings(db, params.data.id) };
  });

  // PATCH /venues/:id/operating-settings — the venue's administrator, or a
  // Venviewer operator. Any subset of the fields; the first write fills the
  // rest with the decided defaults.
  server.patch("/:id/operating-settings", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }
    const parsed = UpdateVenueOperatingSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    const actor = request.user;
    if (!canAdministerVenue(actor, params.data.id) || (actor.role !== "admin" && !isPlatformAdmin(actor))) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const [venue] = await db.select({ id: venues.id, deletedAt: venues.deletedAt }).from(venues).where(eq(venues.id, params.data.id)).limit(1);
    if (venue === undefined || venue.deletedAt !== null) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }
    const result = await writeOperatingSettings(db, params.data.id, parsed.data);
    if (!result.ok) {
      return reply.status(404).send({ error: "That person is not an administrator or manager of this venue", code: result.code });
    }
    return { data: result.settings };
  });

  // DELETE /venues/:id — Venviewer platform admin only, soft delete
  server.delete("/:id", { preHandler: [authenticate, authorizePlatformAdmin()] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const [venue] = await db.select().from(venues).where(eq(venues.id, params.data.id)).limit(1);
    if (venue === undefined || venue.deletedAt !== null) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }

    await db.update(venues)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(venues.id, params.data.id));

    return reply.status(204).send();
  });
}
