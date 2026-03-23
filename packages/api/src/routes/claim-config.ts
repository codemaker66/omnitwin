import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { configurations, enquiries } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ConfigIdParam = z.object({ configId: z.string().uuid() });

// ---------------------------------------------------------------------------
// Plugin — claim a public preview configuration
// ---------------------------------------------------------------------------

export async function claimConfigRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // POST /configurations/:configId/claim — authenticated user claims preview config
  server.post("/:configId/claim", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const [config] = await db.select()
      .from(configurations)
      .where(and(eq(configurations.id, params.data.configId), isNull(configurations.deletedAt)))
      .limit(1);

    if (config === undefined) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    // Can only claim if it's a public preview with no owner
    if (!config.isPublicPreview || config.userId !== null) {
      return reply.status(409).send({ error: "Configuration is already claimed", code: "ALREADY_CLAIMED" });
    }

    // Claim it
    const [claimed] = await db.update(configurations)
      .set({
        userId: request.user.id,
        isPublicPreview: false,
        visibility: "private",
        updatedAt: new Date(),
      })
      .where(eq(configurations.id, params.data.configId))
      .returning();

    // Also link any guest enquiries from the same email to this user
    await db.update(enquiries)
      .set({ userId: request.user.id, updatedAt: new Date() })
      .where(and(
        eq(enquiries.guestEmail, request.user.email),
        isNull(enquiries.userId),
      ));

    return { data: claimed };
  });
}
