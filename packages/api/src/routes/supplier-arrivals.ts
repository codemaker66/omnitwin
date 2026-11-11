import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CreateSupplierArrivalSchema,
  RemoveSupplierArrivalQuerySchema,
  SupplierArrivalListQuerySchema,
  SupplierArrivalSchema,
  SupplierArrivalStepSchema,
  UpdateSupplierArrivalSchema,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import {
  createArrival,
  isArrivalDeny,
  listArrivals,
  recordArrivalStep,
  removeArrival,
  undoArrivalStep,
  updateArrival,
  type ArrivalDeny,
} from "../services/supplier-arrivals.js";
import type { RequestActor } from "../services/requests.js";

// ---------------------------------------------------------------------------
// /venues/:venueId/supplier-arrivals (T-692) — who comes to the building for
// a booking, when, and at which door.
//
//   GET    ?from=&to=            the floor reads the arrivals due in a window
//   POST   /                     the office adds one to a booking
//   PATCH  /:id                  the office changes one, from the revision it saw
//   DELETE /:id?expectedRevision the office removes one, likewise
//   POST   /:id/arrived | /left  the floor records the door; first tap wins
//   DELETE /:id/arrived | /left  the floor takes a mistaken tap back
// ---------------------------------------------------------------------------

const VenueParam = z.object({ venueId: z.uuid() });
const ItemParam = z.object({ venueId: z.uuid(), id: z.uuid() });
const StepParam = ItemParam.extend({ step: SupplierArrivalStepSchema });

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

function sendDeny(reply: FastifyReply, result: ArrivalDeny): FastifyReply {
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

export async function supplierArrivalRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/:venueId/supplier-arrivals", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const query = SupplierArrivalListQuerySchema.safeParse(request.query ?? {});
    if (!query.success) return validationError(reply, query.error.issues);
    const result = await listArrivals(db, actorOf(request), params.data.venueId, query.data);
    if (isArrivalDeny(result)) return sendDeny(reply, result);
    return { data: z.array(SupplierArrivalSchema).parse(result) };
  });

  server.post("/:venueId/supplier-arrivals", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = CreateSupplierArrivalSchema.safeParse(request.body ?? {});
    if (!body.success) return validationError(reply, body.error.issues);
    const result = await createArrival(db, actorOf(request), params.data.venueId, body.data);
    if (isArrivalDeny(result)) return sendDeny(reply, result);
    return reply.status(201).send({ data: SupplierArrivalSchema.parse(result) });
  });

  server.patch("/:venueId/supplier-arrivals/:id", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = ItemParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = UpdateSupplierArrivalSchema.safeParse(request.body ?? {});
    if (!body.success) return validationError(reply, body.error.issues);
    const result = await updateArrival(db, actorOf(request), params.data.venueId, params.data.id, body.data);
    if (isArrivalDeny(result)) return sendDeny(reply, result);
    return { data: SupplierArrivalSchema.parse(result) };
  });

  server.delete("/:venueId/supplier-arrivals/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ItemParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const query = RemoveSupplierArrivalQuerySchema.safeParse(request.query ?? {});
    if (!query.success) return validationError(reply, query.error.issues);
    const result = await removeArrival(db, actorOf(request), params.data.venueId, params.data.id, query.data.expectedRevision);
    if (isArrivalDeny(result)) return sendDeny(reply, result);
    return reply.status(204).send();
  });

  server.post("/:venueId/supplier-arrivals/:id/:step", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = StepParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const result = await recordArrivalStep(db, actorOf(request), params.data.venueId, params.data.id, params.data.step);
    if (isArrivalDeny(result)) return sendDeny(reply, result);
    return { data: SupplierArrivalSchema.parse(result) };
  });

  server.delete("/:venueId/supplier-arrivals/:id/:step", { preHandler: [authenticate] }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = StepParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const result = await undoArrivalStep(db, actorOf(request), params.data.venueId, params.data.id, params.data.step);
    if (isArrivalDeny(result)) return sendDeny(reply, result);
    return { data: SupplierArrivalSchema.parse(result) };
  });
}
