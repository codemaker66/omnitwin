import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InventoryAssessmentQuerySchema, InventoryIdSchema, InventoryRemedyApproveInputSchema,
  InventoryRemedyPrepareInputSchema, InventoryReservationApprovalInputSchema, InventoryReservationRevokeInputSchema,
  canAdjustVenueInventory, type InventoryActor } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { approveInventoryRemedy, approveInventoryReservation, assessVenueInventory, InventoryDecisionError,
  prepareInventoryRemedy, readInventoryRemedy, readInventoryReservationHistory, revokeInventoryReservation } from "../services/inventory-reservations.js";

const Venue = z.object({ venueId: InventoryIdSchema }).strict();
const Remedy = Venue.extend({ id: InventoryIdSchema });
const History = Venue.extend({ eventId: InventoryIdSchema, spaceId: InventoryIdSchema });
const Params = z.union([Venue, Remedy, History]);
const Empty = z.object({}).strict();
const actorFor = (request: FastifyRequest): InventoryActor => ({ userId: request.user.id, role: request.user.role, venueId: request.user.venueId });
const invalid = (reply: FastifyReply, details: unknown) => reply.status(400).send({ error: "Invalid inventory decision request", code: "VALIDATION_ERROR", details });
async function authorized(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const params = Params.safeParse(request.params);
  if (!params.success) { await invalid(reply, params.error.issues); return; }
  if (!canAdjustVenueInventory(actorFor(request), params.data.venueId)) {
    await reply.status(403).send({ error: "Only this venue's administrator can approve inventory decisions", code: "FORBIDDEN" });
  }
}
async function execute<T>(reply: FastifyReply, action: () => Promise<T>): Promise<T | FastifyReply> {
  try { return await action(); }
  catch (error) {
    if (!(error instanceof InventoryDecisionError)) throw error;
    return reply.status(error.status).send({ error: error.message, code: error.code, ...(error.details === undefined ? {} : { details: error.details }) });
  }
}
export async function inventoryReservationsRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const preHandler = [authenticate, authorized];
  server.get("/:venueId/inventory/assessment", { preHandler }, async (request, reply) => {
    const query = InventoryAssessmentQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply, query.error.issues);
    const { venueId } = Venue.parse(request.params);
    return execute(reply, () => assessVenueInventory(opts.db, actorFor(request), venueId, { startsAt: query.data.from, endsAt: query.data.to }));
  });
  server.post("/:venueId/inventory/reservations/approve", { preHandler }, async (request, reply) => {
    const input = InventoryReservationApprovalInputSchema.safeParse(request.body);
    const query = Empty.safeParse(request.query);
    if (!input.success || !query.success) return invalid(reply, !input.success ? input.error.issues : []);
    const { venueId } = Venue.parse(request.params);
    return execute(reply, () => approveInventoryReservation(opts.db, actorFor(request), venueId, input.data));
  });
  server.post("/:venueId/inventory/reservations/revoke", { preHandler }, async (request, reply) => {
    const input = InventoryReservationRevokeInputSchema.safeParse(request.body);
    const query = Empty.safeParse(request.query);
    if (!input.success || !query.success) return invalid(reply, !input.success ? input.error.issues : []);
    const { venueId } = Venue.parse(request.params);
    return execute(reply, () => revokeInventoryReservation(opts.db, actorFor(request), venueId, input.data));
  });
  server.get("/:venueId/inventory/reservations/:eventId/:spaceId/history", { preHandler }, async (request, reply) => {
    const query = Empty.safeParse(request.query); if (!query.success) return invalid(reply, query.error.issues);
    const { venueId, eventId, spaceId } = History.parse(request.params);
    return execute(reply, () => readInventoryReservationHistory(opts.db, actorFor(request), venueId, eventId, spaceId));
  });
  server.post("/:venueId/inventory/remedies/prepare", { preHandler }, async (request, reply) => {
    const input = InventoryRemedyPrepareInputSchema.safeParse(request.body);
    const query = Empty.safeParse(request.query);
    if (!input.success || !query.success) return invalid(reply, !input.success ? input.error.issues : []);
    const { venueId } = Venue.parse(request.params);
    return execute(reply, () => prepareInventoryRemedy(opts.db, actorFor(request), venueId, input.data));
  });
  server.post("/:venueId/inventory/remedies/:id/approve", { preHandler }, async (request, reply) => {
    const input = InventoryRemedyApproveInputSchema.safeParse(request.body);
    const query = Empty.safeParse(request.query);
    if (!input.success || !query.success) return invalid(reply, !input.success ? input.error.issues : []);
    const { venueId, id } = Remedy.parse(request.params);
    return execute(reply, () => approveInventoryRemedy(opts.db, actorFor(request), venueId, id, input.data));
  });
  server.get("/:venueId/inventory/remedies/:id", { preHandler }, async (request, reply) => {
    const query = Empty.safeParse(request.query); if (!query.success) return invalid(reply, query.error.issues);
    const { venueId, id } = Remedy.parse(request.params);
    return execute(reply, () => readInventoryRemedy(opts.db, actorFor(request), venueId, id));
  });
}
