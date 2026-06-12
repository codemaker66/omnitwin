import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import {
  EvidenceTargetTypeSchema,
  ReviewGateDecisionInputSchema,
} from "@omnitwin/types";
import { configurations, reviewGates } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canAccessResource, canManageVenue } from "../utils/query.js";
import {
  ApprovedSnapshotRequiredError,
  EvidenceSourceNotFoundError,
  applyReviewGateDecision,
  generateEvidencePackFromConfiguration,
  getEvidencePackBundle,
  getTruthModeSummary,
  listEvidenceItemsForConfig,
} from "../services/evidence-runtime.js";

const ConfigParam = z.object({ configId: z.string().uuid() });
const IdParam = z.object({ id: z.string().uuid() });
const EvidenceItemsQuery = z.object({ configId: z.string().uuid() });
const TruthModeSummaryQuery = z.object({
  targetType: EvidenceTargetTypeSchema,
  targetId: z.string().trim().min(1).max(160),
});

async function canAccessConfig(db: Database, user: FastifyRequestUser, configId: string): Promise<boolean | null> {
  const [config] = await db.select({
    userId: configurations.userId,
    venueId: configurations.venueId,
  })
    .from(configurations)
    .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
    .limit(1);

  if (config === undefined) return null;
  return canAccessResource(user, config.userId, config.venueId);
}

type FastifyRequestUser = Parameters<typeof canAccessResource>[0];

async function configAccessResponse(
  db: Database,
  user: FastifyRequestUser,
  configId: string,
): Promise<"missing" | "forbidden" | "ok"> {
  const access = await canAccessConfig(db, user, configId);
  if (access === null) return "missing";
  return access ? "ok" : "forbidden";
}

export async function evidencePackRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.post("/from-configuration/:configId", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid configuration ID", code: "VALIDATION_ERROR" });
    }

    const access = await configAccessResponse(db, request.user, params.data.configId);
    if (access === "missing") {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }
    if (access === "forbidden") {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    try {
      const bundle = await generateEvidencePackFromConfiguration(db, {
        configId: params.data.configId,
        actorUserId: request.user.id,
      });
      return reply.status(201).send({ data: bundle });
    } catch (err) {
      if (err instanceof EvidenceSourceNotFoundError) {
        return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
      }
      if (err instanceof ApprovedSnapshotRequiredError) {
        return reply.status(409).send({
          error: "Evidence pack generation requires an approved layout snapshot",
          code: "APPROVED_SNAPSHOT_REQUIRED",
        });
      }
      throw err;
    }
  });

  server.get("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid evidence pack ID", code: "VALIDATION_ERROR" });
    }

    const bundle = await getEvidencePackBundle(db, params.data.id);
    if (bundle === null) {
      return reply.status(404).send({ error: "Evidence pack not found", code: "NOT_FOUND" });
    }

    const access = await configAccessResponse(db, request.user, bundle.pack.configId);
    if (access === "missing") {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }
    if (access === "forbidden") {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    return { data: bundle };
  });
}

export async function evidenceItemRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/items", { preHandler: [authenticate] }, async (request, reply) => {
    const query = EvidenceItemsQuery.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid query", code: "VALIDATION_ERROR", details: query.error.issues });
    }

    const access = await configAccessResponse(db, request.user, query.data.configId);
    if (access === "missing") {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }
    if (access === "forbidden") {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    return { data: await listEvidenceItemsForConfig(db, query.data.configId) };
  });
}

export async function reviewGateRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.post("/:id/decision", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid review gate ID", code: "VALIDATION_ERROR" });
    }

    const body = ReviewGateDecisionInputSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid body", code: "VALIDATION_ERROR", details: body.error.issues });
    }

    const [gate] = await db.select({
      id: reviewGates.id,
      configId: reviewGates.configId,
      venueId: configurations.venueId,
    })
      .from(reviewGates)
      .leftJoin(configurations, eq(reviewGates.configId, configurations.id))
      .where(eq(reviewGates.id, params.data.id))
      .limit(1);

    if (gate === undefined) {
      return reply.status(404).send({ error: "Review gate not found", code: "NOT_FOUND" });
    }

    if (gate.venueId === null || gate.configId === null) {
      return reply.status(409).send({
        error: "Review gate is not linked to a configuration scope",
        code: "UNSCOPED_REVIEW_GATE",
      });
    }

    if (!canManageVenue(request.user, gate.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const updated = await applyReviewGateDecision(db, {
      reviewGateId: params.data.id,
      actorUserId: request.user.id,
      status: body.data.status,
      note: body.data.note ?? null,
    });

    if (updated === null) {
      return reply.status(404).send({ error: "Review gate not found", code: "NOT_FOUND" });
    }

    return { data: updated };
  });
}

export async function truthModeRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/summary", { preHandler: [authenticate] }, async (request, reply) => {
    const query = TruthModeSummaryQuery.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid query", code: "VALIDATION_ERROR", details: query.error.issues });
    }

    return {
      data: await getTruthModeSummary(db, {
        targetType: query.data.targetType,
        targetId: query.data.targetId,
      }),
    };
  });
}
