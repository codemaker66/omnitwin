import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, desc, inArray, isNull, sql } from "drizzle-orm";
import {
  FIRST_RESPONSE_FUTURE_SKEW_MS,
  RecordFirstResponseSchema,
  type RecordFirstResponseResult,
} from "@omnitwin/types";
import { enquiries, enquiryStatusHistory, configurations, generalAuditLog, pricingRules, spaces, users, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, isPlatformAdmin, type JwtUser } from "../middleware/auth.js";
import { paginate } from "../utils/pagination.js";
import { canAccessResource, canManageCommercial, canManageVenue } from "../utils/query.js";
import { canTransition, enquiryKind, ENQUIRY_STATES, isCustomerMove } from "../state-machines/enquiry.js";
import { calculatePrice, type PricingRuleInput } from "../services/price-calculator.js";
import { sendEmailAsync } from "../services/email.js";
import { enquiryApproved, enquiryRejected } from "../services/email-templates.js";
import { stampFirstResponse } from "../services/enquiry-funnel.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const IdParam = z.object({ id: z.string().uuid() });

const CreateEnquiryBody = z.object({
  configurationId: z.string().uuid(),
  venueId: z.string().uuid(),
  spaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(255),
  eventType: z.string().trim().max(100).nullable().optional(),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  estimatedGuests: z.number().int().nonnegative().nullable().optional(),
  message: z.string().max(2000).nullable().optional(),
});

const UpdateEnquiryBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(255).optional(),
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
  .pipe(z.array(z.enum(ENQUIRY_STATES)).min(1));

const StatusFilterQuery = z.object({
  status: z.enum(ENQUIRY_STATES).optional(),
  states: EnquiryStatesParam.optional(),
  order: z.enum(ENQUIRY_LIST_ORDERS).default("updated_asc"),
  venueId: z.string().uuid().optional(),
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

/**
 * Who answers a venue's enquiries, so who may say a reply was made: the
 * venue's own commercial team, the roles canManageCommercial admits, without
 * its pass for a Venviewer platform admin, who answers no venue's guests. The
 * floor (a hallkeeper) reads the inbox but does not answer it.
 */
const REPLYING_ROLES: ReadonlySet<string> = new Set(["admin", "manager", "staff", "sales"]);

function answersFor(person: { readonly role: string; readonly venueId: string | null }, venueId: string): boolean {
  return REPLYING_ROLES.has(person.role) && person.venueId === venueId;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function enquiryRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

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

    const page = paginate(rows, total, { limit: query.data.limit, offset: query.data.offset });
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

    return { data: enquiry };
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

    return reply.status(201).send({ data: enquiry });
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

    return { data: updated };
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
          byUserId: request.user.id,
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

    return { data: updated };
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
    if (!answersFor(request.user, enquiry.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (enquiry.state === "draft") {
      return reply.status(422).send({
        error: "This enquiry has not been sent yet, so there is no reply to record.",
        code: "ENQUIRY_NOT_SENT",
      });
    }

    const respondedAt = parsed.data.respondedAt === undefined ? null : new Date(parsed.data.respondedAt);
    if (respondedAt !== null && respondedAt.getTime() > Date.now() + FIRST_RESPONSE_FUTURE_SKEW_MS) {
      return reply.status(422).send({ error: "A reply cannot be later than now.", code: "FIRST_RESPONSE_IN_FUTURE" });
    }
    if (respondedAt !== null && respondedAt.getTime() < enquiry.createdAt.getTime()) {
      return reply.status(422).send({
        error: "A reply cannot be earlier than the enquiry it answers.",
        code: "FIRST_RESPONSE_BEFORE_ENQUIRY",
      });
    }

    const respondedBy = parsed.data.respondedBy ?? request.user.id;
    if (respondedBy !== request.user.id) {
      const [person] = await db.select({ role: users.role, venueId: users.venueId })
        .from(users).where(eq(users.id, respondedBy)).limit(1);
      if (person === undefined || !answersFor(person, enquiry.venueId)) {
        return reply.status(422).send({
          error: "Name someone on this venue's team as the person who replied.",
          code: "RESPONDER_NOT_AT_VENUE",
        });
      }
    }

    const stamped = await db.transaction(async (tx) => {
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
