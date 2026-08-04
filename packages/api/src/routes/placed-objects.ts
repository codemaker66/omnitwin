import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { placedObjects, configurations, configurationLayoutRevisions } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, type JwtUser } from "../middleware/auth.js";
import { requireEditableConfig } from "../middleware/require-editable-config.js";
import { canAccessResource } from "../utils/query.js";
import {
  validatePlacementsInPolygon,
  loadSpacePolygon,
  placementOutOfBoundsBody,
} from "../lib/placement-validation.js";
import {
  configurationRevisionEtag,
  revisionConflictBody,
} from "../lib/configuration-revision.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ConfigIdParam = z.object({ configId: z.string().uuid() });
const ObjectIdParam = z.object({ configId: z.string().uuid(), id: z.string().uuid() });

const CreateObjectBody = z.object({
  assetDefinitionId: z.string().uuid(),
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  positionZ: z.number().finite(),
  rotationX: z.number().finite().default(0),
  rotationY: z.number().finite().default(0),
  rotationZ: z.number().finite().default(0),
  scale: z.number().positive().default(1),
  sortOrder: z.number().int().nonnegative().default(0),
  metadata: z.record(z.unknown()).nullable().optional(),
});

const UpdateObjectBody = z.object({
  positionX: z.number().finite().optional(),
  positionY: z.number().finite().optional(),
  positionZ: z.number().finite().optional(),
  rotationX: z.number().finite().optional(),
  rotationY: z.number().finite().optional(),
  rotationZ: z.number().finite().optional(),
  scale: z.number().positive().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

const BatchObjectItem = z.object({
  id: z.string().uuid().optional(),
  assetDefinitionId: z.string().uuid(),
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  positionZ: z.number().finite(),
  rotationX: z.number().finite().default(0),
  rotationY: z.number().finite().default(0),
  rotationZ: z.number().finite().default(0),
  scale: z.number().positive().default(1),
  sortOrder: z.number().int().nonnegative().default(0),
  metadata: z.record(z.unknown()).nullable().optional(),
});

const BatchBody = z.object({
  expectedRevision: z.number().int().min(1),
  objects: z.array(BatchObjectItem).max(500),
});

// ---------------------------------------------------------------------------
// Helper: verify config ownership
// ---------------------------------------------------------------------------

async function verifyConfigAccess(
  db: Database,
  configId: string,
  user: JwtUser,
): Promise<{ config: typeof configurations.$inferSelect } | { error: string; code: string; status: number }> {
  const [config] = await db.select()
    .from(configurations)
    .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
    .limit(1);

  if (config === undefined) {
    return { error: "Configuration not found", code: "NOT_FOUND", status: 404 };
  }

  if (!canAccessResource(user, config.userId, config.venueId)) {
    return { error: "Insufficient permissions", code: "FORBIDDEN", status: 403 };
  }

  return { config };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function placedObjectRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // GET /configurations/:configId/objects — authenticated
  server.get("/", { preHandler: [authenticate, requireEditableConfig(db, { paramName: "configId" })] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const result = await verifyConfigAccess(db, params.data.configId, request.user);
    if ("error" in result) {
      return reply.status(result.status).send({ error: result.error, code: result.code });
    }

    const rows = await db.select()
      .from(placedObjects)
      .where(eq(placedObjects.configurationId, params.data.configId))
      .orderBy(placedObjects.sortOrder);

    return { data: rows };
  });

  // POST /configurations/:configId/objects — owner of config
  server.post("/", { preHandler: [authenticate, requireEditableConfig(db, { paramName: "configId" })] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const parsed = CreateObjectBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const result = await verifyConfigAccess(db, params.data.configId, request.user);
    if ("error" in result) {
      return reply.status(result.status).send({ error: result.error, code: result.code });
    }

    // Polygon containment check — reject placements outside the room.
    const outline = await loadSpacePolygon(db, result.config.spaceId);
    if (outline === null) {
      return reply.status(500).send({ error: "Space outline missing for configuration", code: "INTERNAL_ERROR" });
    }
    const invalid = validatePlacementsInPolygon(
      [{ positionX: parsed.data.positionX, positionZ: parsed.data.positionZ }],
      outline,
    );
    if (invalid.length > 0) {
      return reply.status(422).send(placementOutOfBoundsBody(invalid));
    }

    const [obj] = await db.insert(placedObjects).values({
      configurationId: params.data.configId,
      assetDefinitionId: parsed.data.assetDefinitionId,
      positionX: String(parsed.data.positionX),
      positionY: String(parsed.data.positionY),
      positionZ: String(parsed.data.positionZ),
      rotationX: String(parsed.data.rotationX),
      rotationY: String(parsed.data.rotationY),
      rotationZ: String(parsed.data.rotationZ),
      scale: String(parsed.data.scale),
      sortOrder: parsed.data.sortOrder,
      metadata: parsed.data.metadata ?? null,
      coordinateWriteToken: randomUUID(),
    }).returning();

    return reply.status(201).send({ data: obj });
  });

  // PATCH /configurations/:configId/objects/:id — owner of config
  server.patch("/:id", { preHandler: [authenticate, requireEditableConfig(db, { paramName: "configId" })] }, async (request, reply) => {
    const params = ObjectIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    const parsed = UpdateObjectBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const result = await verifyConfigAccess(db, params.data.configId, request.user);
    if ("error" in result) {
      return reply.status(result.status).send({ error: result.error, code: result.code });
    }

    const [existing] = await db.select()
      .from(placedObjects)
      .where(and(eq(placedObjects.id, params.data.id), eq(placedObjects.configurationId, params.data.configId)))
      .limit(1);

    if (existing === undefined) {
      return reply.status(404).send({ error: "Placed object not found", code: "NOT_FOUND" });
    }

    // Validate only when the edit touches positionX or positionZ. Height
    // (positionY), rotation, scale and metadata edits bypass the polygon
    // check — they can't move the object's floor-plan footprint, and
    // re-validating pre-invariant objects would fail rotation-only edits.
    if (parsed.data.positionX !== undefined || parsed.data.positionZ !== undefined) {
      const outline = await loadSpacePolygon(db, result.config.spaceId);
      if (outline === null) {
        return reply.status(500).send({ error: "Space outline missing for configuration", code: "INTERNAL_ERROR" });
      }
      const finalX = parsed.data.positionX ?? Number(existing.positionX);
      const finalZ = parsed.data.positionZ ?? Number(existing.positionZ);
      const invalid = validatePlacementsInPolygon([{ positionX: finalX, positionZ: finalZ }], outline);
      if (invalid.length > 0) {
        return reply.status(422).send(placementOutOfBoundsBody(invalid));
      }
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.positionX !== undefined) updateData["positionX"] = String(parsed.data.positionX);
    if (parsed.data.positionY !== undefined) updateData["positionY"] = String(parsed.data.positionY);
    if (parsed.data.positionZ !== undefined) updateData["positionZ"] = String(parsed.data.positionZ);
    if (parsed.data.positionX !== undefined || parsed.data.positionZ !== undefined) {
      updateData["coordinateWriteToken"] = randomUUID();
    }
    if (parsed.data.rotationX !== undefined) updateData["rotationX"] = String(parsed.data.rotationX);
    if (parsed.data.rotationY !== undefined) updateData["rotationY"] = String(parsed.data.rotationY);
    if (parsed.data.rotationZ !== undefined) updateData["rotationZ"] = String(parsed.data.rotationZ);
    if (parsed.data.scale !== undefined) updateData["scale"] = String(parsed.data.scale);
    if (parsed.data.sortOrder !== undefined) updateData["sortOrder"] = parsed.data.sortOrder;
    if (parsed.data.metadata !== undefined) updateData["metadata"] = parsed.data.metadata;

    const [updated] = await db.update(placedObjects)
      .set(updateData)
      .where(eq(placedObjects.id, params.data.id))
      .returning();

    return { data: updated };
  });

  // DELETE /configurations/:configId/objects/:id — owner, hard delete
  server.delete("/:id", { preHandler: [authenticate, requireEditableConfig(db, { paramName: "configId" })] }, async (request, reply) => {
    const params = ObjectIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    const result = await verifyConfigAccess(db, params.data.configId, request.user);
    if ("error" in result) {
      return reply.status(result.status).send({ error: result.error, code: result.code });
    }

    const [existing] = await db.select({ id: placedObjects.id })
      .from(placedObjects)
      .where(and(eq(placedObjects.id, params.data.id), eq(placedObjects.configurationId, params.data.configId)))
      .limit(1);

    if (existing === undefined) {
      return reply.status(404).send({ error: "Placed object not found", code: "NOT_FOUND" });
    }

    await db.delete(placedObjects).where(eq(placedObjects.id, params.data.id));

    return reply.status(204).send();
  });

  // POST /configurations/:configId/objects/batch — owner, upsert multiple
  server.post("/batch", { preHandler: [authenticate, requireEditableConfig(db, { paramName: "configId" })] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const parsed = BatchBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const result = await verifyConfigAccess(db, params.data.configId, request.user);
    if ("error" in result) {
      return reply.status(result.status).send({ error: result.error, code: result.code });
    }

    if (result.config.revision !== parsed.data.expectedRevision) {
      reply.header("ETag", configurationRevisionEtag(result.config.revision));
      return reply.status(409).send(
        revisionConflictBody(parsed.data.expectedRevision, result.config.revision),
      );
    }

    // Polygon containment check. Batches are atomic — we validate every
    // placement before opening the transaction; any failure fails the whole
    // batch with a 422 that lists every offending row so the client can
    // highlight them all at once.
    if (parsed.data.objects.length > 0) {
      const outline = await loadSpacePolygon(db, result.config.spaceId);
      if (outline === null) {
        return reply.status(500).send({ error: "Space outline missing for configuration", code: "INTERNAL_ERROR" });
      }
      const invalid = validatePlacementsInPolygon(parsed.data.objects, outline);
      if (invalid.length > 0) {
        return reply.status(422).send(placementOutOfBoundsBody(invalid));
      }
    }

    // Full-sync batch: delete stale + update existing + insert new, all atomic.
    const toUpdate = parsed.data.objects.filter((o) => o.id !== undefined);
    const toInsert = parsed.data.objects.filter((o) => o.id === undefined);
    const configId = params.data.configId;

    const saveResult = await db.transaction(async (tx) => {
      const txResults: (typeof placedObjects.$inferSelect)[] = [];

      const [advanced] = await tx.update(configurations)
        .set({
          revision: sql`${configurations.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(configurations.id, configId),
          eq(configurations.revision, parsed.data.expectedRevision),
          isNull(configurations.deletedAt),
        ))
        .returning({ revision: configurations.revision });

      if (advanced === undefined) {
        const [current] = await tx.select({ revision: configurations.revision })
          .from(configurations)
          .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
          .limit(1);
        return {
          status: "conflict" as const,
          currentRevision: current?.revision ?? result.config.revision,
        };
      }

      // Delete objects not in the batch
      const batchIds = toUpdate.map((o) => o.id).filter((id): id is string => id !== undefined);
      if (batchIds.length > 0) {
        const existing = await tx.select({ id: placedObjects.id })
          .from(placedObjects)
          .where(eq(placedObjects.configurationId, configId));

        const toDelete = existing.map((e) => e.id).filter((id) => !batchIds.includes(id));
        if (toDelete.length > 0) {
          await tx.delete(placedObjects).where(inArray(placedObjects.id, toDelete));
        }
      } else {
        await tx.delete(placedObjects).where(eq(placedObjects.configurationId, configId));
      }

      // Update existing
      for (const obj of toUpdate) {
        if (obj.id === undefined) continue;
        const [updated] = await tx.update(placedObjects)
          .set({
            assetDefinitionId: obj.assetDefinitionId,
            positionX: String(obj.positionX),
            positionY: String(obj.positionY),
            positionZ: String(obj.positionZ),
            rotationX: String(obj.rotationX),
            rotationY: String(obj.rotationY),
            rotationZ: String(obj.rotationZ),
            scale: String(obj.scale),
            sortOrder: obj.sortOrder,
            metadata: obj.metadata ?? null,
            coordinateWriteToken: randomUUID(),
          })
          .where(and(eq(placedObjects.id, obj.id), eq(placedObjects.configurationId, configId)))
          .returning();
        if (updated !== undefined) txResults.push(updated);
      }

      // Insert new
      if (toInsert.length > 0) {
        const inserted = await tx.insert(placedObjects)
          .values(toInsert.map((obj) => ({
            configurationId: configId,
            assetDefinitionId: obj.assetDefinitionId,
            positionX: String(obj.positionX),
            positionY: String(obj.positionY),
            positionZ: String(obj.positionZ),
            rotationX: String(obj.rotationX),
            rotationY: String(obj.rotationY),
            rotationZ: String(obj.rotationZ),
            scale: String(obj.scale),
            sortOrder: obj.sortOrder,
            metadata: obj.metadata ?? null,
            coordinateWriteToken: randomUUID(),
          })))
          .returning();
        txResults.push(...inserted);
      }

      await tx.insert(configurationLayoutRevisions).values({
        configurationId: configId,
        revision: advanced.revision,
        source: "authenticated_batch",
        actorUserId: request.user.id,
        payload: {
          objectCount: txResults.length,
          objects: txResults,
        },
      });

      return {
        status: "saved" as const,
        objects: txResults,
        revision: advanced.revision,
      };
    });

    if (saveResult.status === "conflict") {
      reply.header("ETag", configurationRevisionEtag(saveResult.currentRevision));
      return reply.status(409).send(
        revisionConflictBody(parsed.data.expectedRevision, saveResult.currentRevision),
      );
    }

    reply.header("ETag", configurationRevisionEtag(saveResult.revision));
    return { data: { objects: saveResult.objects, revision: saveResult.revision } };
  });
}
