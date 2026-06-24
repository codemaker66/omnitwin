import type { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/auth.js";

// ---------------------------------------------------------------------------
// Auth session routes
//
// Clerk proves identity. This endpoint returns Venviewer authorization state
// from our database-resolved request.user, including platformRole. Frontend
// consumers may use it for navigation, but API routes remain the authority.
// ---------------------------------------------------------------------------

export async function authRoutes(server: FastifyInstance): Promise<void> {
  server.get("/me", { preHandler: [authenticate] }, async (request) => ({
    data: {
      id: request.user.id,
      email: request.user.email,
      name: request.user.name,
      role: request.user.role,
      platformRole: request.user.platformRole,
      venueId: request.user.venueId,
    },
  }));
}
