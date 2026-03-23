import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { enquiries, enquiryStatusHistory, configurations, guestLeads, spaces } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const GuestEnquiryBody = z.object({
  configurationId: z.string().uuid(),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(30).optional(),
  name: z.string().trim().max(200).optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  eventType: z.string().trim().max(100).optional(),
  guestCount: z.number().int().nonnegative().optional(),
  message: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Plugin — public guest enquiry submission
// ---------------------------------------------------------------------------

export async function publicEnquiryRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // POST /public/enquiries — submit guest enquiry without auth
  server.post("/enquiries", {
    config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const parsed = GuestEnquiryBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Verify configuration exists
    const [config] = await db.select()
      .from(configurations)
      .where(and(eq(configurations.id, parsed.data.configurationId), isNull(configurations.deletedAt)))
      .limit(1);

    if (config === undefined) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    // Get space to find venueId
    const [space] = await db.select({ id: spaces.id, venueId: spaces.venueId })
      .from(spaces)
      .where(eq(spaces.id, config.spaceId))
      .limit(1);

    if (space === undefined) {
      return reply.status(500).send({ error: "Space not found for configuration", code: "INTERNAL_ERROR" });
    }

    // Create enquiry with guest fields, status: submitted (skip draft)
    const displayName = parsed.data.name ?? parsed.data.email;
    const [enquiry] = await db.insert(enquiries).values({
      configurationId: parsed.data.configurationId,
      venueId: space.venueId,
      spaceId: config.spaceId,
      userId: null,
      guestEmail: parsed.data.email,
      guestPhone: parsed.data.phone ?? null,
      guestName: parsed.data.name ?? null,
      state: "submitted",
      name: displayName,
      email: parsed.data.email,
      preferredDate: parsed.data.eventDate ?? null,
      eventType: parsed.data.eventType ?? null,
      estimatedGuests: parsed.data.guestCount ?? null,
      message: parsed.data.message ?? null,
    }).returning();

    if (enquiry === undefined) {
      return reply.status(500).send({ error: "Failed to create enquiry", code: "INTERNAL_ERROR" });
    }

    // Write status history: guest submission (changedBy is null for guests)
    await db.insert(enquiryStatusHistory).values({
      enquiryId: enquiry.id,
      fromStatus: "draft",
      toStatus: "submitted",
      changedBy: null,
      note: "Guest submission",
    });

    // Create or update guest_leads record
    const [existingLead] = await db.select()
      .from(guestLeads)
      .where(eq(guestLeads.email, parsed.data.email))
      .limit(1);

    if (existingLead === undefined) {
      await db.insert(guestLeads).values({
        email: parsed.data.email,
        phone: parsed.data.phone ?? null,
        name: parsed.data.name ?? null,
        firstEnquiryId: enquiry.id,
      });
    } else {
      // Update with latest contact info
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.phone !== undefined) updateData["phone"] = parsed.data.phone;
      if (parsed.data.name !== undefined) updateData["name"] = parsed.data.name;
      await db.update(guestLeads)
        .set(updateData)
        .where(eq(guestLeads.id, existingLead.id));
    }

    return reply.status(201).send({
      data: {
        enquiryId: enquiry.id,
        message: "Your enquiry has been sent to the events team",
      },
    });
  });
}
