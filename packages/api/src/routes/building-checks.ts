import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  BuildingCheckKindSchema,
  BuildingCheckMarkBodySchema,
  BuildingCheckSchema,
  BuildingChecksDayQuerySchema,
  BuildingChecksDaySchema,
  ReplaceBuildingChecksSchema,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import {
  isCheckDeny,
  markBuildingCheck,
  readBuildingChecks,
  replaceBuildingChecks,
  unmarkBuildingCheck,
  type CheckDeny,
} from "../services/building-checks.js";
import type { RequestActor } from "../services/requests.js";

// ---------------------------------------------------------------------------
// /venues/:venueId/building-checks (T-693) — opening and lock-up.
//
//   GET    ?day=YYYY-MM-DD             the floor reads the day's two lists
//   PUT    /opening | /lockup          an administrator leaves a list as it should be
//   POST   /:checkId/marks  {day}      the floor ticks a check; a second tick reads it back
//   DELETE /:checkId/marks?day=        the floor takes a tick back
// ---------------------------------------------------------------------------

const VenueParam = z.object({ venueId: z.uuid() });
const KindParam = z.object({ venueId: z.uuid(), kind: BuildingCheckKindSchema });
const CheckParam = z.object({ venueId: z.uuid(), checkId: z.uuid() });

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

function sendDeny(reply: FastifyReply, result: CheckDeny): FastifyReply {
  return reply.status(result.status).send({ error: result.error, code: result.code });
}

function actorOf(request: FastifyRequest): RequestActor {
  return {
    id: request.user.id,
    name: request.user.name,
    role: request.user.role,
    venueId: request.user.venueId,
    platformRole: request.user.platformRole,
  };
}

export async function buildingCheckRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/:venueId/building-checks", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const query = BuildingChecksDayQuerySchema.safeParse(request.query ?? {});
    if (!query.success) return validationError(reply, query.error.issues);
    const result = await readBuildingChecks(db, actorOf(request), params.data.venueId, query.data.day);
    if (isCheckDeny(result)) return sendDeny(reply, result);
    return { data: BuildingChecksDaySchema.parse(result) };
  });

  server.put("/:venueId/building-checks/:kind", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = KindParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = ReplaceBuildingChecksSchema.safeParse(request.body ?? {});
    if (!body.success) return validationError(reply, body.error.issues);
    const result = await replaceBuildingChecks(db, actorOf(request), params.data.venueId, params.data.kind, body.data);
    if (isCheckDeny(result)) return sendDeny(reply, result);
    return { data: z.array(BuildingCheckSchema).parse(result) };
  });

  server.post("/:venueId/building-checks/:checkId/marks", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = CheckParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = BuildingCheckMarkBodySchema.safeParse(request.body ?? {});
    if (!body.success) return validationError(reply, body.error.issues);
    const result = await markBuildingCheck(db, actorOf(request), params.data.venueId, params.data.checkId, body.data.day);
    if (isCheckDeny(result)) return sendDeny(reply, result);
    return { data: BuildingCheckSchema.parse(result) };
  });

  server.delete("/:venueId/building-checks/:checkId/marks", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = CheckParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const query = BuildingCheckMarkBodySchema.safeParse(request.query ?? {});
    if (!query.success) return validationError(reply, query.error.issues);
    const result = await unmarkBuildingCheck(db, actorOf(request), params.data.venueId, params.data.checkId, query.data.day);
    if (isCheckDeny(result)) return sendDeny(reply, result);
    return { data: BuildingCheckSchema.parse(result) };
  });
}
