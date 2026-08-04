import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { configurations, events } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canAccessResource } from "../utils/query.js";
import {
  OpsHandoffApprovedSnapshotRequiredError,
  OpsHandoffBlockingReviewGateError,
  OpsHandoffEvidenceIntegrityError,
  OpsHandoffEventBindingRequiredError,
  OpsHandoffEventNotFoundError,
  OpsHandoffSourceNotFoundError,
  compileOpsHandoffPackFromConfiguration,
  getOpsHandoffPackBundle,
} from "../services/ops-compiler.js";

const IdParam = z.object({ id: z.string().uuid() });
const ConfigParam = z.object({ configId: z.string().uuid() });
const CompileBody = z.object({
  eventId: z.string().uuid().nullable().optional(),
  clientNotes: z.string().trim().max(4000).nullable().optional(),
}).strict();

type FastifyRequestUser = Parameters<typeof canAccessResource>[0];

async function configAccessResponse(
  db: Database,
  user: FastifyRequestUser,
  configId: string,
): Promise<"missing" | "forbidden" | "ok"> {
  const [config] = await db.select({
    userId: configurations.userId,
    venueId: configurations.venueId,
  })
    .from(configurations)
    .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
    .limit(1);

  if (config === undefined) return "missing";
  return canAccessResource(user, config.userId, config.venueId) ? "ok" : "forbidden";
}

async function eventAccessResponse(
  db: Database,
  user: FastifyRequestUser,
  eventId: string,
): Promise<"missing" | "forbidden" | "ok"> {
  const [event] = await db.select({
    createdBy: events.createdBy,
    venueId: events.venueId,
  })
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .limit(1);

  if (event === undefined) return "missing";
  return canAccessResource(user, event.createdBy, event.venueId) ? "ok" : "forbidden";
}

export async function opsHandoffRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.post("/handoff-packs/from-configuration/:configId", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid configuration ID", code: "VALIDATION_ERROR" });
    }
    const body = CompileBody.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid body", code: "VALIDATION_ERROR", details: body.error.issues });
    }

    const configAccess = await configAccessResponse(db, request.user, params.data.configId);
    if (configAccess === "missing") {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }
    if (configAccess === "forbidden") {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const eventId = body.data.eventId ?? null;
    if (eventId !== null) {
      const eventAccess = await eventAccessResponse(db, request.user, eventId);
      if (eventAccess === "missing") {
        return reply.status(404).send({ error: "Event not found", code: "NOT_FOUND" });
      }
      if (eventAccess === "forbidden") {
        return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
      }
    }

    try {
      const bundle = await compileOpsHandoffPackFromConfiguration(db, {
        configId: params.data.configId,
        eventId,
        clientNotes: body.data.clientNotes ?? null,
        actorUserId: request.user.id,
      });
      return reply.status(201).send({ data: bundle });
    } catch (err) {
      if (err instanceof OpsHandoffSourceNotFoundError) {
        return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
      }
      if (err instanceof OpsHandoffEventNotFoundError) {
        return reply.status(404).send({ error: "Event not found", code: "NOT_FOUND" });
      }
      if (err instanceof OpsHandoffApprovedSnapshotRequiredError) {
        return reply.status(409).send({
          error: "Ops handoff compilation requires an approved layout snapshot",
          code: "APPROVED_SNAPSHOT_REQUIRED",
        });
      }
      if (err instanceof OpsHandoffBlockingReviewGateError) {
        return reply.status(409).send({
          error: "Ops compilation remains blocked until a separate reviewed guest-flow evidence artifact is attached",
          code: "BLOCKING_REVIEW_GATE",
          details: err.gate,
        });
      }
      if (err instanceof OpsHandoffEvidenceIntegrityError) {
        return reply.status(409).send({
          error: "Event Architect evidence could not be verified for Ops compilation",
          code: "SOURCE_EVIDENCE_INVALID",
        });
      }
      if (err instanceof OpsHandoffEventBindingRequiredError) {
        return reply.status(409).send({
          error: "Bind this approved configuration to the event before compiling its Ops handoff",
          code: "EVENT_CONFIGURATION_BINDING_REQUIRED",
          details: { configId: err.configId, eventId: err.eventId },
        });
      }
      throw err;
    }
  });

  server.get("/handoff-packs/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid handoff pack ID", code: "VALIDATION_ERROR" });
    }

    const bundle = await getOpsHandoffPackBundle(db, params.data.id);
    if (bundle === null) {
      return reply.status(404).send({ error: "Handoff pack not found", code: "NOT_FOUND" });
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
