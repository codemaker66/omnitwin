import type { FastifyInstance } from "fastify";
import {
  ENQUIRY_OCCASION_KEYS,
  GuestEnquirySchema,
  TRADES_HALL_ENQUIRY_VENUE_SLUG,
  VENUE_ACCESS_ENQUIRY_TYPE,
  VENVIEWER_PRICING_ENQUIRY_TYPE,
  attributeEnquiry,
  isBookingEnquiry,
  occasionLabel,
  occasionPhrase,
  type EnquiryAttributionRecord,
  type EnquirySource,
} from "@omnitwin/types";
import { eq, and, isNull, asc, inArray, like, notInArray, sql } from "drizzle-orm";
import { enquiries, enquiryStatusHistory, configurations, emailSends, spaces, users, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { resolveEmailReplyTo, sendEmailAsync, type SendLimit } from "../services/email.js";
import { enquiryAcknowledgement, newEnquiryNotification } from "../services/email-templates.js";
import { notifyCommercialTeam } from "../services/commercial-notifications.js";
import { acquisitionContextFor, funnelBrowserSignalsEnabled, recordEnquiryEngagement } from "../services/enquiry-funnel.js";
import { linkEnquiryToPerson, type LinkOutcome } from "../services/people-link.js";
import { sqlStateOf } from "../utils/sql-state.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const GuestEnquiryBody = GuestEnquirySchema;

/**
 * Venues whose public twin is published and may therefore receive walkthrough
 * enquiries. This is the venue-path's OPT-IN GATE (2026-07 security review): a
 * venue slug is public and guessable, so without a gate any tenant would be
 * enumerable and spammable by slug. The config path reads it too (Blake, 12
 * November 2026, "Gate it like the form"; audit public-surface-7): anyone may
 * make a public plan in any live venue's room (POST /public/configurations, as
 * the planner at /v/:venueSlug/plan does), so a plan's id is no secret, and a
 * plan whose venue is not on this list answers the venue path's 404. A guest
 * may still plan in such a venue's room. The allowlist mirrors how the twin
 * bundle is actually deployed (manually, per venue, to R2); env-overridable so new
 * twins are enabled without a code change, defaulting to the flagship so the
 * live twin works with no extra deploy step. The default is the DATABASE slug
 * (TRADES_HALL_ENQUIRY_VENUE_SLUG), not the asset slug: this gate is checked
 * immediately before a `venues.slug` lookup, so an allowlist entry that is not
 * a real row passes the gate and then 404s on the lookup — which is exactly how
 * twin enquiries were being lost. Multi-venue should promote this to
 * a `venues.twinPublished` column.
 */
function twinPublicVenueSlugs(): readonly string[] {
  return (process.env["TWIN_PUBLIC_VENUE_SLUGS"] ?? TRADES_HALL_ENQUIRY_VENUE_SLUG)
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);
}

/** Who is emailed a new web enquiry: the people who sell, so a lead reaches
 *  them the moment it lands, and the venue's hallkeepers, as before (Blake,
 *  18 October 2026). Office staff and admins keep the in-app notice. */
const ENQUIRY_EMAIL_ROLES = ["sales", "manager", "hallkeeper"] as const;

/** What enquiries.name holds (varchar(200)). An email is ASCII (z.email()),
 *  so cutting it by code unit never splits a character. */
const ENQUIRY_NAME_MAX = 200;

/**
 * The occasion in the venue's own words when it is one the venue offers
 * (ENQUIRY_OCCASION_KEYS), and null for one typed in free. The guest's
 * acknowledgement is sent in the venue's name to whatever address the
 * enquiry gives, which nobody has confirmed, so it repeats none of a
 * stranger's text in its facts (audit enquiries-crm-3). Every form the venue
 * publishes sends one of its own occasions; the enquiry and the team's email
 * keep a typed one as it was typed.
 */
function offeredOccasionLabel(eventType: string | undefined): string | null {
  const key = eventType?.trim().toLowerCase() ?? "";
  return ENQUIRY_OCCASION_KEYS.includes(key) ? occasionLabel(key) : null;
}

/** An enquiry's acknowledgement is recorded in email_sends under this key and its id. */
const ACKNOWLEDGEMENT_KEY = "enquiry-acknowledged:";

/**
 * At most one acknowledgement to one address in 24 hours (Blake, 12 November
 * 2026, decision (c)): it goes in the venue's name to an address nobody has
 * confirmed, so without this anyone could have the venue mail a stranger as
 * often as they liked. Counted from the acknowledgements email_sends holds for
 * the address, lower-cased, recorded in the 24 hours before this one is
 * decided. One that reached nobody does not count: one this limit held back
 * ("suppressed"), or one the provider did not take ("failed"), whose guest
 * may well ask again because no reply came. Decided under a
 * transaction-scoped advisory lock on the address, so of two sent at once
 * one goes. The enquiry is kept and the team told whatever it decides.
 */
function oneAcknowledgementADay(recipient: string): SendLimit {
  const address = recipient.toLowerCase();
  return {
    lockKey: `enquiry-acknowledgement-to:${address}`,
    allows: async (tx) => {
      const [recent] = await tx.select({ id: emailSends.id })
        .from(emailSends)
        .where(and(
          like(emailSends.idempotencyKey, `${ACKNOWLEDGEMENT_KEY}%`),
          sql`lower(${emailSends.recipient}) = ${address}`,
          notInArray(emailSends.status, ["suppressed", "failed"]),
          sql`${emailSends.createdAt} > now() - interval '24 hours'`,
        ))
        .limit(1);
      return recent === undefined;
    },
  };
}

/** The venue's first room in use (lowest sortOrder, then the oldest): where
 *  an enquiry that names no room is filed. */
async function flagshipRoom(db: Database, venueId: string): Promise<{ id: string; name: string } | undefined> {
  const [flagship] = await db.select({ id: spaces.id, name: spaces.name })
    .from(spaces)
    .where(and(eq(spaces.venueId, venueId), isNull(spaces.deletedAt)))
    .orderBy(asc(spaces.sortOrder), asc(spaces.createdAt))
    .limit(1);
  return flagship;
}

/** How a notice says where an enquiry came from, when it names no room. */
const SOURCE_PHRASE: Readonly<Record<EnquirySource, string>> = {
  website: "from the website",
  walkthrough: "from the walkthrough",
  planner: "from the planner",
  phone: "by phone",
  email: "by email",
  listing: "through a listing site",
  assistant: "through an AI assistant",
};

/**
 * What a failure to find an enquiry's person may say in a log: its class and
 * its SQLSTATE (drizzle wraps the driver's error as the cause). Never its
 * message, which drizzle builds from the query's parameters, the guest's
 * email among them.
 */
function linkFailureOf(error: unknown): { errorName: string; pgCode: string | null } {
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    pgCode: sqlStateOf(error),
  };
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
    // `roomName` is the room the guest chose, or null when they named none:
    // the enquiry is then filed against the venue's first room, and nothing
    // sent or shown may call that room their choice.
    let anchor: {
      venueId: string;
      spaceId: string;
      configurationId: string | null;
      roomName: string | null;
      venuePath: boolean;
      /** The venue's database slug when the path named it. */
      venueSlug: string | null;
    };

    if (parsed.data.configurationId !== undefined) {
      // The plan's room and venue, while the venue is live: a deleted venue
      // takes no enquiry here, as it takes none on the venue path below.
      // Deleting a venue leaves its rooms and its guests' plans as they were.
      const [planned] = await db.select({
        spaceId: spaces.id, venueId: spaces.venueId, roomName: spaces.name, roomRemovedAt: spaces.deletedAt, venueSlug: venues.slug,
      })
        .from(configurations)
        .innerJoin(spaces, eq(spaces.id, configurations.spaceId))
        .innerJoin(venues, eq(venues.id, spaces.venueId))
        .where(and(
          eq(configurations.id, parsed.data.configurationId),
          eq(configurations.isPublicPreview, true),
          isNull(configurations.deletedAt),
          isNull(venues.deletedAt),
        ))
        .limit(1);
      if (planned === undefined) {
        return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
      }
      // The venue path's gate, and its answer: a venue whose walkthrough is
      // not published takes no enquiry by either path.
      if (!twinPublicVenueSlugs().includes(planned.venueSlug)) {
        return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
      }
      // Taking a room out of use leaves the plans guests made in it (review
      // of #404, P5). An enquiry from one is filed as the venue path files
      // one naming no room: against the venue's first room in use, or the
      // plan's own when none is left, since the enquiry matters more than the room.
      let filedIn: { spaceId: string; roomName: string | null } = { spaceId: planned.spaceId, roomName: planned.roomName };
      if (planned.roomRemovedAt !== null) {
        request.log.warn(
          { event: "enquiry.room_removed", venueId: planned.venueId, configurationId: parsed.data.configurationId },
          "enquiry came from a plan whose room was taken out of use",
        );
        filedIn = { spaceId: (await flagshipRoom(db, planned.venueId))?.id ?? planned.spaceId, roomName: null };
      }
      anchor = {
        venueId: planned.venueId,
        spaceId: filedIn.spaceId,
        configurationId: parsed.data.configurationId,
        roomName: filedIn.roomName,
        venuePath: false,
        venueSlug: null,
      };
    } else {
      // venueSlug path. A room the guest names (roomSlug) is filed as their
      // choice; otherwise the venue-wide enquiry is filed against the venue's
      // flagship space (lowest sortOrder) and recorded as naming no room.
      // venueId is the routing key. Every miss below returns the SAME 404 so
      // status codes can't be used to enumerate tenants (security review).
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
      const flagship = await flagshipRoom(db, venue.id);
      // A published venue with no space is a real onboarding state, not an
      // internal error — collapse it into the same 404 (not a 500 that would
      // leak "this venue exists but is unconfigured").
      if (flagship === undefined) {
        return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
      }
      // A named room must be one of this venue's live rooms. One it does not
      // have (a renamed room in an older page) is filed as naming none rather
      // than refused: the guest's enquiry matters more than the room.
      const roomSlug = parsed.data.roomSlug;
      const [named] = roomSlug === undefined ? [] : await db.select({ id: spaces.id, name: spaces.name })
        .from(spaces)
        .where(and(eq(spaces.venueId, venue.id), eq(spaces.slug, roomSlug), isNull(spaces.deletedAt)))
        .limit(1);
      if (roomSlug !== undefined && named === undefined) {
        request.log.warn({ event: "enquiry.room_unknown", venueId: venue.id, roomSlug }, "enquiry named a room the venue does not have");
      }
      anchor = named === undefined
        ? { venueId: venue.id, spaceId: flagship.id, configurationId: null, roomName: null, venuePath: true, venueSlug: slug }
        : { venueId: venue.id, spaceId: named.id, configurationId: null, roomName: named.name, venuePath: true, venueSlug: slug };
    }

    // Two senders ride this route without booking this venue's rooms: the
    // workspace gate's "Request access" (someone asking to be let into the
    // venue's Venviewer workspace) and the pricing page's "Talk to us about
    // your venue" (a venue asking about Venviewer for its own rooms). Each is
    // stored and announced as what it is, and the booking acknowledgement
    // below (rooms, dates, costs) is sent only for a real room enquiry; both
    // screens that send the others already confirm the request in place.
    const accessRequest = parsed.data.eventType === VENUE_ACCESS_ENQUIRY_TYPE;
    const pricingEnquiry = parsed.data.eventType === VENVIEWER_PRICING_ENQUIRY_TYPE;
    // How it reached the venue, kept in its own column rather than written
    // into the guest's message. The planner sends a configuration. On the
    // venue path the website's own form (the front door and /fresh) says it
    // is the website's, and the workspace gate and the pricing page are the
    // website's whatever they send. One that names no source is the
    // walkthrough's, which predates the field (GUEST_ENQUIRY_SOURCES).
    const source: EnquirySource = !anchor.venuePath ? "planner"
      : accessRequest || pricingEnquiry ? "website"
        : parsed.data.source ?? "walkthrough";

    // Where the person found the venue (migration 0100), when the page sent
    // it: only the referring site's host and three cleaned UTM tags are kept,
    // with the channel they name. Read only once the privacy notice describes
    // it (funnelBrowserSignalsEnabled); until then whatever a page sends is
    // ignored and the columns stay empty.
    const browserSignals = funnelBrowserSignalsEnabled();
    let attribution: EnquiryAttributionRecord | null = null;
    if (browserSignals && parsed.data.attribution !== undefined) {
      const venueSlug = anchor.venueSlug ?? (await db.select({ slug: venues.slug }).from(venues)
        .where(eq(venues.id, anchor.venueId)).limit(1))[0]?.slug ?? null;
      attribution = attributeEnquiry(parsed.data.attribution, acquisitionContextFor(venueSlug));
    }

    // The enquiry (status: submitted, skipping draft), its status history and
    // the guest lead are written together or not at all; the person the
    // enquiry came from is found or made in the same transaction, in a
    // savepoint of its own (below). The guest is not signed in and
    // can be anyone, so nothing they send is trusted to choose a person: the
    // enquiry finds the venue's one live person who holds its email, however
    // it was typed, or makes them, locked on the venue and the email so two
    // at once make one person. An email two people share (a couple) links
    // neither and makes no third. The answer below is the same whichever
    // happened, so it never says whether an email is known. An access request
    // or a Venviewer pricing enquiry rides this route without being one of
    // the venue's clients, so it is neither linked nor made a person, as the
    // People Book's backfill (0098) leaves those out.
    const displayName = parsed.data.name ?? parsed.data.email;
    const engagement = browserSignals ? parsed.data.engagement ?? [] : [];
    const stored = await db.transaction(async (tx) => {
      const [enquiry] = await tx.insert(enquiries).values({
        configurationId: anchor.configurationId,
        venueId: anchor.venueId,
        spaceId: anchor.spaceId,
        userId: null,
        guestEmail: parsed.data.email,
        guestPhone: parsed.data.phone ?? null,
        guestName: parsed.data.name ?? null,
        state: "submitted",
        // enquiries.name holds 200 characters and an email may be 255: a guest
        // who gives no name is filed under their email cut to the column, as
        // the person made from it is (people-link.ts), never refused for it.
        name: displayName.slice(0, ENQUIRY_NAME_MAX),
        email: parsed.data.email,
        preferredDate: parsed.data.eventDate ?? null,
        eventType: parsed.data.eventType ?? null,
        estimatedGuests: parsed.data.guestCount ?? null,
        message: parsed.data.message ?? null,
        source,
        roomChosen: anchor.roomName !== null,
        ...(attribution === null ? {} : {
          referrerHost: attribution.referrerHost,
          utmSource: attribution.utmSource,
          utmMedium: attribution.utmMedium,
          utmCampaign: attribution.utmCampaign,
          acquisitionChannel: attribution.acquisitionChannel,
        }),
      }).returning();
      if (enquiry === undefined) return null;

      // A guest submission is attributed to nobody (changedBy is null).
      await tx.insert(enquiryStatusHistory).values({
        enquiryId: enquiry.id,
        fromStatus: "draft",
        toStatus: "submitted",
        changedBy: null,
        note: "Guest submission",
      });

      // Finding the person enriches the enquiry; the enquiry is the venue's
      // business record. So the link runs in a savepoint: should it fail, it
      // is rolled back alone (its advisory lock with it, which is safe, as
      // nothing it guarded was written) and the enquiry, its history and its
      // lead are still kept, with no person. Create-from-enquiry links it
      // when the team works it.
      let link: LinkOutcome | null = null;
      let linkFailure: { errorName: string; pgCode: string | null } | null = null;
      if (isBookingEnquiry(parsed.data.eventType)) {
        try {
          link = await tx.transaction((savepoint) => linkEnquiryToPerson(savepoint, {
            id: enquiry.id,
            venueId: enquiry.venueId,
            contactId: null,
            email: parsed.data.email,
            name: parsed.data.name ?? null,
            phone: parsed.data.phone ?? null,
          }, { ownerUserId: null, whenShared: "leave" }));
        } catch (error) {
          linkFailure = linkFailureOf(error);
        }
      }

      // The guest lead is written once, by the first enquiry from that exact
      // email, and never changed afterwards. It names no venue, so updating
      // it let any venue's enquiry overwrite the name and phone another
      // venue's guest gave.
      await tx.execute(sql`
        INSERT INTO guest_leads (email, phone, name, first_enquiry_id)
        SELECT ${parsed.data.email}::text, ${parsed.data.phone ?? null}::text, ${parsed.data.name ?? null}::text, ${enquiry.id}::uuid
        WHERE NOT EXISTS (SELECT 1 FROM guest_leads WHERE email = ${parsed.data.email}::text)
      `);

      // What happened before the person sent it (a 30-second walk of the
      // twin), attached to this enquiry and nothing else, under the same rule
      // as attribution. Like the link it enriches the enquiry, so it runs in a
      // savepoint of its own: should it fail, it is rolled back alone and the
      // enquiry is kept, never turned into a failed submission the guest
      // would send again.
      let engagementFailure: { errorName: string; pgCode: string | null } | null = null;
      if (engagement.length > 0) {
        try {
          await tx.transaction((savepoint) => recordEnquiryEngagement(savepoint, {
            venueId: anchor.venueId,
            enquiryId: enquiry.id,
            spaceId: anchor.roomName === null ? null : anchor.spaceId,
            kinds: engagement,
          }));
        } catch (error) {
          engagementFailure = linkFailureOf(error);
        }
      }
      return { enquiry, link, linkFailure, engagementFailure };
    });

    if (stored === null) {
      return reply.status(500).send({ error: "Failed to create enquiry", code: "INTERNAL_ERROR" });
    }
    const { enquiry, link, linkFailure, engagementFailure } = stored;
    // Ids, the outcome and a failure's class and SQLSTATE only: never the
    // guest's email, name or phone, nor an error's message.
    if (link !== null) {
      request.log.info(
        { event: "enquiry.person_linked", enquiryId: enquiry.id, venueId: anchor.venueId, outcome: link.outcome },
        "enquiry.person_linked",
      );
    }
    if (linkFailure !== null) {
      request.log.error(
        { event: "enquiry.person_link_failed", enquiryId: enquiry.id, venueId: anchor.venueId, ...linkFailure },
        "enquiry kept without a person: finding or making its person failed",
      );
    }
    if (engagementFailure !== null) {
      request.log.error(
        { event: "enquiry.engagement_failed", enquiryId: enquiry.id, venueId: anchor.venueId, ...engagementFailure },
        "enquiry kept without its engagement: recording it failed",
      );
    }

    // Notify hallkeeper(s) of the venue
    const roomName = anchor.roomName;
    // The occasion as a person reads it: "a corporate event", never "a corporate".
    const occasion = occasionPhrase(parsed.data.eventType);
    const eventTypeWords = accessRequest ? "Access request" : pricingEnquiry ? "Venviewer enquiry" : occasionLabel(parsed.data.eventType);
    const [venueRow] = await db.select({ name: venues.name })
      .from(venues)
      .where(eq(venues.id, anchor.venueId))
      .limit(1);
    const venueName = venueRow?.name ?? "our venue";

    // In-app notification for the commercial team (staff, venue admin, sales).
    // Email alone was the whole announcement path: a hallkeeper who never
    // opened their inbox had no signal at all, and staff and sales were never
    // told. This is venue-scoped and carries no event, which the notification
    // list route already supports. A failure here must not fail the guest's
    // submission — the enquiry row is already committed and is the record of
    // truth — so it is logged loudly instead.
    try {
      const notified = await notifyCommercialTeam(db, {
        venueId: anchor.venueId,
        ...(accessRequest ? {
          title: "Access request",
          body: `${displayName} asked for access to ${venueName}'s Venviewer workspace. Open Enquiries to read the request.`,
        } : pricingEnquiry ? {
          title: "Venviewer enquiry",
          body: `${displayName} asked about Venviewer for their own venue, from the pricing page. Open Enquiries to read it.`,
        } : {
          title: roomName === null ? "New enquiry" : `New enquiry — ${roomName}`,
          body: `${displayName} ${roomName === null ? `enquired ${SOURCE_PHRASE[source]}` : `enquired about ${roomName}`}${
            occasion === null ? "" : ` for ${occasion}`
          }${
            parsed.data.eventDate === undefined ? "" : ` on ${parsed.data.eventDate}`
          }${roomName === null ? ", without choosing a room" : ""}. Open Enquiries to respond.`,
        }),
        severity: "attention",
        actionPath: "/dashboard?view=enquiries",
      });
      request.log.info(
        { event: "enquiry.notified", enquiryId: enquiry.id, venueId: anchor.venueId, notified },
        "enquiry.notified",
      );
    } catch (err) {
      request.log.error(
        {
          event: "enquiry.notification_failed",
          enquiryId: enquiry.id,
          venueId: anchor.venueId,
          // Under `err` so the logger's error serializer owns the policy: a
          // drizzle failure's message carries the notification's parameters
          // (the guest's name or email), which `error: err.message` would log.
          err,
        },
        "enquiry stored but the in-app notification could not be written",
      );
    }

    // The venue's own acknowledgement to the organiser. Until this existed a
    // guest got a 201 and silence. Idempotent per enquiry, so a retried POST
    // or a replayed webhook cannot thank the same person twice, and at most
    // one a day to one address (oneAcknowledgementADay).
    if (!accessRequest && !pricingEnquiry) {
      const acknowledgement = await enquiryAcknowledgement({
        venueName,
        roomName,
        // Greeted by only when it reads as a name; never the address it goes to.
        organiserName: parsed.data.name ?? null,
        eventType: offeredOccasionLabel(parsed.data.eventType),
        eventDate: parsed.data.eventDate ?? null,
        guestCount: parsed.data.guestCount ?? null,
        replyToEmail: resolveEmailReplyTo(),
      });
      sendEmailAsync({ to: parsed.data.email, ...acknowledgement }, {
        db,
        idempotencyKey: `${ACKNOWLEDGEMENT_KEY}${enquiry.id}`,
        logger: request.log,
        limit: oneAcknowledgementADay(parsed.data.email),
      });
    }

    // ENQUIRY_EMAIL_ROLES at this venue, one email per inbox.
    const venueRecipients = await db.select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.venueId, anchor.venueId), inArray(users.role, [...ENQUIRY_EMAIL_ROLES])));
    const seenInboxes = new Set<string>();
    const announced = venueRecipients.filter((user) => {
      const inbox = user.email.trim().toLowerCase();
      if (seenInboxes.has(inbox)) return false;
      seenInboxes.add(inbox);
      return true;
    });

    // A venue with none of those users is the silent-revenue-leak case: the
    // enquiry is stored, this loop runs zero times, and the guest still gets a
    // 201 saying the events team has it. Fall back to a configured address so a
    // lead can never reach nobody, and log loudly when there is no one at all.
    const fallbackRaw = process.env["ENQUIRY_FALLBACK_EMAIL"] ?? "";
    const fallback = fallbackRaw.trim();
    const recipients: readonly { id: string; email: string }[] =
      announced.length > 0
        ? announced
        : fallback !== ""
          ? [{ id: "fallback", email: fallback }]
          : [];

    if (recipients.length === 0) {
      request.log.error(
        { enquiryId: enquiry.id, venueId: anchor.venueId },
        "enquiry stored but NOT announced: venue has no sales, manager or hallkeeper user and ENQUIRY_FALLBACK_EMAIL is unset",
      );
    }

    for (const hk of recipients) {
      const emailData = await newEnquiryNotification({
        roomName,
        source,
        eventType: eventTypeWords,
        contactName: displayName,
        contactEmail: parsed.data.email,
        contactPhone: parsed.data.phone ?? null,
        eventDate: parsed.data.eventDate ?? null,
        guestCount: parsed.data.guestCount ?? null,
        message: parsed.data.message ?? null,
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
