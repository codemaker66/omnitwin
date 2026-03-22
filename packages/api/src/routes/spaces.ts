import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { spaces, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canManageVenue } from "../utils/query.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const VenueIdParam = z.object({ venueId: z.string().uuid() });
const SpaceIdParam = z.object({ venueId: z.string().uuid(), id: z.string().uuid() });

const CreateSpaceBody = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/),
  description: z.string().max(2000).default(""),
  widthM: z.number().positive().max(200),
  lengthM: z.number().positive().max(200),
  heightM: z.number().positive().max(50),
  floorPlanOutline: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).min(3),
  meshUrl: z.string().url().nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  sortOrder: z.number().int().nonnegative().default(0),
});

const UpdateSpaceBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  widthM: z.number().positive().max(200).optional(),
  lengthM: z.number().positive().max(200).optional(),
  heightM: z.number().positive().max(50).optional(),
  floorPlanOutline: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).min(3).optional(),
  meshUrl: z.string().url().nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

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

    return { data: space };
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
      widthM: String(parsed.data.widthM),
      lengthM: String(parsed.data.lengthM),
      heightM: String(parsed.data.heightM),
      floorPlanOutline: parsed.data.floorPlanOutline,
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

    const [space] = await db.select().from(spaces)
      .where(and(eq(spaces.id, params.data.id), isNull(spaces.deletedAt)))
      .limit(1);
    if (space === undefined) {
      return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    }

    const parsed = UpdateSpaceBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updateData["name"] = parsed.data.name;
    if (parsed.data.description !== undefined) updateData["description"] = parsed.data.description;
    if (parsed.data.widthM !== undefined) updateData["widthM"] = String(parsed.data.widthM);
    if (parsed.data.lengthM !== undefined) updateData["lengthM"] = String(parsed.data.lengthM);
    if (parsed.data.heightM !== undefined) updateData["heightM"] = String(parsed.data.heightM);
    if (parsed.data.floorPlanOutline !== undefined) updateData["floorPlanOutline"] = parsed.data.floorPlanOutline;
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

    const [space] = await db.select().from(spaces)
      .where(and(eq(spaces.id, params.data.id), isNull(spaces.deletedAt)))
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
