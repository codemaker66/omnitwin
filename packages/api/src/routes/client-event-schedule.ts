import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ClientEventScheduleQuerySchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { loadClientEventSchedule } from "../services/client-event-schedule.js";

const EventParamSchema = z.object({ eventId: z.string().uuid() });

export async function clientEventScheduleRoutes(server: FastifyInstance, options: { db: Database }): Promise<void> {
  server.get("/:eventId/client-schedule", { preHandler: [authenticate] }, async (request, reply) => {
    // Authenticated schedules must never enter a shared HTTP cache.
    reply.header("Cache-Control", "private, no-store");
    const params = EventParamSchema.safeParse(request.params);
    const query = ClientEventScheduleQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.status(400).send({ error: "Invalid event schedule request", code: "VALIDATION_ERROR" });
    }
    const schedule = await loadClientEventSchedule(options.db, request.user.id, params.data.eventId, query.data.configurationId);
    if (schedule === null) {
      return reply.status(404).send({ error: "Event schedule not found", code: "NOT_FOUND" });
    }
    return { data: schedule };
  });
}
