import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { RoomDayQuerySchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { loadRoomDay } from "../services/room-day.js";
import { canEverReadRoomDay } from "../utils/query.js";

// ---------------------------------------------------------------------------
// The room-day door (goal 19 S6): GET /events/:eventId/room-day?spaceId&day
//
// What a client may see of a room's day before proposing a time. The roles
// that could never read it are turned away before any database work; the
// link proof and the anonymisation live in services/room-day.ts.
// ---------------------------------------------------------------------------

const EventParam = z.object({ eventId: z.uuid() });

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

export async function roomDayRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/:eventId/room-day", { preHandler: [authenticate] }, async (request, reply) => {
    const params = EventParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    if (!canEverReadRoomDay(request.user)) {
      return reply.status(403).send({ error: "Only the client's side and the venue read a room's day.", code: "FORBIDDEN" });
    }
    const query = RoomDayQuerySchema.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error.issues);

    const result = await loadRoomDay(db, {
      id: request.user.id,
      role: request.user.role,
      venueId: request.user.venueId,
      platformRole: request.user.platformRole,
    }, params.data.eventId, query.data);
    if ("ok" in result) return reply.status(result.status).send({ error: result.error, code: result.code });
    return reply.send({ data: result });
  });
}
