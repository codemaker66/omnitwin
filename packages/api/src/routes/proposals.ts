import { createHash, randomBytes } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { eq, and, desc, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import {
  CreateProposalCommentSchema,
  toEventPlanAudienceRole,
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
  eventConfigurationLinks,
  enquiries,
  configurations,
  events,
  handoffPacks,
  opportunities,
  contacts,
  spaces,
  venues,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, isPlatformAdmin } from "../middleware/auth.js";
import { paginate } from "../utils/pagination.js";
import { canManageCommercial, roleReadsInternalEvents } from "../utils/query.js";
import {
  PROPOSAL_STATES,
  canTransitionProposal,
  getAvailableProposalTransitions,
} from "../state-machines/proposal.js";
import { generateUniqueShortCode } from "../services/shortcode.js";
import { resolveProposalLayoutSnapshot } from "../services/proposal-layout-snapshot.js";
import { patchLinkRequest, resolveProposalLinks, type ProposalLinkRefusal } from "../services/proposal-links.js";
import { recordEventPlanChange } from "../services/event-plan-lifecycle.js";
import { COMMERCIAL_AUDIENCE_ROLES, notifyCommercialTeam, notifyVenueRoles } from "../services/commercial-notifications.js";
import { clientAnswerNotice, proposalDeskPath } from "../services/client-answer-notice.js";
import { canRenderPersistedLayout } from "../services/layout-coordinate-space.js";
import { moveDealWithProposal } from "../services/deal-stage-from-proposal.js";

// ---------------------------------------------------------------------------
// Proposal routes — T-427 phase 2.
//
// Venue scoping: proposals are authored by the venue's commercial roles (staff,
// admin, manager, sales). Creation and mutation require the actor's own venue
// unless they hold the platform-admin role. Opening one proposal, and moving it
// where its state allows, takes the same: its venue's commercial roles, as its
// list, its desk and every change to it do. A proposal carries money, and
// hallkeepers never see prices (goal 18 6b); who made it grants nothing once
// they are not one of those roles there.
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

// The version a new one was written from (the desk's composer). With it, a
// save is refused when another was saved meanwhile, so no one's version is
// replaced unseen; without it (the editor's Share lens), a save goes on top.
const VersionBasisQuery = z.object({
  basedOn: z.string().regex(/^\d{1,9}$/u).transform(Number).optional(),
});

const ListQuery = z.object({
  status: z.enum(PROPOSAL_STATES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * A proposal with who it is for, their event's date, guests and occasion, and
 * what its latest version comes to. The deal, its contact and the enquiry
 * (the proposal's own, or its deal's) are read only at the proposal's own
 * venue, so another venue's names never reach a row.
 */
function selectDeskProposals(db: Pick<ProposalTransaction, "select">) {
  const enquiryId = sql`COALESCE(${proposals.enquiryId}, ${opportunities.sourceEnquiryId})`;
  // The figure that stands: the booker's latest while it is in hand, else the
  // version the client was sent (a version saved since is a draft).
  const latestQuote = (field: "totalMinor" | "currency") => sql`(
    SELECT ${proposalVersions.payload} -> 'quote' ->> ${field}
    FROM ${proposalVersions}
    WHERE ${proposalVersions.proposalId} = ${proposals.id}
      AND ${proposalVersions.version} = CASE WHEN ${proposals.status} IN ('draft', 'changes_requested')
        THEN ${proposals.currentVersion} ELSE COALESCE(${proposals.sentVersion}, ${proposals.currentVersion}) END)`;
  // The latest send: its stamp, or a move to "sent" recorded after it (a send
  // before sends were each stamped kept the first one's).
  const lastSentAt = sql`GREATEST(${proposals.sentAt}, (
    SELECT max(${proposalStatusHistory.createdAt}) FROM ${proposalStatusHistory}
    WHERE ${proposalStatusHistory.proposalId} = ${proposals.id} AND ${proposalStatusHistory.toStatus} = 'sent'))`;
  return db.select({
    ...getTableColumns(proposals),
    dealTitle: opportunities.title,
    clientName: sql<string | null>`COALESCE(${contacts.name}, ${enquiries.name})`,
    eventDate: sql<string | null>`COALESCE(${opportunities.preferredDate}, ${enquiries.preferredDate})::text`,
    guestCount: sql<number | null>`COALESCE(${opportunities.guestCount}, ${enquiries.estimatedGuests})`,
    eventType: sql<string | null>`COALESCE(${opportunities.eventType}, ${enquiries.eventType})`,
    // The room of the layout it carries: only a live layout in a live room at
    // its venue, so a removed one reads as none.
    layoutRoomName: sql<string | null>`(
      SELECT ${spaces.name} FROM ${configurations}
      INNER JOIN ${spaces} ON ${spaces.id} = ${configurations.spaceId}
      WHERE ${configurations.id} = ${proposals.configurationId}
        AND ${configurations.venueId} = ${proposals.venueId}
        AND ${configurations.deletedAt} IS NULL
        AND ${spaces.venueId} = ${proposals.venueId}
        AND ${spaces.deletedAt} IS NULL)`,
    // Whether that layout is the client's own, from their enquiry.
    layoutFromEnquiry: sql<boolean>`COALESCE(${proposals.configurationId} = ${enquiries.configurationId}, false)`,
    latestTotalMinor: sql<number | null>`(${latestQuote("totalMinor")})::int`,
    latestCurrency: sql<string | null>`${latestQuote("currency")}`,
    // When one of its links was last opened since it was last sent. The team
    // reads it through the preview, which never stamps; a link itself can be
    // opened by anyone it reaches, so this says the link was opened, not by
    // whom, and an open before the latest send does not count for it.
    linkOpenedAt: sql<string | null>`(
      SELECT to_char(max(${proposalShareTokens.lastViewedAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      FROM ${proposalShareTokens}
      WHERE ${proposalShareTokens.proposalId} = ${proposals.id}
        AND ${proposalShareTokens.lastViewedAt} >= ${lastSentAt})`,
    lastSentAt: sql<string | null>`to_char(${lastSentAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    // Whether any of its links is the kind that records being opened; one sent
    // only with the older share code has none.
    hasLink: sql<boolean>`EXISTS (SELECT 1 FROM ${proposalShareTokens} WHERE ${proposalShareTokens.proposalId} = ${proposals.id})`,
    // Whether the client's link still opens, as presentedStatus decides it.
    linkOpen: sql<boolean>`(${proposals.status} IN ('sent', 'changes_requested', 'accepted', 'declined', 'expired')
      OR (${proposals.status} = 'archived' AND COALESCE((
        SELECT ${proposalStatusHistory.fromStatus} FROM ${proposalStatusHistory}
        WHERE ${proposalStatusHistory.proposalId} = ${proposals.id} AND ${proposalStatusHistory.toStatus} = 'archived'
        ORDER BY ${proposalStatusHistory.createdAt} DESC LIMIT 1) = 'accepted', false)))`,
  })
    .from(proposals)
    .leftJoin(opportunities, and(
      eq(opportunities.id, proposals.opportunityId),
      eq(opportunities.venueId, proposals.venueId),
      isNull(opportunities.deletedAt),
    ))
    .leftJoin(contacts, and(
      eq(contacts.id, opportunities.primaryContactId),
      eq(contacts.venueId, proposals.venueId),
      isNull(contacts.deletedAt),
    ))
    .leftJoin(enquiries, and(eq(enquiries.id, enquiryId), eq(enquiries.venueId, proposals.venueId)));
}

/**
 * The Proposals desk's groups (roadmap X1), in the order a booker works them:
 * what the client sent back first, then their own drafts, then what is with
 * the client, then what was accepted, then what is closed.
 */
const DESK_GROUPS = {
  waiting: ["changes_requested"],
  drafts: ["draft"],
  with_client: ["sent"],
  accepted: ["accepted"],
  closed: ["declined", "withdrawn", "expired", "archived"],
} as const satisfies Record<string, readonly string[]>;
type DeskGroup = keyof typeof DESK_GROUPS;
const DESK_GROUP_NAMES = Object.keys(DESK_GROUPS) as [DeskGroup, ...DeskGroup[]];

const DeskQuery = z.object({
  group: z.enum(DESK_GROUP_NAMES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
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


type ProposalRow = typeof proposals.$inferSelect;

interface ProposalEventContext {
  readonly eventId: string;
  readonly venueId: string;
  readonly handoffPackId: string | null;
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

/**
 * A proposal's move moves its deal (services/deal-stage-from-proposal.ts):
 * sent to Proposal sent, changes asked for to Negotiation, accepted or
 * declined to won or lost. Like an announcement, a deal that cannot be moved
 * never fails the proposal's own change; it is logged.
 */
async function moveDealFor(
  db: Database,
  proposal: ProposalRow,
  toStatus: string,
  actorUserId: string | null,
  logger: FastifyBaseLogger,
): Promise<void> {
  try {
    // A send names the version sent; an answer, the version it was given on.
    const version = toStatus === "sent" ? proposal.currentVersion : sentVersionOf(proposal) ?? proposal.currentVersion;
    await moveDealWithProposal(db, { ...proposal, currentVersion: version }, toStatus, actorUserId);
  } catch (error) {
    logger.warn({ err: error, proposalId: proposal.id, toStatus }, "The deal did not move with its proposal");
  }
}

/**
 * Announce a proposal change to the people who need to know.
 *
 * EVERY call site invokes this AFTER its business write has committed, and the
 * whole body is failure-isolated: an announcement is downstream of the record,
 * never a condition of it. That matters concretely because the audience
 * vocabulary and the database disagree across a deploy boundary —
 * `COMMERCIAL_AUDIENCE_ROLES` grows to include `sales` the moment the roles
 * lane widens `USER_ROLES`, while the deployed CHECK constraints
 * (`event_plan_changes_audience_json_check` and
 * `event_plan_notifications_role_check`, migration 0042) still admit only the
 * original seven values until migration 0073 (the inventory lane's vocabulary
 * migration) widens them to ten. In that window every insert here raises
 * SQLSTATE 23514. Unwrapped, that turned a staff member saving a proposal
 * version into a 500.
 *
 * The long-term answer is the migration, not a narrower audience: this code
 * must not run against a database without 0073. The isolation below keeps the
 * failure proportionate meanwhile — and is correct in general, since no
 * announcement should ever be able to fail a save.
 */
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
    readonly logger: FastifyBaseLogger;
  },
): Promise<void> {
  // What was being written when it failed, so the log says what was lost.
  let writing = "all of it: the proposal's event could not be read";
  try {
    const context = await loadProposalEventContext(db, proposal);

    // No linked event means no operational change feed to write to — but for a
    // CLIENT action it must not mean silence either. A proposal without a
    // configuration is the ordinary case for a venue that quotes before it
    // lays anything out, and a client accepting one used to notify nobody.
    //
    // Only client-originated changes raise it: a staff member saving a version
    // or moving a status does not need telling what they just did.
    if (context === null) {
      if (input.sourceKind === "proposal") return;
      writing = "the team's notices";
      await notifyCommercialTeam(db, {
        venueId: proposal.venueId,
        title: input.title,
        body: input.summary,
        severity: input.sourceKind === "proposal_response" ? "attention" : "info",
        actionPath: proposalDeskPath(proposal.id),
      });
      return;
    }

    // The event's notices are only ever shown to roles that read internal
    // events. A role that works the pipeline but does not (sales) is told of
    // a client's answer below without the event, as on a proposal with none;
    // the team's own changes are not repeated to it.
    const eventReaders = COMMERCIAL_AUDIENCE_ROLES.filter((role) => roleReadsInternalEvents(role));
    const outsideEvents = COMMERCIAL_AUDIENCE_ROLES.filter((role) => !roleReadsInternalEvents(role));
    const notifyHallkeeper = input.includeHallkeeperWhenHandoffExists && context.handoffPackId !== null;
    writing = "all of it: the event's change, its notices and any copy for roles that do not read events";
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
      // The commercial audience that reads events (staff, venue admin,
      // manager) always hears; the hallkeeper is added only when there is a
      // handoff pack to disturb. Before this, only "staff" was notified, so a
      // venue admin watching the same proposal saw nothing.
      audienceRoles: notifyHallkeeper
        ? [...eventReaders, "hallkeeper"]
        : [...eventReaders],
      riskLevel: notifyHallkeeper ? "attention" : "info",
      requiresHallkeeperAcknowledgement: notifyHallkeeper,
      // The hallkeeper is taken to the event it disturbs; otherwise everyone
      // is taken to the proposal itself.
      actionPath: notifyHallkeeper ? `/ops/events/${context.eventId}` : proposalDeskPath(proposal.id),
    });

    if (input.sourceKind !== "proposal" && outsideEvents.length > 0) {
      writing = "only the copy for roles that do not read events; the event's change and notices were written";
      await notifyVenueRoles(db, {
        venueId: proposal.venueId,
        title: input.title,
        body: input.summary,
        severity: input.sourceKind === "proposal_response" ? "attention" : "info",
        actionPath: proposalDeskPath(proposal.id),
        audienceRoles: outsideEvents,
      });
    }
  } catch (err) {
    // Loud, with the ids needed to find the row that went unannounced, and
    // then swallowed: the business write is already committed and is the
    // record of truth. A reviewer seeing `proposal.lifecycle_announcement_failed`
    // in production should suspect a missing migration first.
    input.logger.error({
      event: "proposal.lifecycle_announcement_failed",
      proposalId: proposal.id,
      venueId: proposal.venueId,
      configurationId: proposal.configurationId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      lost: writing,
      error: err instanceof Error ? err.message : String(err),
    }, "proposal change committed but its announcement could not be written");
  }
}

function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

/** A refused set of links, as the routes answer it. */
function linkRefusalBody(refusal: ProposalLinkRefusal) {
  return refusal.field === undefined
    ? { error: refusal.error, code: refusal.code }
    : { error: refusal.error, code: refusal.code, details: { field: refusal.field } };
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

    // The venue's commercial roles see the venue's proposals, and a platform
    // admin every venue's. This must match the create and change gates below,
    // or a role could manage a proposal it cannot find in its own list. Anyone
    // else is refused, as on opening one: a proposal carries money, and who
    // made it grants nothing.
    if (isPlatformAdmin(user)) {
      // Every venue.
    } else if (user.venueId !== null && canManageCommercial(user, user.venueId)) {
      whereConditions.push(eq(proposals.venueId, user.venueId));
    } else {
      return reply.status(403).send({ error: "Only the venue commercial team can view proposals", code: "FORBIDDEN" });
    }

    const where = and(...whereConditions);

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(proposals)
      .where(where);
    const total = countResult?.count ?? 0;

    // Newest first with a total order (see enquiries.ts): `createdAt` ties are
    // broken by id so limit/offset paging cannot repeat or drop a row.
    const rows = await db.select()
      .from(proposals)
      .where(where)
      .limit(query.data.limit)
      .offset(query.data.offset)
      .orderBy(desc(proposals.createdAt), desc(proposals.id));

    return paginate(rows, total, { limit: query.data.limit, offset: query.data.offset });
  });

  // GET /proposals/desk — the Proposals desk's ledger (roadmap X1): grouped
  // as a booker works them, each row with who it is for, their event's date
  // and guests, and what its latest version comes to, and a count of every
  // status over the whole list, not the page. The same people see the same
  // proposals as GET /proposals.
  server.get("/desk", { preHandler: [authenticate] }, async (request, reply) => {
    const query = DeskQuery.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid query", code: "VALIDATION_ERROR", details: query.error.issues });
    }

    const user = request.user;
    const scope = [isNull(proposals.deletedAt)];
    if (isPlatformAdmin(user)) {
      // Every venue.
    } else if (user.venueId !== null && canManageCommercial(user, user.venueId)) {
      scope.push(eq(proposals.venueId, user.venueId));
    } else {
      return reply.status(403).send({ error: "Only the venue commercial team can view proposals", code: "FORBIDDEN" });
    }
    const where = and(...scope);
    const listed = query.data.group === undefined ? where : and(where, inArray(proposals.status, [...DESK_GROUPS[query.data.group]]));

    const statusRows = await db.select({ status: proposals.status, count: sql<number>`count(*)::int` })
      .from(proposals).where(where).groupBy(proposals.status);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(proposals).where(listed);

    const rank = sql`CASE
      WHEN ${proposals.status} = 'changes_requested' THEN 0
      WHEN ${proposals.status} = 'draft' THEN 1
      WHEN ${proposals.status} = 'sent' THEN 2
      WHEN ${proposals.status} = 'accepted' THEN 3
      ELSE 4 END`;
    const rows = await selectDeskProposals(db)
      .where(listed)
      .orderBy(sql`${rank}`, desc(proposals.updatedAt), desc(proposals.id))
      .limit(query.data.limit)
      .offset(query.data.offset);

    const statusCounts: Record<string, number> = {};
    for (const row of statusRows) statusCounts[row.status] = row.count;
    return {
      data: rows,
      meta: { total: countRow?.count ?? 0, limit: query.data.limit, offset: query.data.offset },
      statusCounts,
    };
  });

  // POST /proposals — venue staff/admin or platform admin creates a draft
  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateProposalBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    if (!canManageCommercial(request.user, parsed.data.venueId)) {
      return reply.status(403).send({ error: "Only venue staff or admin can create proposals for this venue", code: "FORBIDDEN" });
    }

    // The deal, the enquiry it came from and that enquiry's layout, worked
    // out here and checked against each other and the venue.
    const linked = await resolveProposalLinks(db, parsed.data.venueId, parsed.data);
    if (!linked.ok) return reply.status(linked.status).send(linkRefusalBody(linked));

    const [proposal] = await db.insert(proposals).values({
      venueId: parsed.data.venueId,
      ...linked.links,
      title: parsed.data.title,
      status: "draft",
      currentVersion: 0,
      createdBy: request.user.id,
    }).returning();

    return reply.status(201).send({ data: proposal });
  });

  // GET /proposals/:id — the venue's commercial roles
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
    if (!canManageCommercial(request.user, proposal.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    // With who it is for and what its latest version comes to, as its row on
    // the desk says, for a proposal opened from its address.
    const [withFacts] = await selectDeskProposals(db).where(eq(proposals.id, proposal.id)).limit(1);
    return { data: withFacts ?? proposal };
  });

  // GET /proposals/:id/preview — the proposal exactly as its client would
  // read it, for the venue team (roadmap X1). Never counted as the client
  // opening it: no link is used and nothing is stamped.
  server.get("/:id/preview", { preHandler: [authenticate] }, async (request, reply) => {
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
    // The venue's commercial team, as for sending it: prices are theirs to
    // read, not a hallkeeper's, and a colleague's proposal is the team's.
    if (!canManageCommercial(request.user, proposal.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (proposal.currentVersion < 1) {
      return reply.status(422).send({ error: "Save a version before previewing it", code: "PROPOSAL_HAS_NO_VERSION" });
    }
    // The latest version saved, as the client will see it once sent, beside
    // the version the client's link shows now and whether it still opens. The
    // sent version reads as the client's link presents it; a later one has
    // no standing of its own yet.
    const presented = await presentedStatus(db, proposal);
    const sent = proposal.sentVersion === proposal.currentVersion;
    const clientSafe = await buildClientSafeProposal(db, proposal, {
      version: proposal.currentVersion, status: sent ? presented ?? proposal.status : proposal.status,
    });
    if (clientSafe === null) {
      request.log.error({ proposalId: proposal.id }, "stored proposal payload failed client-safe build");
      return reply.status(422).send({ error: "Save a version before previewing it", code: "PROPOSAL_HAS_NO_VERSION" });
    }
    return { data: {
      ...clientSafe,
      accepted: sent ? clientSafe.accepted : null,
      sentVersion: proposal.sentVersion,
      linkOpen: presented !== null,
    } };
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
    if (!canManageCommercial(request.user, proposal.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (!isPlatformAdmin(request.user) && !isProposalEditable(proposal.status as ProposalStatus)) {
      return reply.status(422).send({ error: "Proposal is not editable in its current status", code: "NOT_EDITABLE" });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) updateData["title"] = parsed.data.title;
    // Links sent are laid over those stored and checked together; a title
    // alone reads and changes none of them.
    const linkRequest = patchLinkRequest(parsed.data, proposal);
    if (linkRequest !== null) {
      const linked = await resolveProposalLinks(db, proposal.venueId, linkRequest);
      if (!linked.ok) return reply.status(linked.status).send(linkRefusalBody(linked));
      Object.assign(updateData, linked.links);
    }

    const [updated] = await db.update(proposals)
      .set(updateData)
      .where(eq(proposals.id, params.data.id))
      .returning();

    if (updated === undefined) {
      return reply.status(500).send({ error: "Failed to update proposal", code: "PROPOSAL_UPDATE_FAILED" });
    }

    // The layout was touched when one was sent, or when the links worked out
    // to another.
    const layoutTouched = parsed.data.configurationId !== undefined || updated.configurationId !== proposal.configurationId;
    const affectedSurfaces = new Set<EventPlanChangeSurface>(["proposal"]);
    if (layoutTouched) affectedSurfaces.add("layout");
    await recordProposalLifecycleChange(db, updated, {
      actorUserId: request.user.id,
      actorRole: toEventPlanAudienceRole(request.user.role),
      actorLabel: request.user.email,
      sourceKind: "proposal",
      sourceId: updated.id,
      title: "Proposal updated",
      summary: `${updated.title} was updated by the venue team.`,
      affectedSurfaces: [...affectedSurfaces],
      includeHallkeeperWhenHandoffExists: layoutTouched,
      logger: request.log,
    });

    return { data: updated };
  });

  // DELETE /proposals/:id — soft delete; accepted proposals are locked (platform admin may override)
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
    if (!canManageCommercial(request.user, proposal.venueId)) {
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
    if (!canManageCommercial(request.user, proposal.venueId)) {
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
    // The move and its history commit together, and only from the status read
    // above: a client's answer that landed since then stands.
    const updated = await db.transaction(async (tx) => {
      const held = await holdProposal(tx, params.data.id);
      if (held?.status !== fromStatus) return null;
      // A send shows the client the version held here. The team marking it
      // accepted gives no name, so no earlier acceptance's name stands.
      // An answer is on the version the link shows, recorded if it was not.
      const answer = ANSWERED_STATUSES.includes(parsed.data.status) ? { sentVersion: sentVersionOf(held) } : {};
      const moved = parsed.data.status === "sent" ? { ...updateData, sentVersion: held.currentVersion }
        : parsed.data.status === "accepted" ? { ...updateData, ...answer, acceptedName: null }
        : { ...updateData, ...answer };
      const [row] = await tx.update(proposals)
        .set(moved)
        .where(eq(proposals.id, params.data.id))
        .returning();
      if (row === undefined) throw new Error("proposal update returned no row");
      await tx.insert(proposalStatusHistory).values({
        proposalId: params.data.id,
        fromStatus,
        toStatus: parsed.data.status,
        changedBy: request.user.id,
        note: parsed.data.note ?? null,
      });
      // Answered as its row on the desk now reads, read with the move: the
      // figure that stands and whether the client's link opens change with it.
      const [withFacts] = await selectDeskProposals(tx).where(eq(proposals.id, params.data.id)).limit(1);
      return withFacts ?? row;
    });
    if (updated === null) return reply.status(409).send(STATUS_CHANGED);

    await moveDealFor(db, updated, parsed.data.status, request.user.id, request.log);
    await recordProposalLifecycleChange(db, updated, {
      actorUserId: request.user.id,
      actorRole: toEventPlanAudienceRole(request.user.role),
      actorLabel: request.user.email,
      sourceKind: "proposal",
      sourceId: updated.id,
      title: "Proposal status changed",
      summary: `${updated.title} moved from ${fromStatus} to ${parsed.data.status}.`,
      affectedSurfaces: ["proposal"],
      includeHallkeeperWhenHandoffExists: parsed.data.status === "changes_requested",
      logger: request.log,
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
    if (!canManageCommercial(request.user, proposal.venueId)) {
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
    if (!canManageCommercial(request.user, proposal.venueId)) {
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
    if (!canManageCommercial(request.user, proposal.venueId)) {
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
    if (!canManageCommercial(request.user, proposal.venueId)) {
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
    const confirmed = ReadVersion.safeParse(request.body ?? {});
    if (!confirmed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: confirmed.error.issues });
    }

    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.id, params.data.id), isNull(proposals.deletedAt)))
      .limit(1);
    if (proposal === undefined) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (!canManageCommercial(request.user, proposal.venueId)) {
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
      // Sending moves the status; it moves only from the one read above, and
      // sends only the version the booker was asked about.
      const held = await holdProposal(tx, proposal.id);
      if (held?.status !== proposal.status) return "status" as const;
      if (confirmed.data.version !== undefined && confirmed.data.version !== held.currentVersion) return "version" as const;
      const [shareToken] = await tx.insert(proposalShareTokens).values({
        proposalId: proposal.id,
        tokenHash,
        tokenPrefix: token.slice(0, 8),
        createdBy: request.user.id,
      }).returning();
      if (shareToken === undefined) throw new Error("proposal share token insert returned no row");

      // What the client's link shows from now: the version held here. A
      // proposal already answered keeps showing the version that was.
      const answered = !["draft", "sent", "changes_requested"].includes(proposal.status);
      const updateData: Record<string, unknown> = answered
        ? { updatedAt: now }
        : { updatedAt: now, sentVersion: held.currentVersion };
      let toStatus = proposal.status;
      if (proposal.status === "draft" || proposal.status === "changes_requested") {
        toStatus = "sent";
        updateData["status"] = "sent";
        // Each send is stamped, so "sent 2 days ago" and "opened since"
        // speak of the latest one.
        updateData["sentAt"] = now;
      } else if (proposal.status === "sent" && sentVersionOf(held) !== held.currentVersion) {
        // A new link on a proposal already out sends a version saved since:
        // that too is a send.
        updateData["sentAt"] = now;
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

      // Answered as its row on the desk now reads, the send included.
      const [withFacts] = await selectDeskProposals(tx).where(eq(proposals.id, proposal.id)).limit(1);
      return { shareToken, proposal: withFacts ?? updated };
    });
    if (result === "status") return reply.status(409).send(STATUS_CHANGED);
    if (result === "version") return reply.status(409).send(VERSION_CHANGED);
    if (result.proposal.status !== proposal.status) {
      await moveDealFor(db, result.proposal, result.proposal.status, request.user.id, request.log);
    }

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
    const basis = VersionBasisQuery.safeParse(request.query);
    if (!basis.success) {
      return reply.status(400).send({ error: "Invalid query", code: "VALIDATION_ERROR", details: basis.error.issues });
    }
    const basedOn = basis.data.basedOn;

    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.id, params.data.id), isNull(proposals.deletedAt)))
      .limit(1);
    if (proposal === undefined) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (!canManageCommercial(request.user, proposal.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (!isPlatformAdmin(request.user) && !isProposalEditable(proposal.status as ProposalStatus)) {
      return reply.status(422).send({ error: "Proposal content is frozen in its current status", code: "NOT_EDITABLE" });
    }

    // The layout is the proposal's own, drawn by the server as it stands
    // (T-427 phase 7): the layout, its revision and its drawing are never the
    // browser's. With no layout linked the version has no drawing at all.
    // Hashed with the rest of the payload, so it is part of the version.
    const { layoutSnapshot: _sentSnapshot, ...content } = parsed.data;
    let payload: ProposalVersionPayload = { ...content, configurationId: proposal.configurationId, layoutRevision: null };
    if (proposal.configurationId !== null) {
      payload = { ...payload, layoutSnapshot: await resolveProposalLayoutSnapshot(db, proposal.configurationId, proposal.venueId) };
    }
    // The event it is for, as the venue holds it now, frozen with the
    // version: a later change to the deal never rewrites what a client was
    // sent or accepted. Server-authoritative; anything sent is ignored.
    payload = { ...payload, facts: await clientFacts(db, proposal) };

    const sourceHash = proposalVersionPayloadDigest(payload);

    // The head and snapshot commit together. Lock before rechecking editability
    // so a delayed request cannot create content after the proposal is frozen.
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(proposals)
        .where(and(eq(proposals.id, params.data.id), isNull(proposals.deletedAt)))
        .for("update");
      if (current === undefined) return "PROPOSAL_NOT_FOUND" as const;
      if (!canManageCommercial(request.user, current.venueId)) return "PROPOSAL_FORBIDDEN" as const;
      if (!isPlatformAdmin(request.user) && !isProposalEditable(current.status as ProposalStatus)) {
        return "PROPOSAL_NOT_EDITABLE" as const;
      }
      // The prepared version must still be the proposal's: its layout, and the
      // deal and enquiry its facts were read from.
      if (current.configurationId !== proposal.configurationId
        || current.opportunityId !== proposal.opportunityId
        || current.enquiryId !== proposal.enquiryId) return "PROPOSAL_CHANGED" as const;
      // Written from a version since followed by another: saving it on top
      // would replace a colleague's version without either of them knowing.
      if (basedOn !== undefined && current.currentVersion !== basedOn) return "VERSION_CHANGED" as const;

      const [claimed] = await tx.update(proposals)
        .set({ currentVersion: sql`${proposals.currentVersion} + 1`, updatedAt: new Date() })
        .where(eq(proposals.id, current.id))
        .returning({ version: proposals.currentVersion });
      if (claimed === undefined) throw new Error("Proposal version allocation returned no row");

      const [version] = await tx.insert(proposalVersions).values({
        proposalId: current.id,
        version: claimed.version,
        payload,
        sourceHash,
        createdBy: request.user.id,
      }).returning();
      if (version === undefined) throw new Error("Proposal version insert returned no row");
      return { version };
    });

    if (result === "PROPOSAL_NOT_FOUND") {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (result === "PROPOSAL_FORBIDDEN") {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (result === "PROPOSAL_NOT_EDITABLE") {
      return reply.status(422).send({ error: "Proposal content is frozen in its current status", code: "NOT_EDITABLE" });
    }
    if (result === "PROPOSAL_CHANGED") {
      return reply.status(409).send({ error: "The proposal's links changed; reload before saving a version", code: "REVISION_CONFLICT" });
    }
    if (result === "VERSION_CHANGED") return reply.status(409).send(VERSION_CHANGED);
    const { version } = result;

    if (version !== undefined) {
      await recordProposalLifecycleChange(db, proposal, {
        actorUserId: request.user.id,
        actorRole: toEventPlanAudienceRole(request.user.role),
        actorLabel: request.user.email,
        sourceKind: "proposal",
        sourceId: version.id,
        title: "Proposal version created",
        summary: `Version ${String(version.version)} of ${proposal.title} was created for client review.`,
        affectedSurfaces: payload.layoutSnapshot === undefined || payload.layoutSnapshot === null
          ? ["proposal", "pricing"]
          : ["proposal", "pricing", "layout"],
        includeHallkeeperWhenHandoffExists: false,
        logger: request.log,
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
    if (!canManageCommercial(request.user, proposal.venueId)) {
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
    if (!canManageCommercial(request.user, proposal.venueId)) {
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

/** The statuses a proposal takes when it is answered, by the client or for them. */
const ANSWERED_STATUSES: readonly string[] = ["accepted", "declined", "expired", "changes_requested"];

const CLIENT_VISIBLE_STATUSES: readonly string[] = [
  "sent",
  "changes_requested",
  "accepted",
  "declined",
  "expired",
];

const ShareCodeParam = z.object({ shareCode: ShortCodeSchema });

// ---------------------------------------------------------------------------
// Legacy share-code retirement
//
// `/proposal/:shareCode` predates the share-token page. A share code is a six
// character string printed in an email and never expires, while a share token
// is 32 random bytes, hashed at rest, mintable and revocable per recipient —
// so the token page is the one a client link should use.
//
// Retirement is a thirty-day window, not a switch: links already in clients'
// inboxes keep working until the sunset, and every response says so in its
// headers. After the sunset the code path answers 410 GONE with plain English
// telling the client to ask the venue for a current link, rather than the
// 404 that would read as "your proposal was deleted".
//
// The staff dashboard stopped handing out share-code URLs in the same change;
// `POST /proposals/:id/share-token` has always returned `/proposal-share/…`.
// ---------------------------------------------------------------------------

const DEFAULT_LEGACY_SHARE_CODE_SUNSET = "2026-10-18T00:00:00.000Z";

/** The instant the legacy share-code path stops serving. Overridable so the
 *  window can be extended without a deploy if clients are still on old links. */
export function legacyShareCodeSunset(): Date {
  const configured = (process.env["LEGACY_PROPOSAL_SHARE_CODE_SUNSET"] ?? "").trim();
  if (configured !== "") {
    const parsed = new Date(configured);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(DEFAULT_LEGACY_SHARE_CODE_SUNSET);
}

/**
 * Marks a legacy share-code response as deprecated and, once past the sunset,
 * answers 410. Returns true when the caller should stop.
 */
function refuseRetiredShareCode(reply: FastifyReply): boolean {
  const sunset = legacyShareCodeSunset();
  reply.header("Deprecation", "true");
  reply.header("Sunset", sunset.toUTCString());
  reply.header("Link", '</proposal-share/>; rel="successor-version"');
  if (Date.now() < sunset.getTime()) return false;
  void reply.status(410).send({
    error: "This proposal link has been retired. Ask the venue team for your current link.",
    code: "SHARE_CODE_RETIRED",
  });
  return true;
}
const ShareTokenParam = z.object({
  token: z.string().min(32).max(96).regex(/^[A-Za-z0-9_-]+$/),
});

type ShareTokenRecord = typeof proposalShareTokens.$inferSelect;
type ProposalRecord = typeof proposals.$inferSelect;
type ProposalTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The proposal's row, held until the transaction ends. Every move of a
 * proposal's status takes it first and compares it with the status the
 * request read, so an answer or a move that committed in between is never
 * written over: a client accepting while the team withdraws, or two presses
 * of Accept at once.
 */
async function holdProposal(tx: ProposalTransaction, id: string): Promise<ProposalRecord | undefined> {
  const [row] = await tx.select().from(proposals)
    .where(and(eq(proposals.id, id), isNull(proposals.deletedAt)))
    .for("update");
  return row;
}

const STATUS_CHANGED = {
  error: "The proposal changed while this was on its way. Reload it to see where it stands.",
  code: "PROPOSAL_STATUS_CHANGED",
} as const;

const VERSION_CHANGED = {
  error: "A newer version was saved or sent after this was read. Reload it to see it.",
  code: "PROPOSAL_VERSION_CHANGED",
} as const;

/** The version a person read when they acted: the booker confirming a send,
 *  the client answering. Optional, so a page from before it still works. */
const ReadVersion = z.object({ version: z.number().int().positive().optional() });

/** The event a proposal is for, as its client reads it. */
interface ClientFacts {
  readonly eventDate: string | null;
  readonly guestCount: number | null;
  readonly occasion: string | null;
  readonly roomName: string | null;
  readonly roomSlug: string | null;
}

const NO_FACTS: ClientFacts = { eventDate: null, guestCount: null, occasion: null, roomName: null, roomSlug: null };

interface ClientSafeProposalPayload {
  readonly title: string;
  readonly status: string;
  readonly sentAt: Date | null;
  readonly venueName: string | null;
  /** For the venue's own room photographs and the printed address. */
  readonly venueSlug: string | null;
  readonly venueAddress: string | null;
  /** When the version shown was saved. */
  readonly preparedAt: Date;
  readonly facts: ClientFacts;
  /** Who accepted it (the name given with the acceptance) and when. */
  readonly accepted: { readonly by: string | null; readonly at: Date } | null;
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
    /** The venue team's replies are written without a link. */
    readonly from: "venue" | "client";
  }[];
}

/**
 * The status a client's link presents. An accepted proposal the team has
 * since archived still reads as accepted: the client accepted it, and the
 * archive is the venue's own filing. Anything else not visible to a client
 * resolves to nothing.
 */
async function presentedStatus(db: Database, proposal: ProposalRecord): Promise<string | null> {
  if (CLIENT_VISIBLE_STATUSES.includes(proposal.status)) return proposal.status;
  if (proposal.status !== "archived") return null;
  const [last] = await db.select({ from: proposalStatusHistory.fromStatus }).from(proposalStatusHistory)
    .where(and(eq(proposalStatusHistory.proposalId, proposal.id), eq(proposalStatusHistory.toStatus, "archived")))
    .orderBy(desc(proposalStatusHistory.createdAt))
    .limit(1);
  return last?.from === "accepted" ? "accepted" : null;
}

async function resolveProposalShareToken(
  db: Database,
  token: string,
): Promise<{ shareToken: ShareTokenRecord; proposal: ProposalRecord; presented: string } | null> {
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
  if (proposal === undefined) return null;
  const presented = await presentedStatus(db, proposal);
  return presented === null ? null : { shareToken, proposal, presented };
}

/**
 * The event the proposal is for, told to its client: the date, how many are
 * coming, the occasion and the room. The room is the layout's, else the one
 * the guest chose on their enquiry; the rest is the deal's, else the
 * enquiry's. Everything is read at the proposal's own venue only.
 */
async function clientFacts(db: Database, proposal: ProposalRecord): Promise<ClientFacts> {
  const [deal] = proposal.opportunityId === null ? [] : await db.select({
    preferredDate: opportunities.preferredDate,
    guestCount: opportunities.guestCount,
    eventType: opportunities.eventType,
    sourceEnquiryId: opportunities.sourceEnquiryId,
  }).from(opportunities)
    .where(and(eq(opportunities.id, proposal.opportunityId), eq(opportunities.venueId, proposal.venueId), isNull(opportunities.deletedAt)))
    .limit(1);
  const enquiryId = proposal.enquiryId ?? deal?.sourceEnquiryId ?? null;
  const [enquiry] = enquiryId === null ? [] : await db.select({
    preferredDate: enquiries.preferredDate,
    estimatedGuests: enquiries.estimatedGuests,
    eventType: enquiries.eventType,
    spaceId: enquiries.spaceId,
    roomChosen: enquiries.roomChosen,
  }).from(enquiries)
    .where(and(eq(enquiries.id, enquiryId), eq(enquiries.venueId, proposal.venueId)))
    .limit(1);
  const [layoutRoom] = proposal.configurationId === null ? [] : await db.select({ name: spaces.name, slug: spaces.slug })
    .from(configurations)
    .innerJoin(spaces, eq(spaces.id, configurations.spaceId))
    .where(and(
      eq(configurations.id, proposal.configurationId),
      eq(configurations.venueId, proposal.venueId),
      isNull(configurations.deletedAt),
      eq(spaces.venueId, proposal.venueId),
      isNull(spaces.deletedAt),
    ))
    .limit(1);
  // An enquiry filed under a room the guest never chose names no room.
  const [enquiryRoom] = layoutRoom !== undefined || enquiry === undefined || !enquiry.roomChosen ? [] : await db.select({ name: spaces.name, slug: spaces.slug })
    .from(spaces)
    .where(and(eq(spaces.id, enquiry.spaceId), eq(spaces.venueId, proposal.venueId), isNull(spaces.deletedAt)))
    .limit(1);
  const room = layoutRoom ?? enquiryRoom ?? null;
  return {
    eventDate: deal?.preferredDate ?? enquiry?.preferredDate ?? null,
    guestCount: deal?.guestCount ?? enquiry?.estimatedGuests ?? null,
    occasion: deal?.eventType ?? enquiry?.eventType ?? null,
    roomName: room?.name ?? null,
    roomSlug: room?.slug ?? null,
  };
}

/** The version a client's link shows: the one last sent. A version saved
 *  since is the team's draft until it is sent. A proposal answered before
 *  any version was saved was shown none. */
function sentVersionOf(proposal: Pick<ProposalRecord, "sentVersion" | "currentVersion" | "status">): number | null {
  if (proposal.sentVersion !== null) return proposal.sentVersion;
  return proposal.status === "sent" && proposal.currentVersion >= 1 ? proposal.currentVersion : null;
}

async function buildClientSafeProposal(
  db: Database,
  proposal: ProposalRecord,
  options: { readonly version: number; readonly status: string },
): Promise<ClientSafeProposalPayload | null> {
  const [version] = await db.select().from(proposalVersions)
    .where(and(
      eq(proposalVersions.proposalId, proposal.id),
      eq(proposalVersions.version, options.version),
    ))
    .limit(1);
  if (version === undefined) return null;

  const payload = ProposalVersionPayloadSchema.safeParse(version.payload);
  if (!payload.success) return null;

  const [venue] = await db.select({ name: venues.name, slug: venues.slug, address: venues.address }).from(venues)
    .where(eq(venues.id, proposal.venueId))
    .limit(1);

  // The newest hundred, read in order: a long thread keeps its latest words.
  const newest = await db.select({
    kind: proposalComments.kind,
    authorName: proposalComments.authorName,
    body: proposalComments.body,
    createdAt: proposalComments.createdAt,
    shareTokenId: proposalComments.shareTokenId,
  }).from(proposalComments)
    .where(and(eq(proposalComments.proposalId, proposal.id), eq(proposalComments.isClientVisible, true)))
    .orderBy(desc(proposalComments.createdAt))
    .limit(100);
  const comments = newest.reverse().map(({ shareTokenId, ...comment }) => ({
    ...comment, from: shareTokenId === null ? "venue" as const : "client" as const,
  }));

  // Accepted: when, and the name given with the acceptance itself.
  const [acceptance] = options.status !== "accepted" ? [] : await db.select({ at: proposalStatusHistory.createdAt })
    .from(proposalStatusHistory)
    .where(and(eq(proposalStatusHistory.proposalId, proposal.id), eq(proposalStatusHistory.toStatus, "accepted")))
    .orderBy(desc(proposalStatusHistory.createdAt))
    .limit(1);

  return {
    title: payload.data.title,
    status: options.status,
    sentAt: proposal.sentAt,
    venueName: venue?.name ?? null,
    venueSlug: venue?.slug ?? null,
    venueAddress: venue?.address ?? null,
    preparedAt: version.createdAt,
    // As the venue held them when the version was saved; a version from
    // before facts were kept reads them as they are now.
    facts: payload.data.facts ?? await clientFacts(db, proposal),
    accepted: acceptance === undefined ? null : { by: proposal.acceptedName, at: acceptance.at },
    clientMessage: payload.data.clientMessage,
    capacityNote: payload.data.capacityNote,
    roomSummary: payload.data.roomSummary ?? null,
    layoutSummary: payload.data.layoutSummary ?? null,
    packageSummary: payload.data.packageSummary ?? [],
    quote: payload.data.quote,
    layoutSnapshot: canRenderPersistedLayout(version.coordinateSpace)
      ? (payload.data.layoutSnapshot ?? null)
      : null,
    version: version.version,
    comments,
  };
}

export async function publicProposalRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // GET /public/proposals/:shareCode — client-safe proposal view (LEGACY,
  // retiring; see legacyShareCodeSunset)
  server.get("/proposals/:shareCode", async (request, reply) => {
    if (refuseRetiredShareCode(reply)) return reply;
    const params = ShareCodeParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid share code", code: "VALIDATION_ERROR" });
    }

    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.shareCode, params.data.shareCode), isNull(proposals.deletedAt)))
      .limit(1);
    const presented = proposal === undefined ? null : await presentedStatus(db, proposal);
    if (proposal === undefined || presented === null) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }

    // The version the client was sent, never a draft saved since.
    const shown = sentVersionOf(proposal);
    const [version] = shown === null ? [] : await db.select().from(proposalVersions)
      .where(and(
        eq(proposalVersions.proposalId, proposal.id),
        eq(proposalVersions.version, shown),
      ))
      .limit(1);
    if (version === undefined) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }

    const [venue] = await db.select({ name: venues.name, slug: venues.slug, address: venues.address }).from(venues)
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
        status: presented,
        sentAt: proposal.sentAt,
        venueName: venue?.name ?? null,
        venueSlug: venue?.slug ?? null,
        venueAddress: venue?.address ?? null,
        preparedAt: version.createdAt,
        // A six-character code is not a link to trust with the event's
        // particulars; the share-token page tells them.
        facts: NO_FACTS,
        accepted: null,
        clientMessage: payload.data.clientMessage,
        capacityNote: payload.data.capacityNote,
        roomSummary: payload.data.roomSummary ?? null,
        layoutSummary: payload.data.layoutSummary ?? null,
        packageSummary: payload.data.packageSummary ?? [],
        quote: payload.data.quote,
        layoutSnapshot: canRenderPersistedLayout(version.coordinateSpace)
          ? (payload.data.layoutSnapshot ?? null)
          : null,
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
    if (refuseRetiredShareCode(reply)) return reply;
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
    // The answer and its history commit together, and only while the
    // proposal still stands as it was read, on the version the client read.
    const outcome = await db.transaction(async (tx) => {
      const held = await holdProposal(tx, proposal.id);
      if (held === undefined || held.status !== fromStatus) return "changed" as const;
      if (parsed.data.version !== undefined && parsed.data.version !== sentVersionOf(held)) return "version" as const;
      const [row] = await tx.update(proposals)
        // This path takes no name, so no earlier acceptance's name stands.
        // The answer is on the version the link shows, recorded if it was not.
        .set(toStatus === "accepted"
          ? { status: toStatus, acceptedName: null, sentVersion: sentVersionOf(held), updatedAt: new Date() }
          : { status: toStatus, sentVersion: sentVersionOf(held), updatedAt: new Date() })
        .where(eq(proposals.id, proposal.id))
        .returning({ status: proposals.status, sentVersion: proposals.sentVersion });
      await tx.insert(proposalStatusHistory).values({
        proposalId: proposal.id,
        fromStatus,
        toStatus,
        changedBy: null,
        note: parsed.data.note ?? null,
      });
      return row ?? ("changed" as const);
    });
    if (outcome === "changed") return reply.status(409).send(STATUS_CHANGED);
    if (outcome === "version") return reply.status(409).send(VERSION_CHANGED);
    const updated = outcome;
    await moveDealFor(db, proposal, toStatus, null, request.log);

    // This path takes no name.
    const notice = clientAnswerNotice({
      act: toStatus === "accepted" ? "accepted" : "changes",
      proposalTitle: proposal.title,
      version: updated.sentVersion,
      name: null,
      words: parsed.data.note,
    });
    await recordProposalLifecycleChange(db, proposal, {
      actorUserId: null,
      actorRole: "client",
      actorLabel: notice.actorLabel,
      sourceKind: "proposal_response",
      sourceId: proposal.id,
      title: notice.title,
      summary: boundedLifecycleSummary(notice.summary),
      affectedSurfaces: toStatus === "accepted" ? ["proposal"] : ["proposal", "comments"],
      includeHallkeeperWhenHandoffExists: toStatus === "changes_requested",
      logger: request.log,
    });

    return { data: { status: updated.status } };
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

    // Answered before any version was saved: there is nothing it was shown.
    const shown = sentVersionOf(resolved.proposal);
    if (shown === null) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    const clientSafe = await buildClientSafeProposal(db, resolved.proposal, {
      version: shown, status: resolved.presented,
    });
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
    const parsed = CreateProposalCommentSchema.merge(ReadVersion).safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    // An acceptance is written only by accepting (POST /:token/approve), so
    // nobody holding a link can put a name to an acceptance with a comment.
    if (parsed.data.kind === "approval_note") {
      return reply.status(400).send({ error: "Accept the proposal to approve it", code: "VALIDATION_ERROR" });
    }

    const resolved = await resolveProposalShareToken(db, params.data.token);
    if (resolved === null) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (resolved.proposal.status !== "sent" && resolved.proposal.status !== "changes_requested") {
      return reply.status(422).send({ error: "This proposal is not awaiting comments", code: "NOT_AWAITING_RESPONSE" });
    }

    const kind = parsed.data.kind;
    const read = resolved.proposal.status;
    const result = await db.transaction(async (tx) => {
      // Held first: nothing is kept against a proposal withdrawn since the
      // read. A second request for changes at once is kept as it would have
      // been a moment later, without moving the proposal again.
      const held = await holdProposal(tx, resolved.proposal.id);
      const current = held?.status ?? null;
      if (current !== read && !(kind === "request_changes" && read === "sent" && current === "changes_requested")) {
        return "changed" as const;
      }
      // A change request is about the version the client read: one made on a
      // version since replaced is refused, whether or not changes were
      // already asked for on the newer one.
      if (kind === "request_changes" && held !== undefined
        && parsed.data.version !== undefined && parsed.data.version !== sentVersionOf(held)) {
        return "version" as const;
      }
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

      const moves = kind === "request_changes" && current === "sent";
      if (moves) {
        await tx.update(proposals)
          // On the version the link shows, recorded if it was not.
          .set({ status: "changes_requested", sentVersion: held === undefined ? null : sentVersionOf(held), updatedAt: new Date() })
          .where(eq(proposals.id, resolved.proposal.id));
        await tx.insert(proposalStatusHistory).values({
          proposalId: resolved.proposal.id,
          fromStatus: "sent",
          toStatus: "changes_requested",
          changedBy: null,
          note: parsed.data.body,
        });
      }

      // A question is never refused. It names the version the client was
      // reading when their link has shown it, else the one the link shows.
      const shows = held === undefined ? null : sentVersionOf(held);
      const reading = parsed.data.version;
      const version = kind === "comment" && reading !== undefined && shows !== null && reading <= shows ? reading : shows;
      return { comment, moved: moves, version };
    });
    if (result === "changed") return reply.status(409).send(STATUS_CHANGED);
    if (result === "version") return reply.status(409).send(VERSION_CHANGED);
    const { comment } = result;
    if (result.moved) {
      await moveDealFor(db, resolved.proposal, "changes_requested", null, request.log);
    }

    const notice = clientAnswerNotice({
      act: kind === "request_changes" ? "changes" : "comment",
      proposalTitle: resolved.proposal.title,
      version: result.version,
      name: comment.authorName,
      words: comment.body,
    });
    await recordProposalLifecycleChange(db, resolved.proposal, {
      actorUserId: null,
      actorRole: "client",
      actorLabel: notice.actorLabel,
      sourceKind: "proposal_comment",
      sourceId: comment.id,
      title: notice.title,
      summary: boundedLifecycleSummary(notice.summary),
      affectedSurfaces: kind === "request_changes" ? ["proposal", "comments"] : ["comments"],
      includeHallkeeperWhenHandoffExists: kind === "request_changes",
      logger: request.log,
    });

    return reply.status(201).send({
      data: {
        kind: comment.kind,
        authorName: comment.authorName,
        body: comment.body,
        createdAt: comment.createdAt,
      },
    });
  });

  server.post("/:token/approve", async (request, reply) => {
    const params = ShareTokenParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid share token", code: "VALIDATION_ERROR" });
    }
    const parsed = CreateProposalCommentSchema.partial({ body: true, kind: true }).merge(ReadVersion).safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const resolved = await resolveProposalShareToken(db, params.data.token);
    if (resolved === null) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    // Only the version the client read: a newer one sent since is theirs to
    // read before it can be accepted, even when someone has accepted it.
    const read = parsed.data.version;
    if (resolved.presented === "accepted") {
      if (read !== undefined && read !== sentVersionOf(resolved.proposal)) return reply.status(409).send(VERSION_CHANGED);
      return { data: { status: "accepted", already: true } };
    }
    if (!canTransitionProposal(resolved.proposal.status, "accepted", "client")) {
      return reply.status(422).send({ error: "This proposal is not awaiting approval", code: "NOT_AWAITING_RESPONSE" });
    }

    const outcome = await db.transaction(async (tx) => {
      // Held first. A second press of Accept on the same version that
      // arrives with the first is answered as the first was, and recorded
      // once; anything else that landed since the read (a withdrawal) stands.
      const held = await holdProposal(tx, resolved.proposal.id);
      if (held === undefined) return "changed" as const;
      if (read !== undefined && read !== sentVersionOf(held)) return "version" as const;
      if (held.status === "accepted") return "already" as const;
      if (held.status !== resolved.proposal.status) return "changed" as const;
      const name = parsed.data.authorName?.trim() ?? "";
      await tx.update(proposals)
        .set({ status: "accepted", acceptedName: name === "" ? null : name, sentVersion: sentVersionOf(held), updatedAt: new Date() })
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
      return { accepted: sentVersionOf(held) };
    });
    if (outcome === "already") return { data: { status: "accepted", already: true } };
    if (outcome === "changed") return reply.status(409).send(STATUS_CHANGED);
    if (outcome === "version") return reply.status(409).send(VERSION_CHANGED);
    await moveDealFor(db, resolved.proposal, "accepted", null, request.log);

    // Only what the client wrote: the note kept without one is not their words.
    const notice = clientAnswerNotice({
      act: "accepted",
      proposalTitle: resolved.proposal.title,
      version: outcome.accepted,
      name: parsed.data.authorName,
      words: parsed.data.body,
    });
    await recordProposalLifecycleChange(db, resolved.proposal, {
      actorUserId: null,
      actorRole: "client",
      actorLabel: notice.actorLabel,
      sourceKind: "proposal_response",
      sourceId: resolved.proposal.id,
      title: notice.title,
      summary: boundedLifecycleSummary(notice.summary),
      affectedSurfaces: ["proposal"],
      includeHallkeeperWhenHandoffExists: false,
      logger: request.log,
    });

    return { data: { status: "accepted" } };
  });
}

const RespondBody = z.object({
  action: z.enum(["accept", "request_changes"]),
  note: z.string().max(1000).nullable().optional(),
}).merge(ReadVersion);

const RESPOND_ACTION_TO_STATUS: Record<"accept" | "request_changes", ProposalStatus> = {
  accept: "accepted",
  request_changes: "changes_requested",
};
