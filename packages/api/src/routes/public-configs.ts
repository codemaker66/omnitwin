import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { buildLayoutPathKey } from "@omnitwin/types";
import { configurations, layoutAliases, placedObjects, spaces, assetDefinitions } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { generateUniqueShortCode } from "../services/shortcode.js";
import {
  validatePlacementsInPolygon,
  loadSpacePolygon,
  placementOutOfBoundsBody,
} from "../lib/placement-validation.js";

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

// Punch list #24: accepts a data URL (PNG) as the thumbnail for a public
// preview config. The .max() checks data URL string length (not decoded
// payload bytes). Base64 inflates by ~33%, so 270KB string ≈ 200KB decoded PNG.
// 800×533 captures are typically 30-50 KB. The long-term answer is R2
// upload with a presigned URL; this is the pragmatic single-tenant path.
const MAX_THUMBNAIL_STRING_LEN = 270_000;
const ThumbnailBody = z.object({
  thumbnailUrl: z.string()
    .startsWith("data:image/png;base64,", "Must be a PNG data URL")
    .max(MAX_THUMBNAIL_STRING_LEN, "Thumbnail data URL too large (max ~200KB decoded PNG)"),
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

    // Generate a guest-URL shortcode up-front so the insert below can
    // persist it atomically with the config row. Uniqueness is verified
    // against the live `configurations.short_code` index via the
    // existence probe.
    const shortCode = await generateUniqueShortCode(async (candidate) => {
      const [hit] = await db
        .select({ id: configurations.id })
        .from(configurations)
        .where(and(eq(configurations.shortCode, candidate), isNull(configurations.deletedAt)))
        .limit(1);
      return hit !== undefined;
    });

    const [config] = await db.insert(configurations).values({
      spaceId: parsed.data.spaceId,
      venueId: space.venueId,
      userId: null,
      name: parsed.data.name,
      layoutStyle: "custom",
      isPublicPreview: true,
      visibility: "public",
      shortCode,
    }).returning();

    if (config === undefined) {
      return reply.status(500).send({ error: "Insert returned no row", code: "INSERT_FAILED" });
    }

    // Seed layout_aliases so the resolver's fast path (Tier 1) hits
    // immediately — both the UUID form and the canonical shortcode URL
    // point at this row, neither retired. Alias insert errors are
    // swallowed: the resolver's Tier 2 direct-column fallback still
    // serves the URL correctly, so a transient alias-write failure
    // doesn't block config creation.
    try {
      await db.insert(layoutAliases).values([
        {
          configurationId: config.id,
          kind: "uuid",
          pathKey: buildLayoutPathKey("uuid", { uuid: config.id }),
          retiredAt: null,
        },
        {
          configurationId: config.id,
          kind: "shortcode",
          pathKey: buildLayoutPathKey("shortcode", { shortCode }),
          retiredAt: null,
        },
      ]);
    } catch (err) {
      // Operational signal — resolver's Tier 2 fallback still serves the URL.
      console.warn("public-configs: layout_aliases seed failed (resolver Tier 2 still covers):", err);
    }

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

    // Verify all referenced assetDefinitionIds exist before touching the DB.
    // Without this check, malformed batches can insert placed_objects rows with
    // broken FK references (the DB constraint will reject them, but a clear 422
    // is more informative than a generic 500 from a FK violation).
    const uniqueAssetIds = [...new Set(parsed.data.objects.map((o) => o.assetDefinitionId))];
    if (uniqueAssetIds.length > 0) {
      const found = await db.select({ id: assetDefinitions.id })
        .from(assetDefinitions)
        .where(inArray(assetDefinitions.id, uniqueAssetIds));
      if (found.length !== uniqueAssetIds.length) {
        const foundIds = new Set(found.map((a) => a.id));
        const missingIds = uniqueAssetIds.filter((id) => !foundIds.has(id));
        return reply.status(422).send({
          error: "Unknown asset definition IDs",
          code: "ASSET_NOT_FOUND",
          details: { missingIds },
        });
      }
    }

    // Polygon containment check — every placement must lie inside the
    // space's floor-plan outline. Guest submissions get the same gate as
    // authenticated batches; we don't want anonymous users inserting
    // objects outside the room either (they'd just show up as visual
    // glitches in the hallkeeper sheet later).
    if (parsed.data.objects.length > 0) {
      const outline = await loadSpacePolygon(db, config.spaceId);
      if (outline === null) {
        return reply.status(500).send({ error: "Space outline missing for configuration", code: "INTERNAL_ERROR" });
      }
      const invalid = validatePlacementsInPolygon(parsed.data.objects, outline);
      if (invalid.length > 0) {
        return reply.status(422).send(placementOutOfBoundsBody(invalid));
      }
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

  // POST /public/configurations/:configId/thumbnail — set floor plan diagram
  //
  // Uses POST (not PATCH) because the public API client's `api.post()`
  // supports `skipAuth` while `api.patch()` does not. Consistent with
  // the other public config endpoints which are all POST.
  //
  // Punch list #24: the hallkeeper sheet PDF needs a floor plan image in
  // `configurations.thumbnailUrl`. The ortho capture happens in the browser
  // (Three.js scene → PNG data URL). This endpoint stores the data URL in
  // the thumbnailUrl column. Only works for unclaimed public preview configs
  // — claimed configs use the authenticated PATCH /configurations/:id.
  //
  // Security: no auth required (consistent with other public config endpoints).
  // Scoped to isPublicPreview=true. Body is validated as a PNG data URL with
  // a 200 KB size cap. Rate-limited to 20/hour to prevent abuse.
  server.post("/configurations/:configId/thumbnail", {
    config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const parsed = ThumbnailBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Only allow thumbnail updates on unclaimed public preview configs
    const [config] = await db.select({ id: configurations.id })
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

    const [updated] = await db.update(configurations)
      .set({ thumbnailUrl: parsed.data.thumbnailUrl, updatedAt: new Date() })
      .where(eq(configurations.id, params.data.configId))
      .returning();

    return { data: updated };
  });

  // GET /public/configurations/:configId — get a PUBLIC PREVIEW config with objects
  //
  // SECURITY: this endpoint is anonymous (no auth header required) so it
  // MUST only return public-preview configurations. Once a config is
  // claimed (`isPublicPreview = false`), it becomes private and is
  // accessible only via the authenticated `GET /configurations/:id`
  // endpoint, which enforces ownership/venue access via canAccessResource.
  //
  // Punch list #2 / #33: the previous version had no filter, so any
  // leaked or guessed UUID could expose a private claimed layout — and
  // the frontend was loading every config (claimed or not) through this
  // endpoint, which made the bug invisible until diligence.
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
      return reply.status(404).send({ error: "Public preview configuration not found", code: "NOT_FOUND" });
    }

    const objects = await db.select()
      .from(placedObjects)
      .where(eq(placedObjects.configurationId, params.data.configId))
      .orderBy(placedObjects.sortOrder);

    return { data: { ...config, objects } };
  });
}
