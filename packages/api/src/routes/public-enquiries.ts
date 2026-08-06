import type { FastifyInstance } from "fastify";
import {
  GuestEnquirySchema,
  enquiryReference,
  enquirySourceNote,
  resolveEnquirySource,
  type EnquirySource,
} from "@omnitwin/types";
import { eq, and, isNull, asc } from "drizzle-orm";
import { enquiries, enquiryStatusHistory, configurations, guestLeads, spaces, users, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { sendEmailAsync } from "../services/email.js";
import { enquiryReceived, newEnquiryNotification } from "../services/email-templates.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const GuestEnquiryBody = GuestEnquirySchema;

/** Last-resort venue name for the guest acknowledgement, used only if the
 *  anchored venue somehow has no name. The email must never ship "null". */
const FALLBACK_VENUE_NAME = "the venue";

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
  // Both flagship spellings by default. The asset/twin namespace uses
  // "trades-hall" (manifests, R2 paths, TRADES_HALL_VENUE_SLUG) while the
  // `venues` row this route resolves is seeded "trades-hall-glasgow". That
  // divergence made the homepage enquiry 404 against a real database on
  // 2026-08-04 while every unit test passed — the tests mocked the network,
  // so no test ever resolved a slug against an actual venues row.
  //
  // Listing both is safe: this is only the opt-in gate. The venue lookup
  // below must still find a live row, so an allowlisted slug with no venue
  // returns the same 404 as an unlisted one — the allowlist can never grant
  // access to a venue that does not exist.
  return (process.env["TWIN_PUBLIC_VENUE_SLUGS"] ?? "trades-hall,trades-hall-glasgow")
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);
}

/**
 * Contact details printed in the guest acknowledgement so the email is never a
 * dead end. Same shape as twinPublicVenueSlugs above: env-overridable, and
 * defaulted to the flagship's ALREADY-PUBLIC details so the live site works
 * with no extra deploy step. These are the exact values the homepage footer
 * shows (packages/web/src/pages/landing/rite-copy.ts) — if the venue changes
 * them there, set VENUE_CONTACT_EMAIL / VENUE_CONTACT_PHONE to match.
 *
 * Multi-venue should promote these to columns on `venues`, which today has a
 * name and an address but no contact fields.
 */
function venueContactEmail(): string {
  return process.env["VENUE_CONTACT_EMAIL"] ?? "info@tradeshallglasgow.co.uk";
}

function venueContactPhone(): string | null {
  const phone = process.env["VENUE_CONTACT_PHONE"] ?? "0141 552 2418";
  return phone.trim().length > 0 ? phone : null;
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
    // Which front door this came through. Descriptive only — it never widens
    // which venues may be reached; that stays the anchor's job below.
    const source: EnquirySource = resolveEnquirySource(parsed.data);

    let anchor: {
      venueId: string;
      spaceId: string;
      configurationId: string | null;
      spaceName: string;
      venueName: string;
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
      // Venue name is for the guest acknowledgement only; the venue id came
      // from the already-authorised config, so this widens nothing.
      const [configVenue] = await db.select({ name: venues.name })
        .from(venues)
        .where(eq(venues.id, space.venueId))
        .limit(1);
      anchor = {
        venueId: space.venueId,
        spaceId: config.spaceId,
        configurationId: parsed.data.configurationId,
        spaceName: space.name,
        venueName: configVenue?.name ?? FALLBACK_VENUE_NAME,
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
      const [venue] = await db.select({ id: venues.id, name: venues.name })
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
        venueName: venue.name,
      };
    }

    // Create enquiry with guest fields, status: submitted (skip draft).
    const displayName = parsed.data.name ?? parsed.data.email;
    // Enquiries from a front door with its own note (twin, homepage) carry it
    // first so it survives even a long message; the input message stays within
    // its 2000-char validation. The planner has no note — its configuration is
    // itself the context.
    const sourceNote = enquirySourceNote(source);
    const composedMessage = sourceNote !== null
      ? parsed.data.message !== undefined
        ? `${sourceNote}\n\n${parsed.data.message}`
        : sourceNote
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

    // Acknowledge the GUEST. Until this existed, every public enquiry notified
    // the venue and told the sender nothing — the single loudest complaint in
    // the wedding-client research (docs/research/r3-client-journey.md).
    //
    // Fire-and-forget on purpose, and keyed to the enquiry so a retried POST
    // cannot double-send: the enquiry is already committed, and a mail
    // provider outage must never turn a captured lead into a 500.
    const ackData = await enquiryReceived({
      venueName: anchor.venueName,
      reference: enquiryReference(enquiry.id),
      contactName: parsed.data.name ?? null,
      spaceName: anchor.spaceName,
      eventType: parsed.data.eventType ?? null,
      eventDate: parsed.data.eventDate ?? null,
      guestCount: parsed.data.guestCount ?? null,
      message: parsed.data.message ?? null,
      venueEmail: venueContactEmail(),
      venuePhone: venueContactPhone(),
    });
    sendEmailAsync({ to: parsed.data.email, ...ackData }, {
      db,
      idempotencyKey: `enquiry-ack:${enquiry.id}`,
      logger: request.log,
    });

    return reply.status(201).send({
      data: {
        enquiryId: enquiry.id,
        reference: enquiryReference(enquiry.id),
        message: "Your enquiry has been sent to the events team",
      },
    });
  });
}
