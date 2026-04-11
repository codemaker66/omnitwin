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

    // Punch list #14: claim is performed inside a transaction so the two
    // updates (config ownership + enquiry linking) are atomic. Previously
    // the second update could throw and leave the system in a half-state
    // where the config was already owned but the linked enquiries weren't.
    //
    // The enquiry filter is scoped to `configurationId` — NOT email, which
    // was the original bug. Filtering by `guestEmail` meant that claiming
    // config A would silently reassign every unowned enquiry from the same
    // email address, including enquiries for unrelated configs (B, C, D...).
    // The data model already represents the right relationship via
    // `enquiries.configuration_id`; this query now uses it.
    const result = await db.transaction(async (tx) => {
      const [claimed] = await tx.update(configurations)
        .set({
          userId: request.user.id,
          isPublicPreview: false,
          visibility: "private",
          updatedAt: new Date(),
        })
        .where(eq(configurations.id, params.data.configId))
        .returning();

      const linkedEnquiries = await tx.update(enquiries)
        .set({ userId: request.user.id, updatedAt: new Date() })
        .where(and(
          eq(enquiries.configurationId, params.data.configId),
          isNull(enquiries.userId),
        ))
        .returning({ id: enquiries.id });

      return { claimed, linkedEnquiryCount: linkedEnquiries.length };
    });

    // Audit log — visible in production logs so ops can verify the scope
    // hasn't drifted again. If `linkedEnquiryCount` is ever surprisingly
    // large for a "normal" claim, that's a signal to investigate.
    request.log.info({
      configId: params.data.configId,
      userId: request.user.id,
      linkedEnquiryCount: result.linkedEnquiryCount,
    }, "configuration claimed");

    return { data: result.claimed };
  });
}
