import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { canAdjustVenueInventory, VenueInventoryHistoryQuerySchema, VenueInventoryItemParamsSchema,
  VenueInventoryParamsSchema, VenueInventoryWriteInputSchema, type InventoryActor } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canReadInventory } from "../utils/query.js";
import { listVenueInventory, readVenueInventoryHistory, VenueInventoryError, writeVenueInventory } from "../services/venue-inventory.js";

const ParamsSchema = z.union([VenueInventoryParamsSchema, VenueInventoryItemParamsSchema]);
const EmptyQuery = z.object({}).strict();

function inventoryActor(request: FastifyRequest): InventoryActor {
  return { userId: request.user.id, role: request.user.role, venueId: request.user.venueId };
}

async function venueIdFromParams(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const parsed = ParamsSchema.safeParse(request.params);
  if (parsed.success) return parsed.data.venueId;
  await reply.status(400).send({ error: "Invalid inventory path", code: "VALIDATION_ERROR", details: parsed.error.issues });
  return null;
}

// Reading what the venue holds is not the same authority as changing it. A
// hallkeeper laying a room, a coordinator answering "do we own enough chairs"
// and a planner sizing a layout all need the counts; none of them adjusts
// them. The role set is Lane 8's single definition in utils/query.
async function authorizeInventoryRead(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const venueId = await venueIdFromParams(request, reply);
  if (venueId === null) return;
  if (!canReadInventory(request.user, venueId)) {
    await reply.status(403).send({ error: "Inventory belongs to the venue you are assigned to", code: "FORBIDDEN" });
  }
}

// Adjusting stock stays with the venue's administrator. Lane 8's
// `canWriteInventory` also admits `manager`, but an adjustment produces an
// audited receipt whose `actorRole` is pinned to "admin" in @omnitwin/types
// (venue-inventory.ts, venue-inventory-api.ts) and re-checked inside the pure
// `applyInventoryAdjustment`. Admitting a writer here that the receipt chain
// would then reject is worse than a narrow gate, so widening the writer waits
// on that receipt vocabulary and on the role set in Lane 8's file.
async function authorizeInventoryWrite(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const venueId = await venueIdFromParams(request, reply);
  if (venueId === null) return;
  if (!canAdjustVenueInventory(inventoryActor(request), venueId)) {
    await reply.status(403).send({ error: "Only this venue's administrator can manage inventory", code: "FORBIDDEN" });
  }
}

async function execute<T>(reply: FastifyReply, operation: () => Promise<T>): Promise<T | FastifyReply> {
  try { return await operation(); }
  catch (error) {
    if (!(error instanceof VenueInventoryError)) throw error;
    return reply.status(error.status).send({ error: error.message, code: error.code,
      ...(error.currentStock === undefined ? {} : { details: { currentStock: error.currentStock } }) });
  }
}

export async function venueInventoryRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const readable = [authenticate, authorizeInventoryRead];
  const writable = [authenticate, authorizeInventoryWrite];
  server.get("/:venueId/inventory", { preHandler: readable }, async (request, reply) => {
    const query = EmptyQuery.safeParse(request.query);
    if (!query.success) return reply.status(400).send({ error: "Invalid inventory query", code: "VALIDATION_ERROR", details: query.error.issues });
    const { venueId } = VenueInventoryParamsSchema.parse(request.params);
    return execute(reply, () => listVenueInventory(opts.db, inventoryActor(request), venueId));
  });

  server.post("/:venueId/inventory/:assetDefinitionId/adjustments", { preHandler: writable }, async (request, reply) => {
    const query = EmptyQuery.safeParse(request.query);
    const parsed = VenueInventoryWriteInputSchema.safeParse(request.body);
    if (!query.success || !parsed.success) {
      return reply.status(400).send({ error: "Invalid inventory change", code: "VALIDATION_ERROR",
        details: !parsed.success ? parsed.error.issues : !query.success ? query.error.issues : [] });
    }
    const params = VenueInventoryItemParamsSchema.parse(request.params);
    return execute(reply, () => writeVenueInventory(opts.db, inventoryActor(request), { ...parsed.data, ...params }));
  });

  server.get("/:venueId/inventory/:assetDefinitionId/history", { preHandler: readable }, async (request, reply) => {
    const query = VenueInventoryHistoryQuerySchema.safeParse(request.query);
    if (!query.success) return reply.status(400).send({ error: "Invalid inventory history query", code: "VALIDATION_ERROR", details: query.error.issues });
    const { venueId, assetDefinitionId } = VenueInventoryItemParamsSchema.parse(request.params);
    return execute(reply, () => readVenueInventoryHistory(opts.db, inventoryActor(request), venueId, assetDefinitionId, query.data));
  });
}
