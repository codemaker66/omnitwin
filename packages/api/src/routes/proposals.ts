import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, sql } from "drizzle-orm";
import {
  ProposalVersionPayloadSchema,
  proposalVersionPayloadDigest,
  isProposalEditable,
  ShortCodeSchema,
  PROPOSAL_STATUSES_REQUIRING_SENT_AT,
  type ProposalStatus,
} from "@omnitwin/types";
import {
  proposals,
  proposalVersions,
  proposalStatusHistory,
  enquiries,
  configurations,
  venues,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { paginate } from "../utils/pagination.js";
import { canAccessResource } from "../utils/query.js";
import {
  PROPOSAL_STATES,
  canTransitionProposal,
  getAvailableProposalTransitions,
} from "../state-machines/proposal.js";
import { generateUniqueShortCode } from "../services/shortcode.js";

// ---------------------------------------------------------------------------
// Proposal routes — T-427 phase 2.
//
// Venue scoping: proposals are authored by venue staff. Creation and
// mutation require admin (any venue) or staff (own venue only); reads use
// the house canAccessResource rule (admin / venue staff / creator).
// Status changes run through the proposal state machine with role policy;
// every transition writes a proposal_status_history row.
//
// SAFE language: version payload content is validated by
// ProposalVersionPayloadSchema, whose claim guard rejects unsupported
// certainty wording before anything is persisted.
// ---------------------------------------------------------------------------

const IdParam = z.object({ id: z.string().uuid() });

const CreateProposalBody = z.object({
  venueId: z.string().uuid(),
  enquiryId: z.string().uuid().nullable().optional(),
  configurationId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
});

const UpdateProposalBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  enquiryId: z.string().uuid().nullable().optional(),
  configurationId: z.string().uuid().nullable().optional(),
});

const TransitionBody = z.object({
  status: z.enum(PROPOSAL_STATES),
  note: z.string().max(1000).nullable().optional(),
});

const ListQuery = z.object({
  status: z.enum(PROPOSAL_STATES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const VersionParam = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

type AuthedUser = { id: string; role: string; venueId: string | null };

/** Create/mutate policy: admin anywhere, staff within their own venue. */
function canManageVenueProposals(user: AuthedUser, venueId: string): boolean {
  if (user.role === "admin") return true;
  return user.role === "staff" && user.venueId === venueId;
}

export async function proposalRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // GET /proposals — authenticated, role-filtered, paginated
  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const query = ListQuery.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid query", code: "VALIDATION_ERROR", details: query.error.issues });
    }

    const user = request.user;
    const whereConditions = [isNull(proposals.deletedAt)];

    if (query.data.status !== undefined) {
      whereConditions.push(eq(proposals.status, query.data.status));
    }

    if (user.role === "admin") {
      // Admin sees all venues
    } else if ((user.role === "staff" || user.role === "hallkeeper") && user.venueId !== null) {
      whereConditions.push(eq(proposals.venueId, user.venueId));
    } else {
      whereConditions.push(eq(proposals.createdBy, user.id));
    }

    const where = and(...whereConditions);

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(proposals)
      .where(where);
    const total = countResult?.count ?? 0;

    const rows = await db.select()
      .from(proposals)
      .where(where)
      .limit(query.data.limit)
      .offset(query.data.offset)
      .orderBy(proposals.updatedAt);

    return paginate(rows, total, { limit: query.data.limit, offset: query.data.offset });
  });

  // POST /proposals — staff (own venue) or admin creates a draft
  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateProposalBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    if (!canManageVenueProposals(request.user, parsed.data.venueId)) {
      return reply.status(403).send({ error: "Only venue staff or admin can create proposals for this venue", code: "FORBIDDEN" });
    }

    // Linked records must exist and belong to the same venue.
    if (parsed.data.enquiryId !== undefined && parsed.data.enquiryId !== null) {
      const [enquiry] = await db.select({ venueId: enquiries.venueId })
        .from(enquiries)
        .where(eq(enquiries.id, parsed.data.enquiryId))
        .limit(1);
      if (enquiry === undefined) {
        return reply.status(404).send({ error: "Enquiry not found", code: "NOT_FOUND" });
      }
      if (enquiry.venueId !== parsed.data.venueId) {
        return reply.status(422).send({ error: "Enquiry belongs to a different venue", code: "VENUE_MISMATCH" });
      }
    }

    if (parsed.data.configurationId !== undefined && parsed.data.configurationId !== null) {
      const [config] = await db.select({ venueId: configurations.venueId })
        .from(configurations)
        .where(and(eq(configurations.id, parsed.data.configurationId), isNull(configurations.deletedAt)))
        .limit(1);
      if (config === undefined) {
        return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
      }
      if (config.venueId !== parsed.data.venueId) {
        return reply.status(422).send({ error: "Configuration belongs to a different venue", code: "VENUE_MISMATCH" });
      }
    }

    const [proposal] = await db.insert(proposals).values({
      venueId: parsed.data.venueId,
      enquiryId: parsed.data.enquiryId ?? null,
      configurationId: parsed.data.configurationId ?? null,
      title: parsed.data.title,
      status: "draft",
      currentVersion: 0,
      createdBy: request.user.id,
    }).returning();

    return reply.status(201).send({ data: proposal });
  });

  // GET /proposals/:id — admin / venue staff / creator
  server.get("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.id, params.data.id), isNull(proposals.deletedAt)))
      .limit(1);
    if (proposal === undefined) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (!canAccessResource(request.user, proposal.createdBy, proposal.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    return { data: proposal };
  });

  // PATCH /proposals/:id — staff/admin while editable (draft / changes_requested)
  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }
    const parsed = UpdateProposalBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.id, params.data.id), isNull(proposals.deletedAt)))
      .limit(1);
    if (proposal === undefined) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (!canManageVenueProposals(request.user, proposal.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (request.user.role !== "admin" && !isProposalEditable(proposal.status as ProposalStatus)) {
      return reply.status(422).send({ error: "Proposal is not editable in its current status", code: "NOT_EDITABLE" });
    }

    // Linked records must stay venue-coherent.
    if (parsed.data.enquiryId !== undefined && parsed.data.enquiryId !== null) {
      const [enquiry] = await db.select({ venueId: enquiries.venueId })
        .from(enquiries).where(eq(enquiries.id, parsed.data.enquiryId)).limit(1);
      if (enquiry === undefined) {
        return reply.status(404).send({ error: "Enquiry not found", code: "NOT_FOUND" });
      }
      if (enquiry.venueId !== proposal.venueId) {
        return reply.status(422).send({ error: "Enquiry belongs to a different venue", code: "VENUE_MISMATCH" });
      }
    }
    if (parsed.data.configurationId !== undefined && parsed.data.configurationId !== null) {
      const [config] = await db.select({ venueId: configurations.venueId })
        .from(configurations)
        .where(and(eq(configurations.id, parsed.data.configurationId), isNull(configurations.deletedAt)))
        .limit(1);
      if (config === undefined) {
        return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
      }
      if (config.venueId !== proposal.venueId) {
        return reply.status(422).send({ error: "Configuration belongs to a different venue", code: "VENUE_MISMATCH" });
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) updateData["title"] = parsed.data.title;
    if (parsed.data.enquiryId !== undefined) updateData["enquiryId"] = parsed.data.enquiryId;
    if (parsed.data.configurationId !== undefined) updateData["configurationId"] = parsed.data.configurationId;

    const [updated] = await db.update(proposals)
      .set(updateData)
      .where(eq(proposals.id, params.data.id))
      .returning();

    return { data: updated };
  });

  // DELETE /proposals/:id — soft delete; accepted proposals are locked (admin may override)
  server.delete("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.id, params.data.id), isNull(proposals.deletedAt)))
      .limit(1);
    if (proposal === undefined) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (!canManageVenueProposals(request.user, proposal.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (proposal.status === "accepted" && request.user.role !== "admin") {
      return reply.status(422).send({ error: "Accepted proposals are a commercial record and cannot be deleted", code: "PROPOSAL_ACCEPTED_LOCKED" });
    }

    await db.update(proposals)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(proposals.id, params.data.id));

    return reply.status(204).send();
  });

  // POST /proposals/:id/transition — state machine + history
  server.post("/:id/transition", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }
    const parsed = TransitionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.id, params.data.id), isNull(proposals.deletedAt)))
      .limit(1);
    if (proposal === undefined) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (!canAccessResource(request.user, proposal.createdBy, proposal.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (!canTransitionProposal(proposal.status, parsed.data.status, request.user.role)) {
      return reply.status(422).send({
        error: `Cannot transition from '${proposal.status}' to '${parsed.data.status}' with role '${request.user.role}'`,
        code: "INVALID_TRANSITION",
      });
    }

    // A proposal with no content cannot be sent to a client.
    if (parsed.data.status === "sent" && proposal.currentVersion < 1) {
      return reply.status(422).send({
        error: "Proposal has no version snapshot — create a version before sending",
        code: "PROPOSAL_HAS_NO_VERSION",
      });
    }

    const now = new Date();
    const updateData: Record<string, unknown> = {
      status: parsed.data.status,
      updatedAt: now,
    };

    // sent_at coherence (DB CHECK proposals_sent_status_coherent): entering
    // "sent" stamps the send time; an admin-override jump into any other
    // post-send status backfills it so the row stays constraint-valid.
    if (parsed.data.status === "sent") {
      updateData["sentAt"] = now;
    } else if (
      proposal.sentAt === null &&
      (PROPOSAL_STATUSES_REQUIRING_SENT_AT as readonly string[]).includes(parsed.data.status)
    ) {
      updateData["sentAt"] = now;
    }

    // First send mints the client share code (the share-link identity).
    if (parsed.data.status === "sent" && proposal.shareCode === null) {
      updateData["shareCode"] = await generateUniqueShortCode(async (candidate) => {
        const [existing] = await db.select({ id: proposals.id })
          .from(proposals)
          .where(eq(proposals.shareCode, candidate))
          .limit(1);
        return existing !== undefined;
      });
    }

    const fromStatus = proposal.status;
    const [updated] = await db.update(proposals)
      .set(updateData)
      .where(eq(proposals.id, params.data.id))
      .returning();

    await db.insert(proposalStatusHistory).values({
      proposalId: params.data.id,
      fromStatus,
      toStatus: parsed.data.status,
      changedBy: request.user.id,
      note: parsed.data.note ?? null,
    });

    return { data: updated };
  });

  // GET /proposals/:id/history — status change history
  server.get("/:id/history", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.id, params.data.id), isNull(proposals.deletedAt)))
      .limit(1);
    if (proposal === undefined) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (!canAccessResource(request.user, proposal.createdBy, proposal.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const history = await db.select()
      .from(proposalStatusHistory)
      .where(eq(proposalStatusHistory.proposalId, params.data.id))
      .orderBy(proposalStatusHistory.createdAt);

    return { data: history };
  });

  // GET /proposals/:id/available-transitions — role-aware next statuses
  server.get("/:id/available-transitions", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.id, params.data.id), isNull(proposals.deletedAt)))
      .limit(1);
    if (proposal === undefined) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (!canAccessResource(request.user, proposal.createdBy, proposal.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    return { data: getAvailableProposalTransitions(proposal.status, request.user.role) };
  });

  // POST /proposals/:id/versions — immutable content snapshot (claim-guarded)
  server.post("/:id/versions", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }
    const parsed = ProposalVersionPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.id, params.data.id), isNull(proposals.deletedAt)))
      .limit(1);
    if (proposal === undefined) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (!canManageVenueProposals(request.user, proposal.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (request.user.role !== "admin" && !isProposalEditable(proposal.status as ProposalStatus)) {
      return reply.status(422).send({ error: "Proposal content is frozen in its current status", code: "NOT_EDITABLE" });
    }

    const sourceHash = proposalVersionPayloadDigest(parsed.data);

    // Atomically claim the next version number, then write the snapshot.
    // The unique (proposal_id, version) constraint backstops any race.
    const [claimed] = await db.update(proposals)
      .set({ currentVersion: sql`${proposals.currentVersion} + 1`, updatedAt: new Date() })
      .where(eq(proposals.id, params.data.id))
      .returning({ version: proposals.currentVersion });
    if (claimed === undefined) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }

    const [version] = await db.insert(proposalVersions).values({
      proposalId: params.data.id,
      version: claimed.version,
      payload: parsed.data,
      sourceHash,
      createdBy: request.user.id,
    }).returning();

    return reply.status(201).send({ data: version });
  });

  // GET /proposals/:id/versions/latest — newest snapshot
  server.get("/:id/versions/latest", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.id, params.data.id), isNull(proposals.deletedAt)))
      .limit(1);
    if (proposal === undefined) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (!canAccessResource(request.user, proposal.createdBy, proposal.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const [version] = await db.select().from(proposalVersions)
      .where(and(
        eq(proposalVersions.proposalId, params.data.id),
        eq(proposalVersions.version, proposal.currentVersion),
      ))
      .limit(1);
    if (version === undefined) {
      return reply.status(404).send({ error: "Proposal has no versions yet", code: "NOT_FOUND" });
    }

    return { data: version };
  });

  // GET /proposals/:id/versions/:version — specific snapshot
  server.get("/:id/versions/:version", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VersionParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid parameters", code: "VALIDATION_ERROR" });
    }

    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.id, params.data.id), isNull(proposals.deletedAt)))
      .limit(1);
    if (proposal === undefined) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (!canAccessResource(request.user, proposal.createdBy, proposal.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const [version] = await db.select().from(proposalVersions)
      .where(and(
        eq(proposalVersions.proposalId, params.data.id),
        eq(proposalVersions.version, params.data.version),
      ))
      .limit(1);
    if (version === undefined) {
      return reply.status(404).send({ error: "Version not found", code: "NOT_FOUND" });
    }

    return { data: version };
  });
}

// ---------------------------------------------------------------------------
// Public share-link route — registered under /public.
//
// No auth: the share code IS the capability. Only client-visible statuses
// resolve (drafts and withdrawn/archived proposals 404 — indistinguishable
// from a code that never existed). The response is the CLIENT-SAFE shape:
// payload content only, no internal IDs, no layout references, no internal
// status vocabulary beyond what the client themselves can act on.
// ---------------------------------------------------------------------------

const CLIENT_VISIBLE_STATUSES: readonly string[] = [
  "sent",
  "changes_requested",
  "accepted",
  "declined",
  "expired",
];

const ShareCodeParam = z.object({ shareCode: ShortCodeSchema });

export async function publicProposalRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // GET /public/proposals/:shareCode — client-safe proposal view
  server.get("/proposals/:shareCode", async (request, reply) => {
    const params = ShareCodeParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid share code", code: "VALIDATION_ERROR" });
    }

    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.shareCode, params.data.shareCode), isNull(proposals.deletedAt)))
      .limit(1);
    if (proposal === undefined || !CLIENT_VISIBLE_STATUSES.includes(proposal.status)) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }

    const [version] = await db.select().from(proposalVersions)
      .where(and(
        eq(proposalVersions.proposalId, proposal.id),
        eq(proposalVersions.version, proposal.currentVersion),
      ))
      .limit(1);
    if (version === undefined) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }

    const [venue] = await db.select({ name: venues.name }).from(venues)
      .where(eq(venues.id, proposal.venueId))
      .limit(1);

    const payload = ProposalVersionPayloadSchema.safeParse(version.payload);
    if (!payload.success) {
      // A stored payload that no longer parses is an internal integrity
      // problem — never leak partial content to a client surface.
      request.log.error({ proposalId: proposal.id, version: version.version }, "stored proposal version payload failed validation");
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }

    return {
      data: {
        title: payload.data.title,
        status: proposal.status,
        sentAt: proposal.sentAt,
        venueName: venue?.name ?? null,
        clientMessage: payload.data.clientMessage,
        capacityNote: payload.data.capacityNote,
        quote: payload.data.quote,
        version: version.version,
      },
    };
  });

  // POST /public/proposals/:shareCode/respond — client accept / request changes.
  //
  // The share code is the capability; the response runs the SAME state
  // machine as the authenticated transition route, under the "client" role
  // (sent → accepted | changes_requested only). History rows record
  // changedBy: null — an anonymous share-link response. A note travels into
  // proposal_status_history where venue staff read it via /:id/history.
  server.post("/proposals/:shareCode/respond", async (request, reply) => {
    const params = ShareCodeParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid share code", code: "VALIDATION_ERROR" });
    }
    const parsed = RespondBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.shareCode, params.data.shareCode), isNull(proposals.deletedAt)))
      .limit(1);
    if (proposal === undefined || !CLIENT_VISIBLE_STATUSES.includes(proposal.status)) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }

    const toStatus = RESPOND_ACTION_TO_STATUS[parsed.data.action];
    if (!canTransitionProposal(proposal.status, toStatus, "client")) {
      return reply.status(422).send({
        error: "This proposal is not awaiting a response",
        code: "INVALID_TRANSITION",
      });
    }

    const fromStatus = proposal.status;
    const [updated] = await db.update(proposals)
      .set({ status: toStatus, updatedAt: new Date() })
      .where(eq(proposals.id, proposal.id))
      .returning({ status: proposals.status });

    await db.insert(proposalStatusHistory).values({
      proposalId: proposal.id,
      fromStatus,
      toStatus,
      changedBy: null,
      note: parsed.data.note ?? null,
    });

    return { data: { status: updated?.status ?? toStatus } };
  });
}

const RespondBody = z.object({
  action: z.enum(["accept", "request_changes"]),
  note: z.string().max(1000).nullable().optional(),
});

const RESPOND_ACTION_TO_STATUS: Record<"accept" | "request_changes", ProposalStatus> = {
  accept: "accepted",
  request_changes: "changes_requested",
};
