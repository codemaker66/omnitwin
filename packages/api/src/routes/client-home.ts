import type { FastifyInstance } from "fastify";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { loadClientHome } from "../services/client-home.js";

/**
 * GET /client-home — the signed-in person's own events and plans, where a
 * client or planner lands after sign-in (fix-first 12). It reads by the
 * caller's id alone and takes no parameters, so there is nothing to point at
 * someone else's work.
 */
export async function clientHomeRoutes(server: FastifyInstance, options: { db: Database }): Promise<void> {
  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    // A person's own list must never enter a shared HTTP cache.
    reply.header("Cache-Control", "private, no-store");
    return { data: await loadClientHome(options.db, request.user.id) };
  });
}
