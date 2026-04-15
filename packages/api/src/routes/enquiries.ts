import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, sql } from "drizzle-orm";
import { enquiries, enquiryStatusHistory, configurations, pricingRules, spaces, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { paginate } from "../utils/pagination.js";
import { canAccessResource, canManageVenue } from "../utils/query.js";
import { canTransition, ENQUIRY_STATES } from "../state-machines/enquiry.js";
import { calculatePrice, type PricingRuleInput } from "../services/price-calculator.js";
import { generateHallkeeperSheet, generateHallkeeperPdf } from "../services/hallkeeper-sheet.js";
import { sendEmailAsync } from "../services/email.js";
import { enquiryApproved, enquiryRejected } from "../services/email-templates.js";

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
});

const StatusFilterQuery = z.object({
  status: z.enum(ENQUIRY_STATES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

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

    if (user.role === "admin") {
      // Admin sees all
    } else if ((user.role === "staff" || user.role === "hallkeeper") && user.venueId !== null) {
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
      .orderBy(enquiries.updatedAt);

    return paginate(rows, total, { limit: query.data.limit, offset: query.data.offset });
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

    if (!canAccessResource(request.user, enquiry.userId, enquiry.venueId)) {
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
    const [config] = await db.select()
      .from(configurations)
      .where(and(eq(configurations.id, parsed.data.configurationId), isNull(configurations.deletedAt)))
      .limit(1);

    if (config === undefined) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (config.userId !== request.user.id && request.user.role !== "admin") {
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

    // Owner can only edit in draft state. Admin can edit anytime.
    if (request.user.role !== "admin") {
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
    if (!canAccessResource(request.user, enquiry.userId, enquiry.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    // Check transition is valid for this role
    if (!canTransition(enquiry.state, parsed.data.status, request.user.role)) {
      return reply.status(422).send({
        error: `Cannot transition from '${enquiry.state}' to '${parsed.data.status}' with role '${request.user.role}'`,
        code: "INVALID_TRANSITION",
      });
    }

    const fromStatus = enquiry.state;

    // Update enquiry state
    const [updated] = await db.update(enquiries)
      .set({ state: parsed.data.status, updatedAt: new Date() })
      .where(eq(enquiries.id, params.data.id))
      .returning();

    // Write history record
    await db.insert(enquiryStatusHistory).values({
      enquiryId: params.data.id,
      fromStatus,
      toStatus: parsed.data.status,
      changedBy: request.user.id,
      note: parsed.data.note ?? null,
    });

    // Send notification emails on approval/rejection
    if (parsed.data.status === "approved" || parsed.data.status === "rejected") {
      const recipientEmail = enquiry.guestEmail ?? enquiry.email;
      const [space] = await db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, enquiry.spaceId)).limit(1);
      const [venue] = await db.select({ name: venues.name }).from(venues).where(eq(venues.id, enquiry.venueId)).limit(1);
      const spaceName = space?.name ?? "Unknown space";
      const venueName = venue?.name ?? "Unknown venue";

      if (parsed.data.status === "approved") {
        const configUrl = enquiry.configurationId !== null
          ? `${process.env["FRONTEND_URL"] ?? "http://localhost:5173"}/editor/${enquiry.configurationId}`
          : null;
        const emailData = enquiryApproved({ venueName, spaceName, eventDate: enquiry.preferredDate, configUrl });
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
        const emailData = enquiryRejected({ venueName, spaceName, eventDate: enquiry.preferredDate, note: parsed.data.note ?? null });
        sendEmailAsync({ to: recipientEmail, ...emailData }, {
          db,
          idempotencyKey: `enquiry-rejected:${enquiry.id}`,
          logger: request.log,
        });
      }
    }

    return { data: updated };
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

    if (!canAccessResource(request.user, enquiry.userId, enquiry.venueId)) {
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

    if (!canAccessResource(request.user, enquiry.userId, enquiry.venueId)) {
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
    }));

    const result = calculatePrice({
      rules: ruleInputs,
      spaceId: enquiry.spaceId,
      eventDate: enquiry.preferredDate ?? new Date().toISOString().split("T")[0] ?? "",
      startTime: "10:00",
      endTime: "22:00",
      guestCount: enquiry.estimatedGuests ?? 0,
    });

    return { data: result };
  });

  // GET /enquiries/:id/hallkeeper-sheet — JSON sheet data
  server.get("/:id/hallkeeper-sheet", { preHandler: [authenticate] }, async (request, reply) => {
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

    if (!canManageVenue(request.user, enquiry.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const sheet = await generateHallkeeperSheet(db, params.data.id);
    if (sheet === null) {
      return reply.status(500).send({ error: "Failed to generate sheet", code: "INTERNAL_ERROR" });
    }

    return { data: sheet };
  });

  // GET /enquiries/:id/hallkeeper-sheet/pdf — PDF download
  server.get("/:id/hallkeeper-sheet/pdf", { preHandler: [authenticate] }, async (request, reply) => {
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

    if (!canManageVenue(request.user, enquiry.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const sheet = await generateHallkeeperSheet(db, params.data.id);
    if (sheet === null) {
      return reply.status(500).send({ error: "Failed to generate sheet", code: "INTERNAL_ERROR" });
    }

    const pdf = await generateHallkeeperPdf(sheet);

    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="hallkeeper-sheet-${params.data.id}.pdf"`)
      .send(pdf);
  });
}
