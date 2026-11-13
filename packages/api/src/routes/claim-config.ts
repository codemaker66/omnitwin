import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, sql } from "drizzle-orm";
import {
  configurationClaimSecrets,
  configurations,
  eventConfigurationLinks,
  handoffPacks,
  proposals,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { claimSecretMatches } from "../services/configuration-claim-secrets.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ConfigIdParam = z.object({ configId: z.uuid() });
const ClaimBody = z.object({ claimSecret: z.string().min(16).max(256) });

// ---------------------------------------------------------------------------
// Plugin — claim a public preview configuration
//
// A plan's id travels (/plan/<id>, "Copy layout link"), so the id alone never
// lets an account take a plan (release audit public-surface-1). The claimer
// must present the secret POST /public/configurations gave the browser that
// made the plan; the claim consumes it. Two more rules hold:
//
//   - A claim never moves enquiries. A guest's enquiry, with their name,
//     email, phone and message, was sent to the venue alone; it stays the
//     venue's, whoever later holds the plan.
//   - A plan the venue has taken into its work (linked to an event, compiled
//     into a handoff pack, or put in a proposal) is never claimable: owning a
//     layout linked to an event is what gives a client that event's schedule.
// ---------------------------------------------------------------------------

type ClaimOutcome =
  | { readonly kind: "claimed"; readonly config: typeof configurations.$inferSelect }
  | { readonly kind: "not-found" | "already-claimed" | "not-creator" | "in-venue-work" };

export async function claimConfigRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // POST /configurations/:configId/claim — the creating browser's account takes its plan
  server.post("/:configId/claim", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }
    const body = ClaimBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "A claim secret is required", code: "VALIDATION_ERROR" });
    }
    const configId = params.data.configId;

    // One transaction, serialised on the plan's row, so of two concurrent
    // claims exactly one wins; every refusal returns before anything is written.
    const outcome = await db.transaction(async (tx): Promise<ClaimOutcome> => {
      const [config] = await tx.select({ isPublicPreview: configurations.isPublicPreview, userId: configurations.userId })
        .from(configurations)
        .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
        .limit(1)
        .for("update");
      if (config === undefined) return { kind: "not-found" };
      if (!config.isPublicPreview || config.userId !== null) return { kind: "already-claimed" };

      // Whether a plan exists and is still unclaimed is already public (its
      // public read answers that); nothing else is said before the secret.
      const [secret] = await tx.select({ secretHash: configurationClaimSecrets.secretHash })
        .from(configurationClaimSecrets)
        .where(eq(configurationClaimSecrets.configurationId, configId))
        .limit(1);
      if (secret === undefined || !claimSecretMatches(secret.secretHash, body.data.claimSecret)) {
        return { kind: "not-creator" };
      }

      const [inVenueWork] = await tx.select({
        evented: sql<boolean>`exists (${tx.select({ one: sql`1` }).from(eventConfigurationLinks).where(eq(eventConfigurationLinks.configurationId, configId))})`,
        handedOff: sql<boolean>`exists (${tx.select({ one: sql`1` }).from(handoffPacks).where(eq(handoffPacks.configId, configId))})`,
        proposed: sql<boolean>`exists (${tx.select({ one: sql`1` }).from(proposals).where(eq(proposals.configurationId, configId))})`,
      }).from(sql`(select 1) as probe`);
      if (inVenueWork === undefined || inVenueWork.evented || inVenueWork.handedOff || inVenueWork.proposed) {
        return { kind: "in-venue-work" };
      }

      const [claimed] = await tx.update(configurations)
        .set({
          userId: request.user.id,
          isPublicPreview: false,
          visibility: "private",
          updatedAt: new Date(),
        })
        .where(and(
          eq(configurations.id, configId),
          eq(configurations.isPublicPreview, true),
          isNull(configurations.userId),
          isNull(configurations.deletedAt),
        ))
        .returning();
      if (claimed === undefined) return { kind: "already-claimed" };
      await tx.delete(configurationClaimSecrets).where(eq(configurationClaimSecrets.configurationId, configId));
      return { kind: "claimed", config: claimed };
    });

    switch (outcome.kind) {
      case "not-found":
        return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
      case "already-claimed":
        return reply.status(409).send({ error: "Configuration is already claimed", code: "ALREADY_CLAIMED" });
      case "not-creator":
        return reply.status(403).send({
          error: "Only the browser that started this plan can add it to an account",
          code: "NOT_PLAN_CREATOR",
        });
      case "in-venue-work":
        return reply.status(409).send({
          error: "This plan is part of the venue's work on an event, so it stays with the venue",
          code: "CONFIGURATION_IN_VENUE_WORK",
        });
      case "claimed":
        // Audit log — visible in production logs, so ops can see who took which plan.
        request.log.info({ configId, userId: request.user.id }, "configuration claimed");
        return { data: outcome.config };
    }
  });
}
