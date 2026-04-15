import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, sql } from "drizzle-orm";
import { referenceLoadouts, referencePhotos, files, spaces, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canManageVenue } from "../utils/query.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const SpaceParams = z.object({ venueId: z.string().uuid(), spaceId: z.string().uuid() });
const LoadoutParams = z.object({ venueId: z.string().uuid(), spaceId: z.string().uuid(), id: z.string().uuid() });

const CreateLoadoutBody = z.object({
  name: z.string().trim().min(1).max(500),
  description: z.string().max(2000).nullable().optional(),
});

const UpdateLoadoutBody = z.object({
  name: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(2000).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Plugin — loadout CRUD
// ---------------------------------------------------------------------------

export async function referenceLoadoutRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // GET / — public, list loadouts for a space with photo count + cover
  server.get("/", async (request, reply) => {
    const params = SpaceParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    // Verify venue and space are active — prevents leaking child data for soft-deleted parents
    const [venue] = await db.select({ id: venues.id }).from(venues)
      .where(and(eq(venues.id, params.data.venueId), isNull(venues.deletedAt)))
      .limit(1);
    if (venue === undefined) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }
    const [space] = await db.select({ id: spaces.id }).from(spaces)
      .where(and(eq(spaces.id, params.data.spaceId), eq(spaces.venueId, params.data.venueId), isNull(spaces.deletedAt)))
      .limit(1);
    if (space === undefined) {
      return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    }

    const rows = await db.select({
      id: referenceLoadouts.id,
      name: referenceLoadouts.name,
      description: referenceLoadouts.description,
      createdAt: referenceLoadouts.createdAt,
      photoCount: sql<number>`(SELECT count(*)::int FROM reference_photos WHERE loadout_id = ${referenceLoadouts.id})`,
      coverFileKey: sql<string | null>`(SELECT f.file_key FROM reference_photos rp JOIN files f ON f.id = rp.file_id WHERE rp.loadout_id = ${referenceLoadouts.id} ORDER BY rp.sort_order LIMIT 1)`,
    })
      .from(referenceLoadouts)
      .where(and(
        eq(referenceLoadouts.spaceId, params.data.spaceId),
        eq(referenceLoadouts.venueId, params.data.venueId),
        isNull(referenceLoadouts.deletedAt),
      ))
      .orderBy(referenceLoadouts.createdAt);

    return { data: rows };
  });

  // GET /:id — public, single loadout with all photos
  server.get("/:id", async (request, reply) => {
    const params = LoadoutParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    // Verify venue and space are active
    const [venue] = await db.select({ id: venues.id }).from(venues)
      .where(and(eq(venues.id, params.data.venueId), isNull(venues.deletedAt)))
      .limit(1);
    if (venue === undefined) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }
    const [space] = await db.select({ id: spaces.id }).from(spaces)
      .where(and(eq(spaces.id, params.data.spaceId), eq(spaces.venueId, params.data.venueId), isNull(spaces.deletedAt)))
      .limit(1);
    if (space === undefined) {
      return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    }

    const [loadout] = await db.select()
      .from(referenceLoadouts)
      .where(and(
        eq(referenceLoadouts.id, params.data.id),
        eq(referenceLoadouts.venueId, params.data.venueId),
        eq(referenceLoadouts.spaceId, params.data.spaceId),
        isNull(referenceLoadouts.deletedAt),
      ))
      .limit(1);

    if (loadout === undefined) {
      return reply.status(404).send({ error: "Loadout not found", code: "NOT_FOUND" });
    }

    const photos = await db.select({
      id: referencePhotos.id,
      fileId: referencePhotos.fileId,
      caption: referencePhotos.caption,
      sortOrder: referencePhotos.sortOrder,
      fileKey: files.fileKey,
      filename: files.filename,
      contentType: files.contentType,
    })
      .from(referencePhotos)
      .innerJoin(files, eq(referencePhotos.fileId, files.id))
      .where(eq(referencePhotos.loadoutId, params.data.id))
      .orderBy(referencePhotos.sortOrder);

    return { data: { ...loadout, photos } };
  });

  // POST / — hallkeeper or admin
  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = SpaceParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    if (!canManageVenue(request.user, params.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const parsed = CreateLoadoutBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Verify space belongs to the URL venue (prevents cross-venue mismatches)
    const [space] = await db.select({ id: spaces.id }).from(spaces)
      .where(and(eq(spaces.id, params.data.spaceId), eq(spaces.venueId, params.data.venueId), isNull(spaces.deletedAt)))
      .limit(1);
    if (space === undefined) {
      return reply.status(404).send({ error: "Space not found in this venue", code: "NOT_FOUND" });
    }

    const [loadout] = await db.insert(referenceLoadouts).values({
      spaceId: params.data.spaceId,
      venueId: params.data.venueId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      createdBy: request.user.id,
    }).returning();

    return reply.status(201).send({ data: loadout });
  });

  // PATCH /:id — hallkeeper or admin
  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = LoadoutParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    if (!canManageVenue(request.user, params.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const parsed = UpdateLoadoutBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Verify loadout belongs to the URL venue and space (prevents cross-venue mutation)
    const [existing] = await db.select().from(referenceLoadouts)
      .where(and(
        eq(referenceLoadouts.id, params.data.id),
        eq(referenceLoadouts.venueId, params.data.venueId),
        eq(referenceLoadouts.spaceId, params.data.spaceId),
        isNull(referenceLoadouts.deletedAt),
      ))
      .limit(1);
    if (existing === undefined) {
      return reply.status(404).send({ error: "Loadout not found", code: "NOT_FOUND" });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updateData["name"] = parsed.data.name;
    if (parsed.data.description !== undefined) updateData["description"] = parsed.data.description;

    const [updated] = await db.update(referenceLoadouts)
      .set(updateData)
      .where(eq(referenceLoadouts.id, params.data.id))
      .returning();

    return { data: updated };
  });

  // DELETE /:id — hallkeeper or admin, soft delete
  server.delete("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = LoadoutParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    if (!canManageVenue(request.user, params.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    // Verify loadout belongs to the URL venue and space
    const [existing] = await db.select().from(referenceLoadouts)
      .where(and(
        eq(referenceLoadouts.id, params.data.id),
        eq(referenceLoadouts.venueId, params.data.venueId),
        eq(referenceLoadouts.spaceId, params.data.spaceId),
        isNull(referenceLoadouts.deletedAt),
      ))
      .limit(1);
    if (existing === undefined) {
      return reply.status(404).send({ error: "Loadout not found", code: "NOT_FOUND" });
    }

    await db.update(referenceLoadouts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(referenceLoadouts.id, params.data.id));

    return reply.status(204).send();
  });
}
