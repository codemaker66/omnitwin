import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { buildLayoutPathKey, ConfigurationReviewStatusSchema, isPlannerEditable } from "@omnitwin/types";
import {
  configurations,
  configurationClaimSecrets,
  configurationLayoutRevisions,
  layoutAliases,
  placedObjects,
  spaces,
  assetDefinitions,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { syncPlacedObjectBatch } from "../lib/placed-object-batch.js";
import { emit } from "../observability/event-bus.js";
import { generateUniqueShortCode } from "../services/shortcode.js";
import { generateClaimSecret, hashClaimSecret } from "../services/configuration-claim-secrets.js";
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
import {
  generateVisitorPlanPdf,
  loadVisitorPlan,
  visitorPlanFilename,
} from "../services/visitor-plan-pdf.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ConfigIdParam = z.object({ configId: z.uuid() });

const CreatePublicConfigBody = z.object({
  spaceId: z.uuid(),
  name: z.string().trim().min(1).max(200).default("Untitled Layout"),
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

/** A guest plan the venue has taken into review holds still for its snapshot
 *  until it is sent back, as a signed-in planner's does; a status this code
 *  does not know holds it too. */
function lockedFor(reviewStatus: string): { error: string; code: "CONFIG_LOCKED"; reviewStatus: string } | null {
  const status = ConfigurationReviewStatusSchema.safeParse(reviewStatus);
  if (status.success && isPlannerEditable(status.data)) return null;
  return { error: "This plan is with the venue for review, so it cannot be changed now.", code: "CONFIG_LOCKED", reviewStatus };
}

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

    // The plan and its claim secret are written together: the secret goes to
    // this browser alone, and is what lets it claim the plan into an account
    // later (migration 0102). Only its hash is stored.
    const claimSecret = generateClaimSecret();
    const config = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(configurations).values({
        spaceId: parsed.data.spaceId,
        venueId: space.venueId,
        userId: null,
        name: parsed.data.name,
        layoutStyle: "custom",
        isPublicPreview: true,
        visibility: "public",
        shortCode,
      }).returning();
      if (inserted === undefined) return undefined;
      await tx.insert(configurationClaimSecrets).values({
        configurationId: inserted.id,
        secretHash: hashClaimSecret(claimSecret),
      });
      return inserted;
    });

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

    reply.header("ETag", configurationRevisionEtag(config.revision));
    return reply.status(201).send({ data: { ...config, claimSecret } });
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

    // Only allow saving to public preview configs. Guest autosaves need the
    // revision and room only — never the stored thumbnail data URL.
    const [config] = await db.select({ revision: configurations.revision, spaceId: configurations.spaceId, reviewStatus: configurations.reviewStatus })
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
    const locked = lockedFor(config.reviewStatus);
    if (locked !== null) return reply.status(409).send(locked);

    if (config.revision !== parsed.data.expectedRevision) {
      // When, never who: an anonymous caller is not told who edited.
      const change = await loadRevisionChange(db, params.data.configId, config.revision,
        { discloseActor: false, callerUserId: null, log: request.log });
      reply.header("ETag", configurationRevisionEtag(config.revision));
      return reply.status(409).send(revisionConflictBody(parsed.data.expectedRevision, config.revision, change));
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

    const configId = params.data.configId;

    // Atomic batch: delete stale + update + insert in one transaction
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
          eq(configurations.isPublicPreview, true),
          // Still in the editable state read above: a review begun since holds it.
          eq(configurations.reviewStatus, config.reviewStatus),
          isNull(configurations.deletedAt),
        ))
        .returning({ revision: configurations.revision });

      if (advanced === undefined) {
        const [current] = await tx.select({ revision: configurations.revision, reviewStatus: configurations.reviewStatus })
          .from(configurations)
          .where(and(
            eq(configurations.id, configId),
            eq(configurations.isPublicPreview, true),
            isNull(configurations.deletedAt),
          ))
          .limit(1);
        // A review begun since the check holds the plan: that, not a newer
        // version, is why nothing was saved.
        if (current !== undefined && lockedFor(current.reviewStatus) !== null) {
          return { status: "locked" as const, reviewStatus: current.reviewStatus };
        }
        return {
          status: "conflict" as const,
          currentRevision: current?.revision ?? config.revision,
        };
      }

      txResults.push(...await syncPlacedObjectBatch(tx, configId, parsed.data.objects));

      await tx.insert(configurationLayoutRevisions).values({
        configurationId: configId,
        revision: advanced.revision,
        source: "public_batch",
        actorUserId: null,
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

    if (saveResult.status === "locked") {
      return reply.status(409).send(lockedFor(saveResult.reviewStatus));
    }
    if (saveResult.status === "conflict") {
      const change = await loadRevisionChange(db, configId, saveResult.currentRevision,
        { discloseActor: false, callerUserId: null, log: request.log });
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
      actorUserId: null,
      source: "public_batch",
      at: new Date().toISOString(),
    });
    reply.header("ETag", configurationRevisionEtag(saveResult.revision));
    return { data: { objects: saveResult.objects, revision: saveResult.revision } };
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
    const [config] = await db.select({ id: configurations.id, reviewStatus: configurations.reviewStatus })
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
    const locked = lockedFor(config.reviewStatus);
    if (locked !== null) return reply.status(409).send(locked);

    const [updated] = await db.update(configurations)
      .set({ thumbnailUrl: parsed.data.thumbnailUrl, updatedAt: new Date() })
      .where(and(
        eq(configurations.id, params.data.configId),
        eq(configurations.isPublicPreview, true),
        isNull(configurations.userId),
        eq(configurations.reviewStatus, config.reviewStatus),
        isNull(configurations.deletedAt),
      ))
      .returning();

    if (updated === undefined) {
      const [now] = await db.select({ reviewStatus: configurations.reviewStatus })
        .from(configurations)
        .where(and(eq(configurations.id, params.data.configId), eq(configurations.isPublicPreview, true), isNull(configurations.deletedAt)))
        .limit(1);
      const lockedNow = now === undefined ? null : lockedFor(now.reviewStatus);
      if (lockedNow !== null) return reply.status(409).send(lockedNow);
      return reply.status(404).send({ error: "Public preview configuration not found", code: "NOT_FOUND" });
    }
    reply.header("ETag", configurationRevisionEtag(updated.revision));
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

    reply.header("ETag", configurationRevisionEtag(config.revision));
    return { data: { ...config, objects } };
  });

  // GET /public/configurations/:configId/plan.pdf — the visitor's plan, to send on
  //
  // Fix-first item 11: an organiser with no account can hand the plan to
  // someone else. The organiser's own browser asks with the id it already
  // holds, under exactly the GET rule above (a live public preview). The PDF
  // it gets back is read-only by nature and carries no configuration id,
  // short code or planner URL, no prices, and the line "Drawn by a visitor;
  // not reviewed by the venue." (services/visitor-plan-pdf.ts). Drawing is
  // CPU work, so the hourly limit sits below the batch save's.
  server.get("/configurations/:configId/plan.pdf", {
    config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const plan = await loadVisitorPlan(db, params.data.configId);
    if (plan === null) {
      return reply.status(404).send({ error: "Public preview configuration not found", code: "NOT_FOUND" });
    }

    const pdf = await generateVisitorPlanPdf(plan);
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${visitorPlanFilename(plan.roomName)}"`)
      // A guest plan keeps changing; a cached copy would send yesterday's layout.
      .header("Cache-Control", "no-store")
      .header("Content-Length", pdf.length)
      .send(pdf);
  });
}
