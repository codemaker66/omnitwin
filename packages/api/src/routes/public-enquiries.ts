import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, asc } from "drizzle-orm";
import { enquiries, enquiryStatusHistory, configurations, guestLeads, spaces, users, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { sendEmailAsync } from "../services/email.js";
import { newEnquiryNotification } from "../services/email-templates.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const GuestEnquiryBody = z
  .object({
    // Exactly one anchor: a public-preview config (planner path) OR a venue
    // slug (twin walkthrough path). The refine below enforces the xor.
    configurationId: z.string().uuid().optional(),
    venueSlug: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().email().max(255),
    phone: z.string().trim().max(30).optional(),
    name: z.string().trim().max(200).optional(),
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    eventType: z.string().trim().max(100).optional(),
    // Bounded to keep it within the 32-bit `estimated_guests` column (matches
    // @omnitwin/types MAX_GUEST_COUNT) — an unbounded value passed Zod and then
    // overflowed the column on insert (2026-07 security review, Low).
    guestCount: z.number().int().nonnegative().max(10000).optional(),
    message: z.string().max(2000).optional(),
  })
  .refine(
    (v) => (v.configurationId === undefined) !== (v.venueSlug === undefined),
    { message: "Provide exactly one of configurationId or venueSlug", path: ["configurationId"] },
  );

/** Marks a venue-wide twin enquiry so the events team can re-scope the space
 *  (a twin enquiry has no config and is anchored to the venue's flagship). */
const TWIN_SOURCE_NOTE = "Sent from the venue's virtual walkthrough (the twin).";

/**
 * Venues whose public twin is published and may therefore receive walkthrough
 * enquiries. This is the venue-path's OPT-IN GATE (2026-07 security review): the
 * config path is protected by `isPublicPreview` + an unguessable UUID, but a
 * venue slug is public and guessable, so without a gate any tenant would be
 * enumerable and spammable by slug. The allowlist mirrors how the twin bundle
 * is actually deployed (manually, per venue, to R2); env-overridable so new
 * twins are enabled without a code change, defaulting to the flagship so the
 * live twin works with no extra deploy step. Multi-venue should promote this to
 * a `venues.twinPublished` column.
 */
function twinPublicVenueSlugs(): readonly string[] {
  return (process.env["TWIN_PUBLIC_VENUE_SLUGS"] ?? "trades-hall")
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);
}

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

    // Resolve the enquiry's anchor — venueId + spaceId (+ configurationId) —
    // from EITHER a public-preview config (planner path) or a venue slug (twin
    // path). Both paths keep the same security posture: the config path only
    // accepts PUBLIC-PREVIEW configs (a private config id would let anyone
    // attach enquiries to another user's workspace); the venue path only
    // resolves a live venue by its already-public slug and never trusts a
    // client-supplied venueId.
    let anchor: {
      venueId: string;
      spaceId: string;
      configurationId: string | null;
      spaceName: string;
      fromTwin: boolean;
    };

    if (parsed.data.configurationId !== undefined) {
      const [config] = await db.select()
        .from(configurations)
        .where(and(
          eq(configurations.id, parsed.data.configurationId),
          eq(configurations.isPublicPreview, true),
          isNull(configurations.deletedAt),
        ))
        .limit(1);
      if (config === undefined) {
        return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
      }
      const [space] = await db.select({ id: spaces.id, venueId: spaces.venueId, name: spaces.name })
        .from(spaces)
        .where(eq(spaces.id, config.spaceId))
        .limit(1);
      if (space === undefined) {
        return reply.status(500).send({ error: "Space not found for configuration", code: "INTERNAL_ERROR" });
      }
      anchor = {
        venueId: space.venueId,
        spaceId: config.spaceId,
        configurationId: parsed.data.configurationId,
        spaceName: space.name,
        fromTwin: false,
      };
    } else {
      // venueSlug path. Anchor the venue-wide enquiry to the venue's flagship
      // space (lowest sortOrder) — venueId is the routing key; the message marks
      // the twin source so the events team can re-scope the space. Every miss
      // below returns the SAME 404 so status codes can't be used to enumerate
      // tenants (security review).
      const slug = parsed.data.venueSlug ?? "";
      // Opt-in gate first (before any DB hit): unpublished slugs are 404, so a
      // non-twin tenant is indistinguishable from a non-existent one.
      if (!twinPublicVenueSlugs().includes(slug)) {
        return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
      }
      const [venue] = await db.select({ id: venues.id })
        .from(venues)
        .where(and(eq(venues.slug, slug), isNull(venues.deletedAt)))
        .limit(1);
      if (venue === undefined) {
        return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
      }
      const [flagship] = await db.select({ id: spaces.id, name: spaces.name })
        .from(spaces)
        .where(and(eq(spaces.venueId, venue.id), isNull(spaces.deletedAt)))
        .orderBy(asc(spaces.sortOrder), asc(spaces.createdAt))
        .limit(1);
      // A published venue with no space is a real onboarding state, not an
      // internal error — collapse it into the same 404 (not a 500 that would
      // leak "this venue exists but is unconfigured").
      if (flagship === undefined) {
        return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
      }
      anchor = {
        venueId: venue.id,
        spaceId: flagship.id,
        configurationId: null,
        spaceName: flagship.name,
        fromTwin: true,
      };
    }

    // Create enquiry with guest fields, status: submitted (skip draft).
    const displayName = parsed.data.name ?? parsed.data.email;
    // Twin enquiries carry the source note first so it survives even a long
    // message; the input message stays within its 2000-char validation.
    const composedMessage = anchor.fromTwin
      ? parsed.data.message !== undefined
        ? `${TWIN_SOURCE_NOTE}\n\n${parsed.data.message}`
        : TWIN_SOURCE_NOTE
      : parsed.data.message ?? null;
    const [enquiry] = await db.insert(enquiries).values({
      configurationId: anchor.configurationId,
      venueId: anchor.venueId,
      spaceId: anchor.spaceId,
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
      message: composedMessage,
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

    // Notify hallkeeper(s) of the venue
    const spaceName = anchor.spaceName;

    const hallkeepers = await db.select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.venueId, anchor.venueId), eq(users.role, "hallkeeper")));

    for (const hk of hallkeepers) {
      const emailData = await newEnquiryNotification({
        spaceName,
        eventType: parsed.data.eventType ?? null,
        contactName: displayName,
        contactEmail: parsed.data.email,
        contactPhone: parsed.data.phone ?? null,
        eventDate: parsed.data.eventDate ?? null,
        guestCount: parsed.data.guestCount ?? null,
        message: composedMessage,
        dashboardUrl: `${process.env["FRONTEND_URL"] ?? "http://localhost:5173"}/dashboard`,
      });
      // Idempotency key scoped to (enquiry, recipient) so a webhook replay
      // or retry of the POST doesn't double-notify any one hallkeeper.
      sendEmailAsync({ to: hk.email, ...emailData }, {
        db,
        idempotencyKey: `enquiry-new:${enquiry.id}:${hk.id}`,
        logger: request.log,
      });
    }

    return reply.status(201).send({
      data: {
        enquiryId: enquiry.id,
        message: "Your enquiry has been sent to the events team",
      },
    });
  });
}
