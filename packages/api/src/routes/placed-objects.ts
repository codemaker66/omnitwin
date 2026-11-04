import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, sql } from "drizzle-orm";
import { canJoinLayoutLive } from "@omnitwin/types";
import { placedObjects, configurations, configurationLayoutRevisions } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, type JwtUser } from "../middleware/auth.js";
import {
  configLockedBody,
  editableAtWrite,
  holdEditable,
  lockHolds,
  requireEditableConfig,
} from "../middleware/require-editable-config.js";
import { syncPlacedObjectBatch } from "../lib/placed-object-batch.js";
import { canAccessResource } from "../utils/query.js";
import { emit } from "../observability/event-bus.js";
import {
  validatePlacementsInPolygon,
  loadSpacePolygon,
  placementOutOfBoundsBody,
} from "../lib/placement-validation.js";
import {
  configurationRevisionEtag,
  loadRevisionChange,
  revisionConflictBody,
} from "../lib/configuration-revision.js";
import { lockConflictOf, RETRY_ANSWER } from "../utils/sql-state.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ConfigIdParam = z.object({ configId: z.uuid() });
const ObjectIdParam = z.object({ configId: z.uuid(), id: z.uuid() });

const CreateObjectBody = z.object({
  assetDefinitionId: z.uuid(),
  positionX: z.number(),
  positionY: z.number(),
  positionZ: z.number(),
  rotationX: z.number().default(0),
  rotationY: z.number().default(0),
  rotationZ: z.number().default(0),
  scale: z.number().positive().default(1),
  sortOrder: z.number().int().nonnegative().default(0),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const UpdateObjectBody = z.object({
  positionX: z.number().optional(),
  positionY: z.number().optional(),
  positionZ: z.number().optional(),
  rotationX: z.number().optional(),
  rotationY: z.number().optional(),
  rotationZ: z.number().optional(),
  scale: z.number().positive().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const BatchObjectItem = z.object({
  id: z.uuid().optional(),
  assetDefinitionId: z.uuid(),
  positionX: z.number(),
  positionY: z.number(),
  positionZ: z.number(),
  rotationX: z.number().default(0),
  rotationY: z.number().default(0),
  rotationZ: z.number().default(0),
  scale: z.number().positive().default(1),
  sortOrder: z.number().int().nonnegative().default(0),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const BatchBody = z.object({
  expectedRevision: z.number().int().min(1),
  objects: z.array(BatchObjectItem).max(500),
});

// ---------------------------------------------------------------------------
// Helper: verify config ownership
//
// Runs on every planner save, so it reads only the columns these routes use.
// A whole row would also carry `thumbnail_url`, a PNG data URL of tens to
// hundreds of KB that no object route needs.
// ---------------------------------------------------------------------------

type ConfigAccessRow = Pick<typeof configurations.$inferSelect, "userId" | "venueId" | "spaceId" | "revision">;

async function verifyConfigAccess(
  db: Database,
  configId: string,
  user: JwtUser,
): Promise<{ config: ConfigAccessRow } | { error: string; code: string; status: number }> {
  const [config] = await db.select({
    userId: configurations.userId,
    venueId: configurations.venueId,
    spaceId: configurations.spaceId,
    revision: configurations.revision,
  })
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

/**
 * Who made a newer revision is told only to those who see each other in the
 * layout's live room (the same predicate admits them there); anyone else who
 * may open the layout — a customer who owns it — is named only their own
 * revision. Never a second rule for the same question.
 */
function revisionDisclosure(user: JwtUser, config: ConfigAccessRow): { discloseActor: boolean; callerUserId: string } {
  return {
    discloseActor: canJoinLayoutLive(
      { userId: user.id, role: user.role, venueId: user.venueId, platformRole: user.platformRole },
      { ownerUserId: config.userId, venueId: config.venueId },
    ),
    callerUserId: user.id,
  };
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

    const created = await db.transaction(async (tx) => {
      const lock = await holdEditable(tx, params.data.configId, request.user);
      if (lock.status !== "editable") return lock;
      const [obj] = await tx.insert(placedObjects).values({
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
      return { status: "created" as const, obj };
    });
    if (created.status === "not_found") return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    if (created.status === "locked") return reply.status(409).send(configLockedBody(created.reviewStatus));

    return reply.status(201).send({ data: created.obj });
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

    const written = await db.transaction(async (tx) => {
      const lock = await holdEditable(tx, params.data.configId, request.user);
      if (lock.status !== "editable") return lock;
      const [updated] = await tx.update(placedObjects)
        .set(updateData)
        .where(eq(placedObjects.id, params.data.id))
        .returning();
      return { status: "updated" as const, updated };
    });
    if (written.status === "not_found") return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    if (written.status === "locked") return reply.status(409).send(configLockedBody(written.reviewStatus));

    return { data: written.updated };
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

    const removed = await db.transaction(async (tx) => {
      const lock = await holdEditable(tx, params.data.configId, request.user);
      if (lock.status !== "editable") return lock;
      await tx.delete(placedObjects).where(eq(placedObjects.id, params.data.id));
      return { status: "deleted" as const };
    });
    if (removed.status === "not_found") return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    if (removed.status === "locked") return reply.status(409).send(configLockedBody(removed.reviewStatus));

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
      const change = await loadRevisionChange(db, params.data.configId, result.config.revision,
        { ...revisionDisclosure(request.user, result.config), log: request.log });
      reply.header("ETag", configurationRevisionEtag(result.config.revision));
      return reply.status(409).send(
        revisionConflictBody(parsed.data.expectedRevision, result.config.revision, change),
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
          editableAtWrite(request.user, result.config.venueId),
        ))
        .returning({ revision: configurations.revision });

      if (advanced === undefined) {
        const [current] = await tx.select({ revision: configurations.revision, reviewStatus: configurations.reviewStatus })
          .from(configurations)
          .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
          .limit(1);
        // A review begun since the check holds the layout: that, not a newer
        // version, is why nothing was saved.
        if (current !== undefined && lockHolds(request.user, result.config.venueId, current.reviewStatus)) {
          return { status: "locked" as const, reviewStatus: current.reviewStatus };
        }
        return {
          status: "conflict" as const,
          currentRevision: current?.revision ?? result.config.revision,
        };
      }

      txResults.push(...await syncPlacedObjectBatch(tx, configId, parsed.data.objects));

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
    }).catch((error: unknown) => {
      // A deadlock or serialisation failure rolled the whole save back. A
      // submit locks the layout's row before migration 0058's global lock,
      // which this save takes first, so the two can deadlock.
      const pgCode = lockConflictOf(error);
      if (pgCode === null) throw error;
      request.log.warn({ event: "placed_objects.batch.retry", configId, pgCode }, "layout save met a lock conflict");
      return { status: "retry" as const };
    });

    if (saveResult.status === "retry") return reply.status(409).send(RETRY_ANSWER);
    if (saveResult.status === "locked") {
      return reply.status(409).send(configLockedBody(saveResult.reviewStatus));
    }
    if (saveResult.status === "conflict") {
      const change = await loadRevisionChange(db, configId, saveResult.currentRevision,
        { ...revisionDisclosure(request.user, result.config), log: request.log });
      reply.header("ETag", configurationRevisionEtag(saveResult.currentRevision));
      return reply.status(409).send(
        revisionConflictBody(parsed.data.expectedRevision, saveResult.currentRevision, change),
      );
    }

    // Commit, then announce: the transaction above has resolved, so an
    // uncommitted write can never be broadcast (live co-editing v1).
    emit(request.log, "layout.changed", {
      configId,
      revision: saveResult.revision,
      actorUserId: request.user.id,
      source: "authenticated_batch",
      at: new Date().toISOString(),
    });
    reply.header("ETag", configurationRevisionEtag(saveResult.revision));
    return { data: { objects: saveResult.objects, revision: saveResult.revision } };
  });
}
