import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { referencePhotos, referenceLoadouts } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canManageVenue } from "../utils/query.js";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const LoadoutIdParam = z.object({ loadoutId: z.string().uuid() });
const PhotoIdParam = z.object({ loadoutId: z.string().uuid(), id: z.string().uuid() });

const AddPhotoBody = z.object({
  fileId: z.string().uuid(),
  caption: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

const UpdatePhotoBody = z.object({
  caption: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

const ReorderBody = z.object({
  photoIds: z.array(z.string().uuid()).min(1),
});

// ---------------------------------------------------------------------------
// Helper: verify loadout access
// ---------------------------------------------------------------------------

async function verifyLoadoutAccess(
  db: Database,
  loadoutId: string,
  userRole: string,
  userVenueId: string | null,
): Promise<{ venueId: string } | { error: string; code: string; status: number }> {
  const [loadout] = await db.select({ venueId: referenceLoadouts.venueId })
    .from(referenceLoadouts)
    .where(and(eq(referenceLoadouts.id, loadoutId), isNull(referenceLoadouts.deletedAt)))
    .limit(1);

  if (loadout === undefined) {
    return { error: "Loadout not found", code: "NOT_FOUND", status: 404 };
  }

  if (!canManageVenue({ id: "", email: "", role: userRole, venueId: userVenueId }, loadout.venueId)) {
    return { error: "Insufficient permissions", code: "FORBIDDEN", status: 403 };
  }

  return { venueId: loadout.venueId };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function referencePhotoRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // POST /loadouts/:loadoutId/photos — add photo to loadout
  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = LoadoutIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    const parsed = AddPhotoBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const access = await verifyLoadoutAccess(db, params.data.loadoutId, request.user.role, request.user.venueId);
    if ("error" in access) {
      return reply.status(access.status).send({ error: access.error, code: access.code });
    }

    // If no sortOrder provided, append to end
    let sortOrder = parsed.data.sortOrder;
    if (sortOrder === undefined) {
      const [maxRow] = await db.select({ max: sql<number>`coalesce(max(sort_order), -1)::int` })
        .from(referencePhotos)
        .where(eq(referencePhotos.loadoutId, params.data.loadoutId));
      sortOrder = (maxRow?.max ?? -1) + 1;
    }

    const [photo] = await db.insert(referencePhotos).values({
      loadoutId: params.data.loadoutId,
      fileId: parsed.data.fileId,
      caption: parsed.data.caption ?? null,
      sortOrder,
    }).returning();

    return reply.status(201).send({ data: photo });
  });

  // PATCH /loadouts/:loadoutId/photos/:id — update caption/sortOrder
  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = PhotoIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    const parsed = UpdatePhotoBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const access = await verifyLoadoutAccess(db, params.data.loadoutId, request.user.role, request.user.venueId);
    if ("error" in access) {
      return reply.status(access.status).send({ error: access.error, code: access.code });
    }

    const [existing] = await db.select().from(referencePhotos)
      .where(and(eq(referencePhotos.id, params.data.id), eq(referencePhotos.loadoutId, params.data.loadoutId)))
      .limit(1);
    if (existing === undefined) {
      return reply.status(404).send({ error: "Photo not found", code: "NOT_FOUND" });
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.caption !== undefined) updateData["caption"] = parsed.data.caption;
    if (parsed.data.sortOrder !== undefined) updateData["sortOrder"] = parsed.data.sortOrder;

    const [updated] = await db.update(referencePhotos)
      .set(updateData)
      .where(eq(referencePhotos.id, params.data.id))
      .returning();

    return { data: updated };
  });

  // DELETE /loadouts/:loadoutId/photos/:id — hard delete link (file stays)
  server.delete("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = PhotoIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    const access = await verifyLoadoutAccess(db, params.data.loadoutId, request.user.role, request.user.venueId);
    if ("error" in access) {
      return reply.status(access.status).send({ error: access.error, code: access.code });
    }

    const [existing] = await db.select({ id: referencePhotos.id }).from(referencePhotos)
      .where(and(eq(referencePhotos.id, params.data.id), eq(referencePhotos.loadoutId, params.data.loadoutId)))
      .limit(1);
    if (existing === undefined) {
      return reply.status(404).send({ error: "Photo not found", code: "NOT_FOUND" });
    }

    await db.delete(referencePhotos).where(eq(referencePhotos.id, params.data.id));

    return reply.status(204).send();
  });

  // POST /loadouts/:loadoutId/photos/reorder — reorder all photos
  server.post("/reorder", { preHandler: [authenticate] }, async (request, reply) => {
    const params = LoadoutIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    const parsed = ReorderBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const access = await verifyLoadoutAccess(db, params.data.loadoutId, request.user.role, request.user.venueId);
    if ("error" in access) {
      return reply.status(access.status).send({ error: access.error, code: access.code });
    }

    // Update each photo's sortOrder atomically to prevent interleaving
    await db.transaction(async (tx) => {
      for (let i = 0; i < parsed.data.photoIds.length; i++) {
        const photoId = parsed.data.photoIds[i];
        if (photoId === undefined) continue;
        await tx.update(referencePhotos)
          .set({ sortOrder: i })
          .where(and(
            eq(referencePhotos.id, photoId),
            eq(referencePhotos.loadoutId, params.data.loadoutId),
          ));
      }
    });

    // Return updated photos
    const photos = await db.select().from(referencePhotos)
      .where(eq(referencePhotos.loadoutId, params.data.loadoutId))
      .orderBy(referencePhotos.sortOrder);

    return { data: photos };
  });
}
