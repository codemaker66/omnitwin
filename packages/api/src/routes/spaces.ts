import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, sql } from "drizzle-orm";
import { type FloorPlanPoint, polygonBoundingBox } from "@omnitwin/types";
import { spaces, venues, referenceLoadouts } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canManageVenue } from "../utils/query.js";

// ---------------------------------------------------------------------------
// Zod schemas
//
// The polygon `floorPlanOutline` is the sole authoritative shape of a space
// on the request side. DB columns `widthM` / `lengthM` are denormalised
// bounding-box values, recomputed from the polygon on every write. Clients
// do not supply width/length — they come back on the response only (derived
// for readers that want the bbox without iterating the polygon).
//
// POST requires `floorPlanOutline`. PATCH allows omitting it (no shape
// change) or supplying a new one; `widthM` / `lengthM` are not accepted.
// ---------------------------------------------------------------------------

const VenueIdParam = z.object({ venueId: z.string().uuid() });
const SpaceIdParam = z.object({ venueId: z.string().uuid(), id: z.string().uuid() });

const FloorPlanOutlineBody = z
  .array(z.object({ x: z.number().finite(), y: z.number().finite() }))
  .min(3);

const CreateSpaceBody = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/),
  description: z.string().max(2000).default(""),
  heightM: z.number().positive().max(50),
  floorPlanOutline: FloorPlanOutlineBody,
  meshUrl: z.string().url().nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  sortOrder: z.number().int().nonnegative().default(0),
});

const UpdateSpaceBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  heightM: z.number().positive().max(50).optional(),
  floorPlanOutline: FloorPlanOutlineBody.optional(),
  meshUrl: z.string().url().nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

// ---------------------------------------------------------------------------
// Shape resolution — returns the canonical { outline, widthM, lengthM } for
// a request. `null` shape means "no dimension change" (only valid on PATCH).
// ---------------------------------------------------------------------------

interface ResolvedShape {
  readonly outline: readonly FloorPlanPoint[];
  readonly widthM: number;
  readonly lengthM: number;
}

function resolveShape(
  body: { readonly floorPlanOutline?: readonly FloorPlanPoint[] },
): { readonly shape: ResolvedShape | null } {
  if (body.floorPlanOutline === undefined) {
    return { shape: null };
  }
  const outline = body.floorPlanOutline;
  const bbox = polygonBoundingBox(outline);
  return {
    shape: { outline, widthM: bbox.widthM, lengthM: bbox.lengthM },
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function spaceRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // GET /venues/:venueId/spaces — public
  server.get("/", async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    }

    // Verify venue is active — prevents leaking child data for soft-deleted venues
    const [venue] = await db.select({ id: venues.id }).from(venues)
      .where(and(eq(venues.id, params.data.venueId), isNull(venues.deletedAt)))
      .limit(1);
    if (venue === undefined) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }

    const rows = await db.select()
      .from(spaces)
      .where(and(eq(spaces.venueId, params.data.venueId), isNull(spaces.deletedAt)))
      .orderBy(spaces.sortOrder);

    return { data: rows };
  });

  // GET /venues/:venueId/spaces/:id — public
  server.get("/:id", async (request, reply) => {
    const params = SpaceIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    // Verify venue is active
    const [venue] = await db.select({ id: venues.id }).from(venues)
      .where(and(eq(venues.id, params.data.venueId), isNull(venues.deletedAt)))
      .limit(1);
    if (venue === undefined) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }

    const [space] = await db.select()
      .from(spaces)
      .where(and(
        eq(spaces.id, params.data.id),
        eq(spaces.venueId, params.data.venueId),
        isNull(spaces.deletedAt),
      ))
      .limit(1);

    if (space === undefined) {
      return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    }

    // Count active reference loadouts for this space
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(referenceLoadouts)
      .where(and(eq(referenceLoadouts.spaceId, space.id), isNull(referenceLoadouts.deletedAt)));

    const loadoutCount = countResult?.count ?? 0;

    return { data: { ...space, loadoutCount } };
  });

  // POST /venues/:venueId/spaces — admin or hallkeeper of that venue
  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    }

    if (!canManageVenue(request.user, params.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const parsed = CreateSpaceBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // The polygon is required on create (enforced by CreateSpaceBody).
    // Derive width/length from the bbox — that's what the DB stores.
    const { shape } = resolveShape(parsed.data);
    // `CreateSpaceBody.floorPlanOutline` is non-optional, so shape is
    // always defined here; the narrowing keeps the compiler honest.
    if (shape === null) {
      return reply.status(400).send({
        error: "floorPlanOutline is required.",
        code: "VALIDATION_ERROR",
      });
    }

    // Verify venue exists
    const [venue] = await db.select({ id: venues.id }).from(venues)
      .where(and(eq(venues.id, params.data.venueId), isNull(venues.deletedAt)))
      .limit(1);
    if (venue === undefined) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }

    const [space] = await db.insert(spaces).values({
      venueId: params.data.venueId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description,
      widthM: String(shape.widthM),
      lengthM: String(shape.lengthM),
      heightM: String(parsed.data.heightM),
      floorPlanOutline: shape.outline,
      meshUrl: parsed.data.meshUrl ?? null,
      thumbnailUrl: parsed.data.thumbnailUrl ?? null,
      sortOrder: parsed.data.sortOrder,
    }).returning();

    return reply.status(201).send({ data: space });
  });

  // PATCH /venues/:venueId/spaces/:id — admin or hallkeeper of that venue
  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = SpaceIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    if (!canManageVenue(request.user, params.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    // Validate the request body and resolve the shape BEFORE the DB lookup.
    // A malformed payload is a 400 regardless of whether the target row
    // exists, so we don't waste a query on it.
    const parsed = UpdateSpaceBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // PATCH may omit the polygon (no shape change) or supply a new one.
    const { shape } = resolveShape(parsed.data);

    // Verify space exists AND belongs to the URL venue (prevents cross-venue updates)
    const [space] = await db.select().from(spaces)
      .where(and(eq(spaces.id, params.data.id), eq(spaces.venueId, params.data.venueId), isNull(spaces.deletedAt)))
      .limit(1);
    if (space === undefined) {
      return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updateData["name"] = parsed.data.name;
    if (parsed.data.description !== undefined) updateData["description"] = parsed.data.description;
    if (parsed.data.heightM !== undefined) updateData["heightM"] = String(parsed.data.heightM);
    if (shape !== null) {
      updateData["floorPlanOutline"] = shape.outline;
      updateData["widthM"] = String(shape.widthM);
      updateData["lengthM"] = String(shape.lengthM);
    }
    if (parsed.data.meshUrl !== undefined) updateData["meshUrl"] = parsed.data.meshUrl;
    if (parsed.data.thumbnailUrl !== undefined) updateData["thumbnailUrl"] = parsed.data.thumbnailUrl;
    if (parsed.data.sortOrder !== undefined) updateData["sortOrder"] = parsed.data.sortOrder;

    const [updated] = await db.update(spaces)
      .set(updateData)
      .where(eq(spaces.id, params.data.id))
      .returning();

    return { data: updated };
  });

  // DELETE /venues/:venueId/spaces/:id — admin or hallkeeper, soft delete
  server.delete("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = SpaceIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    if (!canManageVenue(request.user, params.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    // Verify space belongs to the URL venue
    const [space] = await db.select().from(spaces)
      .where(and(eq(spaces.id, params.data.id), eq(spaces.venueId, params.data.venueId), isNull(spaces.deletedAt)))
      .limit(1);
    if (space === undefined) {
      return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    }

    await db.update(spaces)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(spaces.id, params.data.id));

    return reply.status(204).send();
  });
}
