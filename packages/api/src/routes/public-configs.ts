import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { configurations, placedObjects, spaces } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ConfigIdParam = z.object({ configId: z.string().uuid() });

const CreatePublicConfigBody = z.object({
  spaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).default("Untitled Layout"),
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
  objects: z.array(BatchObjectItem).max(500),
});

// ---------------------------------------------------------------------------
// Plugin — public (no auth) configuration endpoints
// ---------------------------------------------------------------------------

export async function publicConfigRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // POST /public/configurations — create anonymous preview config
  server.post("/configurations", {
    config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const parsed = CreatePublicConfigBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Verify space exists and get venueId
    const [space] = await db.select({ id: spaces.id, venueId: spaces.venueId })
      .from(spaces)
      .where(and(eq(spaces.id, parsed.data.spaceId), isNull(spaces.deletedAt)))
      .limit(1);

    if (space === undefined) {
      return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    }

    const [config] = await db.insert(configurations).values({
      spaceId: parsed.data.spaceId,
      venueId: space.venueId,
      userId: null,
      name: parsed.data.name,
      layoutStyle: "custom",
      isPublicPreview: true,
      visibility: "public",
    }).returning();

    return reply.status(201).send({ data: config });
  });

  // POST /public/configurations/:configId/objects/batch — save objects to preview config
  server.post("/configurations/:configId/objects/batch", {
    config: { rateLimit: { max: 60, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const parsed = BatchBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Only allow saving to public preview configs
    const [config] = await db.select()
      .from(configurations)
      .where(and(
        eq(configurations.id, params.data.configId),
        eq(configurations.isPublicPreview, true),
        isNull(configurations.deletedAt),
      ))
      .limit(1);

    if (config === undefined) {
      return reply.status(404).send({ error: "Public preview configuration not found", code: "NOT_FOUND" });
    }

    const toUpdate = parsed.data.objects.filter((o) => o.id !== undefined);
    const toInsert = parsed.data.objects.filter((o) => o.id === undefined);
    const configId = params.data.configId;

    // Atomic batch: delete stale + update + insert in one transaction
    const results = await db.transaction(async (tx) => {
      const txResults: (typeof placedObjects.$inferSelect)[] = [];

      const batchIds = toUpdate.map((o) => o.id).filter((id): id is string => id !== undefined);
      if (batchIds.length > 0) {
        const existing = await tx.select({ id: placedObjects.id })
          .from(placedObjects).where(eq(placedObjects.configurationId, configId));
        const toDelete = existing.map((e) => e.id).filter((id) => !batchIds.includes(id));
        if (toDelete.length > 0) {
          await tx.delete(placedObjects).where(inArray(placedObjects.id, toDelete));
        }
      } else {
        await tx.delete(placedObjects).where(eq(placedObjects.configurationId, configId));
      }

      for (const obj of toUpdate) {
        if (obj.id === undefined) continue;
        const [updated] = await tx.update(placedObjects)
          .set({
            assetDefinitionId: obj.assetDefinitionId,
            positionX: String(obj.positionX), positionY: String(obj.positionY), positionZ: String(obj.positionZ),
            rotationX: String(obj.rotationX), rotationY: String(obj.rotationY), rotationZ: String(obj.rotationZ),
            scale: String(obj.scale), sortOrder: obj.sortOrder, metadata: obj.metadata ?? null,
          })
          .where(and(eq(placedObjects.id, obj.id), eq(placedObjects.configurationId, configId)))
          .returning();
        if (updated !== undefined) txResults.push(updated);
      }

      if (toInsert.length > 0) {
        const inserted = await tx.insert(placedObjects)
          .values(toInsert.map((obj) => ({
            configurationId: configId,
            assetDefinitionId: obj.assetDefinitionId,
            positionX: String(obj.positionX), positionY: String(obj.positionY), positionZ: String(obj.positionZ),
            rotationX: String(obj.rotationX), rotationY: String(obj.rotationY), rotationZ: String(obj.rotationZ),
            scale: String(obj.scale), sortOrder: obj.sortOrder, metadata: obj.metadata ?? null,
          })))
          .returning();
        txResults.push(...inserted);
      }

      return txResults;
    });

    return { data: results };
  });

  // GET /public/configurations/:configId — get preview config with objects
  server.get("/configurations/:configId", async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const [config] = await db.select()
      .from(configurations)
      .where(and(
        eq(configurations.id, params.data.configId),
        eq(configurations.isPublicPreview, true),
        isNull(configurations.deletedAt),
      ))
      .limit(1);

    if (config === undefined) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    const objects = await db.select()
      .from(placedObjects)
      .where(eq(placedObjects.configurationId, params.data.configId))
      .orderBy(placedObjects.sortOrder);

    return { data: { ...config, objects } };
  });
}
