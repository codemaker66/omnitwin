import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import {
  CreateProposalCommentSchema,
  EventPlanAudienceRoleSchema,
  ProposalVersionPayloadSchema,
  proposalVersionPayloadDigest,
  isProposalEditable,
  ShortCodeSchema,
  PROPOSAL_STATUSES_REQUIRING_SENT_AT,
  type EventPlanAudienceRole,
  type EventPlanChangeSurface,
  type ProposalVersionPayload,
  type ProposalStatus,
} from "@omnitwin/types";
import {
  proposals,
  proposalComments,
  proposalShareTokens,
  proposalVersions,
  proposalStatusHistory,
  packageSelections,
  eventConfigurationLinks,
  enquiries,
  configurations,
  events,
  handoffPacks,
  opportunities,
  venues,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, isPlatformAdmin, type JwtUser } from "../middleware/auth.js";
import { paginate } from "../utils/pagination.js";
import { canAccessResource } from "../utils/query.js";
import {
  PROPOSAL_STATES,
  canTransitionProposal,
  getAvailableProposalTransitions,
} from "../state-machines/proposal.js";
import { generateUniqueShortCode } from "../services/shortcode.js";
import { resolveProposalLayoutSnapshot } from "../services/proposal-layout-snapshot.js";
import { recordEventPlanChange } from "../services/event-plan-lifecycle.js";

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
  opportunityId: z.string().uuid().nullable().optional(),
  enquiryId: z.string().uuid().nullable().optional(),
  configurationId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
});

const UpdateProposalBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  opportunityId: z.string().uuid().nullable().optional(),
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

// Staff reply body reuses the claim-guarded comment-body schema from
// @omnitwin/types, so staff-to-client replies are SAFE by construction.
const StaffCommentBody = z.object({ body: CreateProposalCommentSchema.shape.body });

// Client-facing label for venue-team replies. The comment table has no
// authorUserId; staff comments are distinguished structurally by a null
// share_token_id, and present to the client under a single team identity.
const STAFF_REPLY_AUTHOR_NAME = "Venue team";

function boundedLifecycleSummary(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.length === 0) return "Proposal changed.";
  return trimmed.length <= 800 ? trimmed : `${trimmed.slice(0, 797)}...`;
}

/** Project a stored comment row into the staff timeline shape, deriving the
 *  author type from the structural share-token link (client posts carry one;
 *  staff replies do not). */
function toStaffCommentView(row: {
  id: string;
  kind: string;
  authorName: string | null;
  body: string;
  isClientVisible: boolean;
  shareTokenId: string | null;
  createdAt: Date;
}): {
  id: string;
  kind: string;
  authorType: "client" | "staff";
  authorName: string | null;
  body: string;
  isClientVisible: boolean;
  createdAt: Date;
} {
  return {
    id: row.id,
    kind: row.kind,
    authorType: row.shareTokenId === null ? "staff" : "client",
    authorName: row.authorName,
    body: row.body,
    isClientVisible: row.isClientVisible,
    createdAt: row.createdAt,
  };
}

type AuthedUser = Pick<JwtUser, "id" | "role" | "platformRole" | "venueId">;
type ProposalRow = typeof proposals.$inferSelect;

interface ProposalEventContext {
  readonly eventId: string;
  readonly venueId: string;
  readonly handoffPackId: string | null;
}

/** Create/mutate policy: admin anywhere, staff within their own venue. */
function canManageVenueProposals(user: AuthedUser, venueId: string): boolean {
  if (isPlatformAdmin(user)) return true;
  return user.role === "staff" && user.venueId === venueId;
}

async function loadProposalEventContext(db: Database, proposal: ProposalRow): Promise<ProposalEventContext | null> {
  if (proposal.configurationId === null) return null;

  const [linkedEvent] = await db
    .select({ eventId: events.id, venueId: events.venueId })
    .from(eventConfigurationLinks)
    .innerJoin(events, eq(eventConfigurationLinks.eventId, events.id))
    .where(and(
      eq(eventConfigurationLinks.configurationId, proposal.configurationId),
      eq(events.venueId, proposal.venueId),
      isNull(events.deletedAt),
    ))
    .limit(1);

  if (linkedEvent === undefined) return null;

  const [pack] = await db
    .select({ id: handoffPacks.id })
    .from(handoffPacks)
    .where(eq(handoffPacks.eventId, linkedEvent.eventId))
    .orderBy(desc(handoffPacks.compiledAt))
    .limit(1);

  return {
    eventId: linkedEvent.eventId,
    venueId: linkedEvent.venueId,
    handoffPackId: pack?.id ?? null,
  };
}

async function recordProposalLifecycleChange(
  db: Database,
  proposal: ProposalRow,
  input: {
    readonly actorUserId: string | null;
    readonly actorRole: EventPlanAudienceRole;
    readonly actorLabel: string;
    readonly sourceKind: "proposal" | "proposal_comment" | "proposal_response";
    readonly sourceId: string;
    readonly title: string;
    readonly summary: string;
    readonly affectedSurfaces: readonly EventPlanChangeSurface[];
    readonly includeHallkeeperWhenHandoffExists: boolean;
  },
): Promise<void> {
  const context = await loadProposalEventContext(db, proposal);
  if (context === null) return;

  const notifyHallkeeper = input.includeHallkeeperWhenHandoffExists && context.handoffPackId !== null;
  await recordEventPlanChange(db, {
    eventId: context.eventId,
    venueId: context.venueId,
    configurationId: proposal.configurationId,
    proposalId: proposal.id,
    handoffPackId: context.handoffPackId,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    actorLabel: input.actorLabel,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    title: input.title,
    summary: input.summary,
    affectedSurfaces: [...input.affectedSurfaces],
    audienceRoles: notifyHallkeeper ? ["staff", "hallkeeper"] : ["staff"],
    riskLevel: notifyHallkeeper ? "attention" : "info",
    requiresHallkeeperAcknowledgement: notifyHallkeeper,
    actionPath: notifyHallkeeper ? `/ops/events/${context.eventId}` : "/dashboard",
  });
}

function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

async function opportunityBelongsToVenue(db: Database, opportunityId: string, venueId: string): Promise<"ok" | "missing" | "mismatch"> {
  const [opportunity] = await db.select({ venueId: opportunities.venueId })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), isNull(opportunities.deletedAt)))
    .limit(1);
  if (opportunity === undefined) return "missing";
  return opportunity.venueId === venueId ? "ok" : "mismatch";
}

async function validateOptionalOpportunity(
  db: Database,
  opportunityId: string | null | undefined,
  venueId: string,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
): Promise<boolean> {
  if (opportunityId === undefined || opportunityId === null) return true;
  const status = await opportunityBelongsToVenue(db, opportunityId, venueId);
  if (status === "missing") {
    reply.status(404).send({ error: "Opportunity not found", code: "NOT_FOUND" });
    return false;
  }
  if (status === "mismatch") {
    reply.status(422).send({ error: "Opportunity belongs to a different venue", code: "VENUE_MISMATCH" });
    return false;
  }
  return true;
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

    if (isPlatformAdmin(user)) {
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
    const opportunityOk = await validateOptionalOpportunity(db, parsed.data.opportunityId, parsed.data.venueId, reply);
    if (!opportunityOk) return;

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
      opportunityId: parsed.data.opportunityId ?? null,
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
    if (!isPlatformAdmin(request.user) && !isProposalEditable(proposal.status as ProposalStatus)) {
      return reply.status(422).send({ error: "Proposal is not editable in its current status", code: "NOT_EDITABLE" });
    }

    // Linked records must stay venue-coherent.
    const opportunityOk = await validateOptionalOpportunity(db, parsed.data.opportunityId, proposal.venueId, reply);
    if (!opportunityOk) return;

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
    if (parsed.data.opportunityId !== undefined) updateData["opportunityId"] = parsed.data.opportunityId;
    if (parsed.data.enquiryId !== undefined) updateData["enquiryId"] = parsed.data.enquiryId;
    if (parsed.data.configurationId !== undefined) updateData["configurationId"] = parsed.data.configurationId;

    const [updated] = await db.update(proposals)
      .set(updateData)
      .where(eq(proposals.id, params.data.id))
      .returning();

    if (updated === undefined) {
      return reply.status(500).send({ error: "Failed to update proposal", code: "PROPOSAL_UPDATE_FAILED" });
    }

    const affectedSurfaces = new Set<EventPlanChangeSurface>(["proposal"]);
    if (parsed.data.configurationId !== undefined) affectedSurfaces.add("layout");
    await recordProposalLifecycleChange(db, updated, {
      actorUserId: request.user.id,
      actorRole: EventPlanAudienceRoleSchema.parse(request.user.role),
      actorLabel: request.user.email,
      sourceKind: "proposal",
      sourceId: updated.id,
      title: "Proposal updated",
      summary: `${updated.title} was updated by the venue team.`,
      affectedSurfaces: [...affectedSurfaces],
      includeHallkeeperWhenHandoffExists: parsed.data.configurationId !== undefined,
    });

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
    if (proposal.status === "accepted" && !isPlatformAdmin(request.user)) {
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

    if (updated !== undefined) {
      await recordProposalLifecycleChange(db, updated, {
        actorUserId: request.user.id,
        actorRole: EventPlanAudienceRoleSchema.parse(request.user.role),
        actorLabel: request.user.email,
        sourceKind: "proposal",
        sourceId: updated.id,
        title: "Proposal status changed",
        summary: `${updated.title} moved from ${fromStatus} to ${parsed.data.status}.`,
        affectedSurfaces: ["proposal"],
        includeHallkeeperWhenHandoffExists: parsed.data.status === "changes_requested",
      });
    }

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

  // GET /proposals/:id/comments — full conversation thread (staff view).
  //
  // Returns BOTH client posts (made through the share link) and staff
  // replies, in chronological order, so the dashboard timeline shows the
  // whole conversation. Author type is derived structurally from the
  // share-token link, not a stored flag.
  server.get("/:id/comments", { preHandler: [authenticate] }, async (request, reply) => {
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

    const rows = await db.select({
      id: proposalComments.id,
      kind: proposalComments.kind,
      authorName: proposalComments.authorName,
      body: proposalComments.body,
      isClientVisible: proposalComments.isClientVisible,
      shareTokenId: proposalComments.shareTokenId,
      createdAt: proposalComments.createdAt,
    }).from(proposalComments)
      .where(eq(proposalComments.proposalId, params.data.id))
      .orderBy(proposalComments.createdAt)
      .limit(200);

    return { data: rows.map(toStaffCommentView) };
  });

  // POST /proposals/:id/comments — staff reply to the client conversation.
  //
  // Claim-guarded (CreateProposalCommentSchema.shape.body) because the reply
  // is shown to the client. Stored with a null share_token_id (staff origin)
  // and client-visible so it appears on the share-link page.
  server.post("/:id/comments", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }
    const parsed = StaffCommentBody.safeParse(request.body);
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

    const [comment] = await db.insert(proposalComments).values({
      proposalId: proposal.id,
      shareTokenId: null,
      kind: "comment",
      authorName: STAFF_REPLY_AUTHOR_NAME,
      authorEmail: null,
      body: parsed.data.body,
      isClientVisible: true,
    }).returning();
    if (comment === undefined) {
      throw new Error("proposal comment insert returned no row");
    }

    return reply.status(201).send({ data: toStaffCommentView(comment) });
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

  // POST /proposals/:id/share-token — create a hashed client-share capability
  server.post("/:id/share-token", { preHandler: [authenticate] }, async (request, reply) => {
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
    if (proposal.currentVersion < 1) {
      return reply.status(422).send({
        error: "Create a proposal version before generating a client share link",
        code: "PROPOSAL_HAS_NO_VERSION",
      });
    }

    let token = generateShareToken();
    let tokenHash = hashShareToken(token);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [existing] = await db.select({ id: proposalShareTokens.id })
        .from(proposalShareTokens)
        .where(eq(proposalShareTokens.tokenHash, tokenHash))
        .limit(1);
      if (existing === undefined) break;
      token = generateShareToken();
      tokenHash = hashShareToken(token);
    }

    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [shareToken] = await tx.insert(proposalShareTokens).values({
        proposalId: proposal.id,
        tokenHash,
        tokenPrefix: token.slice(0, 8),
        createdBy: request.user.id,
      }).returning();
      if (shareToken === undefined) throw new Error("proposal share token insert returned no row");

      const updateData: Record<string, unknown> = { updatedAt: now };
      let toStatus = proposal.status;
      if (proposal.status === "draft" || proposal.status === "changes_requested") {
        toStatus = "sent";
        updateData["status"] = "sent";
        updateData["sentAt"] = proposal.sentAt ?? now;
      }
      if (proposal.shareCode === null) {
        updateData["shareCode"] = await generateUniqueShortCode(async (candidate) => {
          const [existing] = await tx.select({ id: proposals.id })
            .from(proposals)
            .where(eq(proposals.shareCode, candidate))
            .limit(1);
          return existing !== undefined;
        });
      }

      const [updated] = await tx.update(proposals)
        .set(updateData)
        .where(eq(proposals.id, proposal.id))
        .returning();
      if (updated === undefined) throw new Error("proposal update returned no row");

      if (toStatus !== proposal.status) {
        await tx.insert(proposalStatusHistory).values({
          proposalId: proposal.id,
          fromStatus: proposal.status,
          toStatus,
          changedBy: request.user.id,
          note: "Client share link generated",
        });
      }

      return { shareToken, proposal: updated };
    });

    return reply.status(201).send({
      data: {
        token,
        shareUrl: `/proposal-share/${token}`,
        tokenPrefix: result.shareToken.tokenPrefix,
        proposal: result.proposal,
      },
    });
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
    if (!isPlatformAdmin(request.user) && !isProposalEditable(proposal.status as ProposalStatus)) {
      return reply.status(422).send({ error: "Proposal content is frozen in its current status", code: "NOT_EDITABLE" });
    }

    // Capture an immutable, client-safe layout snapshot from the linked
    // configuration (T-427 phase 7). Server-authoritative geometry — any
    // client-supplied layoutSnapshot is ignored. Hashed with the rest of the
    // payload so the snapshot is part of the immutable version.
    let payload = parsed.data;
    if (proposal.configurationId !== null) {
      const snapshot = await resolveProposalLayoutSnapshot(db, proposal.configurationId);
      payload = { ...parsed.data, layoutSnapshot: snapshot };
    }

    const sourceHash = proposalVersionPayloadDigest(payload);

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
      payload,
      sourceHash,
      createdBy: request.user.id,
    }).returning();

    if (version !== undefined) {
      await recordProposalLifecycleChange(db, proposal, {
        actorUserId: request.user.id,
        actorRole: EventPlanAudienceRoleSchema.parse(request.user.role),
        actorLabel: request.user.email,
        sourceKind: "proposal",
        sourceId: version.id,
        title: "Proposal version created",
        summary: `Version ${String(version.version)} of ${proposal.title} was created for client review.`,
        affectedSurfaces: payload.layoutSnapshot === undefined || payload.layoutSnapshot === null
          ? ["proposal", "pricing"]
          : ["proposal", "pricing", "layout"],
        includeHallkeeperWhenHandoffExists: false,
      });
    }

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
const ShareTokenParam = z.object({
  token: z.string().min(32).max(96).regex(/^[A-Za-z0-9_-]+$/),
});

type ShareTokenRecord = typeof proposalShareTokens.$inferSelect;
type ProposalRecord = typeof proposals.$inferSelect;

interface ClientSafeProposalPayload {
  readonly title: string;
  readonly status: string;
  readonly sentAt: Date | null;
  readonly venueName: string | null;
  readonly clientMessage: string | null;
  readonly capacityNote: string | null;
  readonly roomSummary: string | null;
  readonly layoutSummary: string | null;
  readonly packageSummary: readonly string[];
  readonly quote: ProposalVersionPayload["quote"];
  readonly layoutSnapshot: ProposalVersionPayload["layoutSnapshot"];
  readonly version: number;
  readonly comments: readonly {
    readonly kind: string;
    readonly authorName: string | null;
    readonly body: string;
    readonly createdAt: Date;
  }[];
  readonly packages: readonly {
    readonly label: string;
    readonly quantity: number;
    readonly totalMinor: number;
    readonly status: string;
  }[];
}

async function resolveProposalShareToken(
  db: Database,
  token: string,
): Promise<{ shareToken: ShareTokenRecord; proposal: ProposalRecord } | null> {
  const tokenHash = hashShareToken(token);
  const [shareToken] = await db.select().from(proposalShareTokens)
    .where(eq(proposalShareTokens.tokenHash, tokenHash))
    .limit(1);
  if (shareToken === undefined) return null;
  if (shareToken.revokedAt !== null) return null;
  if (shareToken.expiresAt !== null && shareToken.expiresAt < new Date()) return null;

  const [proposal] = await db.select().from(proposals)
    .where(and(eq(proposals.id, shareToken.proposalId), isNull(proposals.deletedAt)))
    .limit(1);
  if (proposal === undefined || !CLIENT_VISIBLE_STATUSES.includes(proposal.status)) return null;
  return { shareToken, proposal };
}

async function buildClientSafeProposal(db: Database, proposal: ProposalRecord): Promise<ClientSafeProposalPayload | null> {
  const [version] = await db.select().from(proposalVersions)
    .where(and(
      eq(proposalVersions.proposalId, proposal.id),
      eq(proposalVersions.version, proposal.currentVersion),
    ))
    .limit(1);
  if (version === undefined) return null;

  const payload = ProposalVersionPayloadSchema.safeParse(version.payload);
  if (!payload.success) return null;

  const [venue] = await db.select({ name: venues.name }).from(venues)
    .where(eq(venues.id, proposal.venueId))
    .limit(1);

  const comments = await db.select({
    kind: proposalComments.kind,
    authorName: proposalComments.authorName,
    body: proposalComments.body,
    createdAt: proposalComments.createdAt,
  }).from(proposalComments)
    .where(and(eq(proposalComments.proposalId, proposal.id), eq(proposalComments.isClientVisible, true)))
    .orderBy(proposalComments.createdAt)
    .limit(100);

  const packages = await db.select({
    label: packageSelections.label,
    quantity: packageSelections.quantity,
    totalMinor: packageSelections.totalMinor,
    status: packageSelections.status,
  }).from(packageSelections)
    .where(and(eq(packageSelections.proposalId, proposal.id), eq(packageSelections.status, "included")))
    .orderBy(packageSelections.createdAt)
    .limit(50);

  return {
    title: payload.data.title,
    status: proposal.status,
    sentAt: proposal.sentAt,
    venueName: venue?.name ?? null,
    clientMessage: payload.data.clientMessage,
    capacityNote: payload.data.capacityNote,
    roomSummary: payload.data.roomSummary ?? null,
    layoutSummary: payload.data.layoutSummary ?? null,
    packageSummary: payload.data.packageSummary ?? [],
    quote: payload.data.quote,
    layoutSnapshot: payload.data.layoutSnapshot ?? null,
    version: version.version,
    comments,
    packages,
  };
}

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
        roomSummary: payload.data.roomSummary ?? null,
        layoutSummary: payload.data.layoutSummary ?? null,
        packageSummary: payload.data.packageSummary ?? [],
        quote: payload.data.quote,
        layoutSnapshot: payload.data.layoutSnapshot ?? null,
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

    await recordProposalLifecycleChange(db, proposal, {
      actorUserId: null,
      actorRole: "client",
      actorLabel: "Client",
      sourceKind: "proposal_response",
      sourceId: proposal.id,
      title: toStatus === "accepted" ? "Client approved proposal" : "Client requested proposal changes",
      summary: boundedLifecycleSummary(parsed.data.note ?? (
        toStatus === "accepted"
          ? "Client approved the proposal."
          : "Client requested changes to the proposal."
      )),
      affectedSurfaces: toStatus === "accepted" ? ["proposal"] : ["proposal", "comments"],
      includeHallkeeperWhenHandoffExists: toStatus === "changes_requested",
    });

    return { data: { status: updated?.status ?? toStatus } };
  });
}

export async function proposalShareRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.get("/:token", async (request, reply) => {
    const params = ShareTokenParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid share token", code: "VALIDATION_ERROR" });
    }

    const resolved = await resolveProposalShareToken(db, params.data.token);
    if (resolved === null) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }

    const clientSafe = await buildClientSafeProposal(db, resolved.proposal);
    if (clientSafe === null) {
      request.log.error({ proposalId: resolved.proposal.id }, "stored proposal payload failed client-safe build");
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }

    await db.update(proposalShareTokens)
      .set({ lastViewedAt: new Date() })
      .where(eq(proposalShareTokens.id, resolved.shareToken.id));

    return { data: clientSafe };
  });

  server.post("/:token/comment", async (request, reply) => {
    const params = ShareTokenParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid share token", code: "VALIDATION_ERROR" });
    }
    const parsed = CreateProposalCommentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const resolved = await resolveProposalShareToken(db, params.data.token);
    if (resolved === null) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (resolved.proposal.status !== "sent" && resolved.proposal.status !== "changes_requested") {
      return reply.status(422).send({ error: "This proposal is not awaiting comments", code: "NOT_AWAITING_RESPONSE" });
    }

    const kind = parsed.data.kind;
    const result = await db.transaction(async (tx) => {
      const [comment] = await tx.insert(proposalComments).values({
        proposalId: resolved.proposal.id,
        shareTokenId: resolved.shareToken.id,
        kind,
        authorName: parsed.data.authorName ?? null,
        authorEmail: parsed.data.authorEmail ?? null,
        body: parsed.data.body,
        isClientVisible: true,
      }).returning();
      if (comment === undefined) throw new Error("proposal comment insert returned no row");

      if (kind === "request_changes" && resolved.proposal.status === "sent") {
        await tx.update(proposals)
          .set({ status: "changes_requested", updatedAt: new Date() })
          .where(eq(proposals.id, resolved.proposal.id));
        await tx.insert(proposalStatusHistory).values({
          proposalId: resolved.proposal.id,
          fromStatus: "sent",
          toStatus: "changes_requested",
          changedBy: null,
          note: parsed.data.body,
        });
      }

      return comment;
    });

    await recordProposalLifecycleChange(db, resolved.proposal, {
      actorUserId: null,
      actorRole: "client",
      actorLabel: result.authorName ?? "Client",
      sourceKind: "proposal_comment",
      sourceId: result.id,
      title: kind === "request_changes" ? "Client requested proposal changes" : "Client commented on proposal",
      summary: boundedLifecycleSummary(result.body),
      affectedSurfaces: kind === "request_changes" ? ["proposal", "comments"] : ["comments"],
      includeHallkeeperWhenHandoffExists: kind === "request_changes",
    });

    return reply.status(201).send({
      data: {
        kind: result.kind,
        authorName: result.authorName,
        body: result.body,
        createdAt: result.createdAt,
      },
    });
  });

  server.post("/:token/approve", async (request, reply) => {
    const params = ShareTokenParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid share token", code: "VALIDATION_ERROR" });
    }
    const parsed = CreateProposalCommentSchema.partial({ body: true, kind: true }).safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const resolved = await resolveProposalShareToken(db, params.data.token);
    if (resolved === null) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (resolved.proposal.status === "accepted") {
      return { data: { status: "accepted" } };
    }
    if (!canTransitionProposal(resolved.proposal.status, "accepted", "client")) {
      return reply.status(422).send({ error: "This proposal is not awaiting approval", code: "NOT_AWAITING_RESPONSE" });
    }

    await db.transaction(async (tx) => {
      await tx.update(proposals)
        .set({ status: "accepted", updatedAt: new Date() })
        .where(eq(proposals.id, resolved.proposal.id));
      await tx.insert(proposalStatusHistory).values({
        proposalId: resolved.proposal.id,
        fromStatus: resolved.proposal.status,
        toStatus: "accepted",
        changedBy: null,
        note: parsed.data.body ?? "Client approved via share link",
      });
      await tx.insert(proposalComments).values({
        proposalId: resolved.proposal.id,
        shareTokenId: resolved.shareToken.id,
        kind: "approval_note",
        authorName: parsed.data.authorName ?? null,
        authorEmail: parsed.data.authorEmail ?? null,
        body: parsed.data.body ?? "Client approved the proposal.",
        isClientVisible: true,
      });
    });

    await recordProposalLifecycleChange(db, resolved.proposal, {
      actorUserId: null,
      actorRole: "client",
      actorLabel: parsed.data.authorName ?? "Client",
      sourceKind: "proposal_response",
      sourceId: resolved.proposal.id,
      title: "Client approved proposal",
      summary: boundedLifecycleSummary(parsed.data.body ?? "Client approved the proposal."),
      affectedSurfaces: ["proposal"],
      includeHallkeeperWhenHandoffExists: false,
    });

    return { data: { status: "accepted" } };
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
