import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, desc, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import {
  ENQUIRY_FUNNEL_FIELDS,
  ENQUIRY_REPLY_ALARM_DEFAULT_HOURS,
  ENQUIRY_REPLY_ALARM_FROM,
  ENQUIRY_REPLY_ALARM_LIST_LIMIT,
  ENQUIRY_REPLY_AWAITING_STATES,
  FIRST_RESPONSE_BACKDATING_ROLES,
  FIRST_RESPONSE_FUTURE_SKEW_MS,
  FIRST_RESPONSE_REPORT_WINDOW_DAYS,
  NON_BOOKING_ENQUIRY_TYPES,
  RecordFirstResponseSchema,
  type RecordFirstResponseResult,
  type ReplyAlarm,
} from "@omnitwin/types";
import { enquiries, enquiryStatusHistory, configurations, generalAuditLog, pricingRules, spaces, users, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, isPlatformAdmin, type JwtUser } from "../middleware/auth.js";
import { paginate } from "../utils/pagination.js";
import { canAccessResource, canManageCommercial, canManageVenue, isVenueCommercialMember } from "../utils/query.js";
import { canTransition, enquiryKind, ENQUIRY_STATES, isCustomerMove } from "../state-machines/enquiry.js";
import { calculatePrice, type PricingRuleInput } from "../services/price-calculator.js";
import { sendEmailAsync } from "../services/email.js";
import { enquiryApproved, enquiryRejected } from "../services/email-templates.js";
import { lockFirstResponse, stampFirstResponse } from "../services/enquiry-funnel.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const IdParam = z.object({ id: z.uuid() });

const CreateEnquiryBody = z.object({
  configurationId: z.uuid(),
  venueId: z.uuid(),
  spaceId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().check(z.email()).max(255),
  eventType: z.string().trim().max(100).nullable().optional(),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  estimatedGuests: z.number().int().nonnegative().nullable().optional(),
  message: z.string().max(2000).nullable().optional(),
});

const UpdateEnquiryBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().check(z.email()).max(255).optional(),
  eventType: z.string().trim().max(100).nullable().optional(),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  estimatedGuests: z.number().int().nonnegative().nullable().optional(),
  message: z.string().max(2000).nullable().optional(),
});

const TransitionBody = z.object({
  status: z.enum(ENQUIRY_STATES),
  note: z.string().max(1000).nullable().optional(),
  /** The status the person decided from, as their screen showed it. A move
   *  from any other is refused: a screen read before a colleague's decision
   *  never decides the enquiry again. */
  from: z.enum(ENQUIRY_STATES).optional(),
});

/** Refused because the enquiry moved on after the screen deciding it read it. */
const ENQUIRY_STATUS_CHANGED = {
  error: "The enquiry changed after this screen read it, so nothing was done. Reload it to see where it stands.",
  code: "ENQUIRY_STATUS_CHANGED",
} as const;

// `states` (comma-separated) and `order=created_desc` let one bounded page
// hold exactly the states a caller shows, newest first — the Diary tray.
// The staff dashboard pages the same order with limit/offset. `venueId`
// only narrows the caller's existing scope. Without these parameters the
// list keeps its original contract: every visible state, least recently
// updated first, 20 per page. `meta.order` echoes the order applied; an API
// that predates `order` strips the parameter and omits the echo.
const ENQUIRY_LIST_ORDERS = ["updated_asc", "created_desc"] as const;

const EnquiryStatesParam = z.string()
  .transform((value) => [...new Set(value.split(","))])
  .pipe(z.array(z.enum(ENQUIRY_STATES)).min(1).max(ENQUIRY_STATES.length));

const StatusFilterQuery = z.object({
  status: z.enum(ENQUIRY_STATES).optional(),
  states: EnquiryStatesParam.optional(),
  order: z.enum(ENQUIRY_LIST_ORDERS).default("updated_asc"),
  venueId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).refine((query) => query.status === undefined || query.states === undefined, {
  message: "Use either status or states, not both",
  path: ["states"],
});

/**
 * Who may open an enquiry, read its timeline and move it: its
 * owner, or anyone the venue inbox admits for its venue (the floor, and the
 * commercial roles that own the pipeline). Kept equal to the list's scope, so
 * a role that can list an enquiry can open and move it; sales could list the
 * inbox and was then refused each enquiry in it.
 */
function canWorkEnquiry(user: JwtUser, enquiry: { readonly userId: string | null; readonly venueId: string }): boolean {
  return canAccessResource(user, enquiry.userId, enquiry.venueId) || canManageCommercial(user, enquiry.venueId);
}

type EnquiryRow = typeof enquiries.$inferSelect;
type CustomerEnquiry = Omit<EnquiryRow, (typeof ENQUIRY_FUNNEL_FIELDS)[number]>;

const FUNNEL_FIELDS: ReadonlySet<string> = new Set(ENQUIRY_FUNNEL_FIELDS);

/**
 * An enquiry as its reader may see it. When and how the venue first replied,
 * and where the person was found, are the venue's own measurements (migration
 * 0100): its team and Venviewer's admins read the whole row, and the
 * enquiry's customer reads it without them.
 */
function asSeenBy(user: JwtUser, row: EnquiryRow): EnquiryRow | CustomerEnquiry {
  if (isPlatformAdmin(user) || canManageVenue(user, row.venueId) || canManageCommercial(user, row.venueId)) return row;
  return Object.fromEntries(Object.entries(row).filter(([field]) => !FUNNEL_FIELDS.has(field))) as CustomerEnquiry;
}

/** Who may date a reported reply further back than the report window. */
const BACKDATING_ROLES: ReadonlySet<string> = new Set(FIRST_RESPONSE_BACKDATING_ROLES);
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function enquiryRoutes(
  server: FastifyInstance,
  opts: {
    db: Database;
    /** The first arrival the reply-time alarm flags; tests move it, since the
     *  default (ENQUIRY_REPLY_ALARM_FROM) is a fixed date. */
    replyAlarmFrom?: string;
  },
): Promise<void> {
  const { db } = opts;
  const replyAlarmFrom = opts.replyAlarmFrom ?? ENQUIRY_REPLY_ALARM_FROM;

  // GET /enquiries — authenticated, role-filtered, paginated
  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const query = StatusFilterQuery.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid query", code: "VALIDATION_ERROR", details: query.error.issues });
    }

    const user = request.user;
    const whereConditions = [];

    if (query.data.status !== undefined) {
      whereConditions.push(eq(enquiries.state, query.data.status));
    }
    if (query.data.states !== undefined) {
      whereConditions.push(inArray(enquiries.state, query.data.states));
    }
    // A filter, never a grant: it is ANDed with the caller's scope below.
    if (query.data.venueId !== undefined) {
      whereConditions.push(eq(enquiries.venueId, query.data.venueId));
    }

    // The venue inbox is read by everyone who works the venue's day
    // (canManageVenue, which keeps the hallkeeper read pinned by
    // enquiry-inbox-authority.test.ts) plus the commercial roles that own the
    // pipeline. Decision 6b takes the hallkeeper's edit on venue, spaces and
    // pricing — not this read. Everyone else sees only their own enquiries.
    if (isPlatformAdmin(user)) {
      // Admin sees all
    } else if (user.venueId !== null
      && (canManageVenue(user, user.venueId) || canManageCommercial(user, user.venueId))) {
      whereConditions.push(eq(enquiries.venueId, user.venueId));
    } else {
      whereConditions.push(eq(enquiries.userId, user.id));
    }

    const where = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(enquiries)
      .where(where);

    const total = countResult?.count ?? 0;

    const rows = await db.select()
      .from(enquiries)
      .where(where)
      .limit(query.data.limit)
      .offset(query.data.offset)
      .orderBy(...(query.data.order === "created_desc"
        ? [desc(enquiries.createdAt), desc(enquiries.id)]
        : [enquiries.updatedAt]));

    const page = paginate(rows.map((row) => asSeenBy(user, row)), total, { limit: query.data.limit, offset: query.data.offset });
    return { ...page, meta: { ...page.meta, order: query.data.order } };
  });

  // GET /enquiries/:id — authenticated, owner/hallkeeper/admin
  server.get("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const [enquiry] = await db.select().from(enquiries)
      .where(eq(enquiries.id, params.data.id))
      .limit(1);

    if (enquiry === undefined) {
      return reply.status(404).send({ error: "Enquiry not found", code: "NOT_FOUND" });
    }

    if (!canWorkEnquiry(request.user, enquiry)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    return { data: asSeenBy(request.user, enquiry) };
  });

  // POST /enquiries — authenticated, create enquiry linked to configuration
  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateEnquiryBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Verify configuration exists and belongs to the user (or admin)
    const [config] = await db.select({
      userId: configurations.userId,
      venueId: configurations.venueId,
      spaceId: configurations.spaceId,
    })
      .from(configurations)
      .where(and(eq(configurations.id, parsed.data.configurationId), isNull(configurations.deletedAt)))
      .limit(1);

    if (config === undefined) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (config.userId !== request.user.id && !isPlatformAdmin(request.user)) {
      return reply.status(403).send({ error: "Configuration does not belong to you", code: "FORBIDDEN" });
    }

    // Derive venueId/spaceId from the verified configuration (don't trust client-supplied values)
    const [enquiry] = await db.insert(enquiries).values({
      configurationId: parsed.data.configurationId,
      venueId: config.venueId,
      spaceId: config.spaceId,
      userId: request.user.id,
      name: parsed.data.name,
      email: parsed.data.email,
      eventType: parsed.data.eventType ?? null,
      preferredDate: parsed.data.preferredDate ?? null,
      estimatedGuests: parsed.data.estimatedGuests ?? null,
      message: parsed.data.message ?? null,
      state: "draft",
    }).returning();

    return reply.status(201).send({ data: enquiry === undefined ? enquiry : asSeenBy(request.user, enquiry) });
  });

  // PATCH /enquiries/:id — owner (if draft) or admin
  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const parsed = UpdateEnquiryBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [enquiry] = await db.select().from(enquiries)
      .where(eq(enquiries.id, params.data.id))
      .limit(1);

    if (enquiry === undefined) {
      return reply.status(404).send({ error: "Enquiry not found", code: "NOT_FOUND" });
    }

    // Owner can only edit in draft state. Platform admin can edit anytime.
    if (!isPlatformAdmin(request.user)) {
      if (enquiry.userId !== request.user.id) {
        return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
      }
      if (enquiry.state !== "draft") {
        return reply.status(403).send({ error: "Can only edit draft enquiries", code: "FORBIDDEN" });
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updateData["name"] = parsed.data.name;
    if (parsed.data.email !== undefined) updateData["email"] = parsed.data.email;
    if (parsed.data.eventType !== undefined) updateData["eventType"] = parsed.data.eventType;
    if (parsed.data.preferredDate !== undefined) updateData["preferredDate"] = parsed.data.preferredDate;
    if (parsed.data.estimatedGuests !== undefined) updateData["estimatedGuests"] = parsed.data.estimatedGuests;
    if (parsed.data.message !== undefined) updateData["message"] = parsed.data.message;

    const [updated] = await db.update(enquiries)
      .set(updateData)
      .where(eq(enquiries.id, params.data.id))
      .returning();

    return { data: updated === undefined ? updated : asSeenBy(request.user, updated) };
  });

  // POST /enquiries/:id/transition — state machine transition
  server.post("/:id/transition", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const parsed = TransitionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [enquiry] = await db.select().from(enquiries)
      .where(eq(enquiries.id, params.data.id))
      .limit(1);

    if (enquiry === undefined) {
      return reply.status(404).send({ error: "Enquiry not found", code: "NOT_FOUND" });
    }

    // Check access: owner, venue hallkeeper/staff, or admin
    if (!canWorkEnquiry(request.user, enquiry)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (parsed.data.from !== undefined && parsed.data.from !== enquiry.state) {
      return reply.status(409).send(ENQUIRY_STATUS_CHANGED);
    }

    // An access request or an enquiry about Venviewer asked to book nothing,
    // and both decisions email the sender a booking outcome.
    const kind = enquiryKind(enquiry.eventType);
    if (kind === "request" && (parsed.data.status === "approved" || parsed.data.status === "rejected")) {
      return reply.status(422).send({
        error: "This request is not a booking, so it cannot be approved or declined. Mark it done instead.",
        code: "NOT_A_BOOKING",
      });
    }

    // Check transition is valid for this role
    if (!canTransition(enquiry.state, parsed.data.status, request.user.role, kind)) {
      return reply.status(422).send({
        error: `Cannot transition from '${enquiry.state}' to '${parsed.data.status}' with role '${request.user.role}'`,
        code: "INVALID_TRANSITION",
      });
    }

    // Owning an enquiry makes someone its customer, not the venue's team. The
    // customer's own moves (submit, withdraw) are the owner's wherever the
    // enquiry is; the venue's (review, decide, archive, reopen) are its own
    // team's alone, whatever role the owner holds elsewhere or with no venue
    // yet: a decision emails the venue's answer in the venue's name.
    if (!isCustomerMove(enquiry.state, parsed.data.status, kind)
      && !canManageVenue(request.user, enquiry.venueId)
      && !canManageCommercial(request.user, enquiry.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const fromStatus = enquiry.state;

    // The move and its history commit together, and only from the status it
    // was judged from (the person's own screen's, when it says): a move that
    // landed first (a colleague's decision, the client's withdrawal) stands,
    // and no second decision is made or emailed on top of it.
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(enquiries)
        .set({ state: parsed.data.status, updatedAt: new Date() })
        .where(and(eq(enquiries.id, params.data.id), eq(enquiries.state, fromStatus)))
        .returning();
      if (row === undefined) return null;
      await tx.insert(enquiryStatusHistory).values({
        enquiryId: params.data.id,
        fromStatus,
        toStatus: parsed.data.status,
        changedBy: request.user.id,
        note: parsed.data.note ?? null,
      });
      // A decision is emailed to the guest below, so it is a reply Venviewer
      // sends itself: the enquiry's first unless an earlier one is recorded.
      if (parsed.data.status === "approved" || parsed.data.status === "rejected") {
        await stampFirstResponse(tx, {
          enquiryId: row.id,
          venueId: row.venueId,
          at: "now",
          // The venue's team replied; a Venviewer operator who decided for
          // the venue is not one of them, so the reply names nobody.
          byUserId: isVenueCommercialMember(request.user, row.venueId) ? request.user.id : null,
          channel: "decision",
        });
        const [stamped] = await tx.select().from(enquiries).where(eq(enquiries.id, row.id)).limit(1);
        return stamped ?? row;
      }
      return row;
    });
    if (updated === null) return reply.status(409).send(ENQUIRY_STATUS_CHANGED);

    // Send notification emails on approval/rejection
    if (parsed.data.status === "approved" || parsed.data.status === "rejected") {
      const recipientEmail = enquiry.guestEmail ?? enquiry.email;
      // A guest who named no room is never told they asked for the room the
      // enquiry is filed under; nor for a room that can no longer be read.
      const [space] = enquiry.roomChosen
        ? await db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, enquiry.spaceId)).limit(1)
        : [];
      const [venue] = await db.select({ name: venues.name }).from(venues).where(eq(venues.id, enquiry.venueId)).limit(1);
      const roomName = space?.name ?? null;
      const venueName = venue?.name ?? "Unknown venue";

      if (parsed.data.status === "approved") {
        const configUrl = enquiry.configurationId !== null
          ? `${process.env["FRONTEND_URL"] ?? "http://localhost:5173"}/plan/${enquiry.configurationId}`
          : null;
        const emailData = await enquiryApproved({ venueName, roomName, eventDate: enquiry.preferredDate, configUrl });
        // Idempotency: one approved notification per enquiry, regardless
        // of how many times the transition handler re-fires. An accidental
        // double-click, a client retry, or a replayed webhook all converge
        // to a single email.
        sendEmailAsync({ to: recipientEmail, ...emailData }, {
          db,
          idempotencyKey: `enquiry-approved:${enquiry.id}`,
          logger: request.log,
        });
      } else {
        const emailData = await enquiryRejected({ venueName, roomName, eventDate: enquiry.preferredDate, note: parsed.data.note ?? null });
        sendEmailAsync({ to: recipientEmail, ...emailData }, {
          db,
          idempotencyKey: `enquiry-rejected:${enquiry.id}`,
          logger: request.log,
        });
      }
    }

    return { data: asSeenBy(request.user, updated) };
  });

  // POST /enquiries/:id/first-response — someone on the venue's team reports
  // a reply made outside Venviewer (an email from the venue's own mailbox, a
  // call, a meeting): the enquiry's first reply when it is earlier than the
  // one recorded (migration 0100). `respondedAt` defaults to now and may not
  // be before the enquiry arrived or later than now; `respondedBy` defaults to
  // the person reporting and must be on the venue's team. Every report is kept
  // in the audit log, including one that changes nothing, so the stamp's
  // history can be read back even though only the earliest is on the enquiry.
  server.post("/:id/first-response", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }
    const parsed = RecordFirstResponseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [enquiry] = await db.select({
      id: enquiries.id,
      venueId: enquiries.venueId,
      state: enquiries.state,
      createdAt: enquiries.createdAt,
    }).from(enquiries).where(eq(enquiries.id, params.data.id)).limit(1);
    if (enquiry === undefined) {
      return reply.status(404).send({ error: "Enquiry not found", code: "NOT_FOUND" });
    }
    if (!isVenueCommercialMember(request.user, enquiry.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (enquiry.state === "draft") {
      return reply.status(422).send({
        error: "This enquiry has not been sent yet, so there is no reply to record.",
        code: "ENQUIRY_NOT_SENT",
      });
    }

    // The enquiry reached the venue when it was sent: a draft a customer kept
    // before sending it was not yet the venue's to answer.
    const [sent] = await db.select({ at: sql<string | null>`min(${enquiryStatusHistory.createdAt})` })
      .from(enquiryStatusHistory)
      .where(and(eq(enquiryStatusHistory.enquiryId, enquiry.id), eq(enquiryStatusHistory.toStatus, "submitted")));
    const sentAt = sent?.at ?? null;
    const arrivedAt = sentAt === null ? enquiry.createdAt : new Date(sentAt);

    const respondedAt = parsed.data.respondedAt === undefined ? null : new Date(parsed.data.respondedAt);
    if (respondedAt !== null && respondedAt.getTime() > Date.now() + FIRST_RESPONSE_FUTURE_SKEW_MS) {
      return reply.status(422).send({ error: "A reply cannot be later than now.", code: "FIRST_RESPONSE_IN_FUTURE" });
    }
    // Reply time is what the team is judged on, so a reply dated well into
    // the past is the venue's admin's or manager's to record.
    if (respondedAt !== null && Date.now() - respondedAt.getTime() > FIRST_RESPONSE_REPORT_WINDOW_DAYS * DAY_MS
      && !BACKDATING_ROLES.has(request.user.role)) {
      return reply.status(422).send({
        error: `A reply more than ${String(FIRST_RESPONSE_REPORT_WINDOW_DAYS)} days ago is recorded by the venue's admin or manager.`,
        code: "FIRST_RESPONSE_TOO_OLD",
      });
    }
    if (respondedAt !== null && respondedAt.getTime() < arrivedAt.getTime()) {
      return reply.status(422).send({
        error: "A reply cannot be earlier than the enquiry it answers.",
        code: "FIRST_RESPONSE_BEFORE_ENQUIRY",
      });
    }

    const respondedBy = parsed.data.respondedBy ?? request.user.id;
    if (respondedBy !== request.user.id) {
      const [person] = await db.select({ role: users.role, venueId: users.venueId })
        .from(users).where(eq(users.id, respondedBy)).limit(1);
      if (person === undefined || !isVenueCommercialMember(person, enquiry.venueId)) {
        return reply.status(422).send({
          error: "Name someone on this venue's team as the person who replied.",
          code: "RESPONDER_NOT_AT_VENUE",
        });
      }
    }

    const stamped = await db.transaction(async (tx) => {
      // The reply it may replace, read under the row's lock, so the audit
      // says exactly what this report displaced.
      const previous = await lockFirstResponse(tx, enquiry.id, enquiry.venueId);
      const result = await stampFirstResponse(tx, {
        enquiryId: enquiry.id,
        venueId: enquiry.venueId,
        at: respondedAt ?? "now",
        byUserId: respondedBy,
        channel: parsed.data.channel,
      });
      await tx.insert(generalAuditLog).values({
        actorUserId: request.user.id,
        action: "enquiry.first_response_reported",
        targetType: "enquiry",
        targetId: enquiry.id,
        summary: result.changed
          ? "Recorded the enquiry's first reply."
          : "Reported a reply no earlier than the enquiry's first, which stands.",
        metadata: {
          channel: parsed.data.channel,
          respondedAt: respondedAt?.toISOString() ?? null,
          respondedBy,
          changed: result.changed,
          previous: previous === null ? null : {
            at: previous.at.toISOString(),
            byUserId: previous.byUserId,
            channel: previous.channel,
            recordedAt: previous.recordedAt.toISOString(),
          },
        },
      });
      return result;
    });
    // The enquiry was read at this venue, after it arrived, with a time no
    // earlier than its arrival, so it holds a reply now unless it moved away.
    if (stamped.stamp === null) {
      return reply.status(409).send({ error: "The enquiry changed while the reply was being recorded. Open it again.", code: "ENQUIRY_CHANGED" });
    }
    const data: RecordFirstResponseResult = {
      enquiryId: enquiry.id,
      firstResponse: {
        at: stamped.stamp.at.toISOString(),
        byUserId: stamped.stamp.byUserId,
        channel: stamped.stamp.channel,
        recordedAt: stamped.stamp.recordedAt.toISOString(),
      },
      changed: stamped.changed,
    };
    return { data };
  });

  // GET /enquiries/reply-alarm — the reply-time alarm (run-first item 3): the
  // booking enquiries of the caller's venue still waiting for a first reply
  // ENQUIRY_REPLY_ALARM_DEFAULT_HOURS after they were sent: how many, the one
  // waiting longest, the most recently flagged (as the desk lists them), and
  // when the next one will join them, so the desk asks again then rather than
  // polling. Read by the team that records replies (the venue's commercial
  // members). Seed fixtures, requests (marked done rather than answered) and
  // enquiries that arrived before ENQUIRY_REPLY_ALARM_FROM are left out.
  server.get("/reply-alarm", { preHandler: [authenticate] }, async (request, reply) => {
    const venueId = request.user.venueId;
    if (venueId === null || !isVenueCommercialMember(request.user, venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const thresholdHours = ENQUIRY_REPLY_ALARM_DEFAULT_HOURS;
    // The enquiry reached the venue when it was sent (as the report route reads
    // it). Spelled out with qualified names: in a select list Drizzle writes a
    // column bare, and a bare "id" inside the subquery would be the history's.
    const arrivedAt = sql`coalesce((SELECT min(h.created_at) FROM enquiry_status_history h
      WHERE h.enquiry_id = "enquiries"."id" AND h.to_status = 'submitted'), "enquiries"."created_at")`
      .mapWith(enquiries.createdAt);
    const cutoff = sql`now() - make_interval(hours => ${thresholdHours})`;
    const waiting = and(
      eq(enquiries.venueId, venueId),
      inArray(enquiries.state, [...ENQUIRY_REPLY_AWAITING_STATES]),
      isNull(enquiries.firstResponseAt),
      isNull(enquiries.fixtureSource),
      or(isNull(enquiries.eventType), notInArray(sql`btrim(${enquiries.eventType})`, [...NON_BOOKING_ENQUIRY_TYPES])),
      sql`${arrivedAt} >= ${replyAlarmFrom}::timestamptz`,
    );
    const overdue = and(waiting, sql`${arrivedAt} <= ${cutoff}`);

    // One read-only transaction, so every statement reads the same now().
    const data = await db.transaction(async (tx): Promise<ReplyAlarm> => {
      const [clock] = await tx.select({ now: sql`now()`.mapWith(enquiries.createdAt) }).from(sql`(SELECT 1) AS clock`);
      const flagged = await tx.select({ id: enquiries.id, arrivedAt, total: sql<number>`count(*) OVER ()`.mapWith(Number) })
        .from(enquiries)
        .where(overdue)
        .orderBy(desc(arrivedAt), desc(enquiries.id))
        .limit(ENQUIRY_REPLY_ALARM_LIST_LIMIT);
      const [longest] = await tx.select({ id: enquiries.id, arrivedAt })
        .from(enquiries)
        .where(overdue)
        .orderBy(arrivedAt, enquiries.id)
        .limit(1);
      const [next] = await tx.select({ arrivedAt })
        .from(enquiries)
        .where(and(waiting, sql`${arrivedAt} > ${cutoff}`))
        .orderBy(arrivedAt)
        .limit(1);
      if (clock === undefined) throw new Error("now() returned no row");
      return {
        thresholdHours,
        asOf: clock.now.toISOString(),
        overdue: flagged[0]?.total ?? 0,
        longest: longest === undefined ? null : { id: longest.id, arrivedAt: longest.arrivedAt.toISOString() },
        enquiries: flagged.map((row) => ({ id: row.id, arrivedAt: row.arrivedAt.toISOString() })),
        nextDueAt: next === undefined ? null : new Date(next.arrivedAt.getTime() + thresholdHours * 3_600_000).toISOString(),
      };
    }, { accessMode: "read only" });
    return { data };
  });

  // GET /enquiries/:id/history — status change history
  server.get("/:id/history", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const [enquiry] = await db.select().from(enquiries)
      .where(eq(enquiries.id, params.data.id))
      .limit(1);

    if (enquiry === undefined) {
      return reply.status(404).send({ error: "Enquiry not found", code: "NOT_FOUND" });
    }

    if (!canWorkEnquiry(request.user, enquiry)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const history = await db.select()
      .from(enquiryStatusHistory)
      .where(eq(enquiryStatusHistory.enquiryId, params.data.id))
      .orderBy(enquiryStatusHistory.createdAt);

    return { data: history };
  });

  // GET /enquiries/:id/quote — calculate price for an enquiry
  server.get("/:id/quote", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const [enquiry] = await db.select().from(enquiries)
      .where(eq(enquiries.id, params.data.id))
      .limit(1);

    if (enquiry === undefined) {
      return reply.status(404).send({ error: "Enquiry not found", code: "NOT_FOUND" });
    }

    // A quote is a price worked from every active rule, dated and
    // suggestion-born rates included, so only the roles that work the pipeline
    // see it (Blake, 17 October 2026). The enquirer asks for a quote and the
    // venue's team sends one; owning the enquiry, whose date and guests its
    // owner may change while it is a draft, never turns this into a price
    // calculator. A hallkeeper, who can open the enquiry, does not see it
    // either (decision 6b).
    if (!canManageCommercial(request.user, enquiry.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    // Fetch active pricing rules for this venue
    const rules = await db.select().from(pricingRules)
      .where(and(
        eq(pricingRules.venueId, enquiry.venueId),
        eq(pricingRules.isActive, true),
        isNull(pricingRules.deletedAt),
      ));

    const ruleInputs: PricingRuleInput[] = rules.map((r) => ({
      name: r.name,
      type: r.type as PricingRuleInput["type"],
      amount: parseFloat(r.amount),
      currency: r.currency,
      minHours: r.minHours,
      minGuests: r.minGuests,
      tiers: r.tiers as PricingRuleInput["tiers"],
      dayOfWeekModifiers: r.dayOfWeekModifiers as PricingRuleInput["dayOfWeekModifiers"],
      seasonalModifiers: r.seasonalModifiers as PricingRuleInput["seasonalModifiers"],
      validFrom: r.validFrom,
      validTo: r.validTo,
      isActive: r.isActive,
      spaceId: r.spaceId,
      appliesFrom: r.appliesFrom,
      appliesUntil: r.appliesUntil,
    }));

    const result = calculatePrice({
      rules: ruleInputs,
      spaceId: enquiry.spaceId,
      eventDate: enquiry.preferredDate ?? new Date().toISOString().split("T")[0] ?? "",
      startTime: "10:00",
      endTime: "22:00",
      guestCount: enquiry.estimatedGuests ?? 0,
    });

    reply.header("Cache-Control", "private, no-store");
    return { data: result };
  });

  // v1 per-enquiry hallkeeper-sheet routes removed. The new approval
  // workflow serves sheets from the snapshot service; see
  // packages/api/src/routes/configuration-reviews.ts for
  // GET /configurations/:configId/snapshot/latest.
}
