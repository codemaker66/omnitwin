import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, asc, inArray, isNull, sql } from "drizzle-orm";
import {
  users, configurations, enquiries, guestLeads,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, isPlatformAdmin } from "../middleware/auth.js";
import { canManageCommercial, canManageVenue } from "../utils/query.js";
import { contactProfile, searchClients } from "../services/client-search.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const SearchQuery = z.object({ q: z.string().trim().min(2).max(200) });
const UserIdParam = z.object({ userId: z.string().uuid() });
const LeadIdParam = z.object({ leadId: z.string().uuid() });
const ContactIdParam = z.object({ contactId: z.string().uuid() });

/** The enquiries that are still live: new, in review, or approved. */
const LIVE_ENQUIRY_STATES = ["submitted", "under_review", "approved"] as const;

/** An enquiry as the Clients desk lists it: who, what, when, and the guest's
 *  lead, so a guest opens on their own profile. */
const enquiryClientColumns = {
  id: enquiries.id,
  state: enquiries.state,
  name: enquiries.name,
  email: enquiries.email,
  guestEmail: enquiries.guestEmail,
  guestPhone: enquiries.guestPhone,
  guestName: enquiries.guestName,
  userId: enquiries.userId,
  leadId: sql<string | null>`(SELECT id FROM guest_leads WHERE email = ${enquiries.guestEmail} LIMIT 1)`,
  eventType: enquiries.eventType,
  preferredDate: enquiries.preferredDate,
  createdAt: enquiries.createdAt,
};

// ---------------------------------------------------------------------------
// Plugin — client search and profiles for hallkeepers
// ---------------------------------------------------------------------------

export async function clientRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // GET /clients/search?q=... — the venue floor, or a platform admin. Typo
  // tolerant; see services/client-search.ts.
  server.get("/search", { preHandler: [authenticate] }, async (request, reply) => {
    const query = SearchQuery.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Query must be at least 2 characters", code: "VALIDATION_ERROR" });
    }

    if (!canManageVenue(request.user, request.user.venueId ?? "")) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    // A platform admin searches every venue; anyone else, their own. The
    // commercial record (contacts, accounts, deals, proposals) is found only
    // by the roles that work it (services/client-search.ts).
    const venueId = isPlatformAdmin(request.user) ? null : request.user.venueId;
    const results = await searchClients(db, query.data.q, {
      venueId,
      commercial: canManageCommercial(request.user, request.user.venueId ?? ""),
    });
    return { data: results };
  });

  // GET /clients/contacts/:contactId/profile — a contact, their organisation,
  // deals and proposals. The commercial record: the commercial roles only.
  server.get("/contacts/:contactId/profile", { preHandler: [authenticate] }, async (request, reply) => {
    const params = ContactIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid contact ID", code: "VALIDATION_ERROR" });
    }
    if (!canManageCommercial(request.user, request.user.venueId ?? "")) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const profile = await contactProfile(db, params.data.contactId, isPlatformAdmin(request.user) ? null : request.user.venueId);
    if (profile === null) {
      return reply.status(404).send({ error: "Contact not found", code: "NOT_FOUND" });
    }
    return { data: profile };
  });

  // GET /clients/:userId/profile — full client profile
  server.get("/:userId/profile", { preHandler: [authenticate] }, async (request, reply) => {
    const params = UserIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid user ID", code: "VALIDATION_ERROR" });
    }

    if (!canManageVenue(request.user, request.user.venueId ?? "")) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const profileVenueId = request.user.venueId;
    const profileIsAdmin = isPlatformAdmin(request.user);

    // Non-admin: verify the target user has configs or enquiries at this venue
    // BEFORE returning any PII (prevents IDOR exposure of unrelated users)
    if (!profileIsAdmin) {
      const [hasRelation] = await db.select({ n: sql<number>`1` })
        .from(users)
        .where(and(
          eq(users.id, params.data.userId),
          sql`(
            EXISTS (SELECT 1 FROM configurations WHERE user_id = ${params.data.userId} AND venue_id = ${profileVenueId} AND deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM enquiries WHERE user_id = ${params.data.userId} AND venue_id = ${profileVenueId})
          )`,
        ))
        .limit(1);
      if (hasRelation === undefined) {
        return reply.status(404).send({ error: "User not found", code: "NOT_FOUND" });
      }
    }

    const [user] = await db.select({
      id: users.id,
      displayName: users.displayName,
      organizationName: users.organizationName,
      email: users.email,
      phone: users.phone,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    })
      .from(users)
      .where(eq(users.id, params.data.userId))
      .limit(1);

    if (user === undefined) {
      return reply.status(404).send({ error: "User not found", code: "NOT_FOUND" });
    }

    const configs = await db.select({
      id: configurations.id,
      name: configurations.name,
      spaceName: sql<string>`(SELECT name FROM spaces WHERE id = ${configurations.spaceId})`,
      objectCount: sql<number>`(SELECT count(*)::int FROM placed_objects WHERE configuration_id = ${configurations.id})`,
      createdAt: configurations.createdAt,
    })
      .from(configurations)
      .where(and(
        eq(configurations.userId, params.data.userId),
        isNull(configurations.deletedAt),
        profileIsAdmin ? undefined : eq(configurations.venueId, profileVenueId ?? ""),
      ));

    const userEnquiries = await db.select({
      id: enquiries.id,
      state: enquiries.state,
      eventType: enquiries.eventType,
      preferredDate: enquiries.preferredDate,
      spaceName: sql<string>`(SELECT name FROM spaces WHERE id = ${enquiries.spaceId})`,
      // False when the guest named no room: spaceName is then where the
      // enquiry is filed, not what they asked for (migration 0079).
      roomChosen: enquiries.roomChosen,
    })
      .from(enquiries)
      .where(and(
        eq(enquiries.userId, params.data.userId),
        profileIsAdmin ? undefined : eq(enquiries.venueId, profileVenueId ?? ""),
      ));

    return {
      data: {
        user,
        configurations: configs,
        enquiries: userEnquiries,
      },
    };
  });

  // GET /clients/leads/:leadId/profile — guest lead profile
  server.get("/leads/:leadId/profile", { preHandler: [authenticate] }, async (request, reply) => {
    const params = LeadIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid lead ID", code: "VALIDATION_ERROR" });
    }

    if (!canManageVenue(request.user, request.user.venueId ?? "")) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const leadVenueId = request.user.venueId;
    const leadIsAdmin = isPlatformAdmin(request.user);

    // Non-admin: verify this lead has enquiries at the hallkeeper's venue
    // BEFORE returning any PII. See venueLeadFilter above — the join is on
    // `guest_email` + `venue_id`; we deliberately don't require
    // `user_id IS NULL` so that previously claimed enquiries still count
    // toward "this lead has been in contact with our venue".
    if (!leadIsAdmin) {
      const [hasRelation] = await db.select({ n: sql<number>`1` })
        .from(guestLeads)
        .where(and(
          eq(guestLeads.id, params.data.leadId),
          sql`EXISTS (SELECT 1 FROM enquiries WHERE guest_email = ${guestLeads.email} AND venue_id = ${leadVenueId})`,
        ))
        .limit(1);
      if (hasRelation === undefined) {
        return reply.status(404).send({ error: "Guest lead not found", code: "NOT_FOUND" });
      }
    }

    const [lead] = await db.select()
      .from(guestLeads)
      .where(eq(guestLeads.id, params.data.leadId))
      .limit(1);

    if (lead === undefined) {
      return reply.status(404).send({ error: "Guest lead not found", code: "NOT_FOUND" });
    }

    // All enquiries this lead has submitted at this venue. We match on
    // `guest_email` alone (not `user_id IS NULL`) so claimed enquiries
    // still appear in the lead's history — the lead profile is about the
    // contact, not the current ownership of the underlying config.
    const leadEnquiries = await db.select({
      id: enquiries.id,
      state: enquiries.state,
      eventType: enquiries.eventType,
      preferredDate: enquiries.preferredDate,
      spaceName: sql<string>`(SELECT name FROM spaces WHERE id = ${enquiries.spaceId})`,
      roomChosen: enquiries.roomChosen,
      createdAt: enquiries.createdAt,
    })
      .from(enquiries)
      .where(and(
        eq(enquiries.guestEmail, lead.email),
        leadIsAdmin ? undefined : eq(enquiries.venueId, leadVenueId ?? ""),
      ));

    return {
      data: {
        lead,
        enquiries: leadEnquiries,
      },
    };
  });

  // GET /clients/recent — last 20 enquiries with contact info
  server.get("/recent", { preHandler: [authenticate] }, async (request, reply) => {
    if (!canManageVenue(request.user, request.user.venueId ?? "")) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const venueFilter = isPlatformAdmin(request.user)
      ? undefined
      : eq(enquiries.venueId, request.user.venueId ?? "");

    const recentEnquiries = await db.select(enquiryClientColumns)
      .from(enquiries)
      .where(venueFilter)
      .orderBy(sql`${enquiries.createdAt} DESC`)
      .limit(20);

    return { data: recentEnquiries };
  });

  // GET /clients/upcoming — the clients whose events come next: live
  // enquiries whose date is today or within the year ahead, soonest first.
  server.get("/upcoming", { preHandler: [authenticate] }, async (request, reply) => {
    if (!canManageVenue(request.user, request.user.venueId ?? "")) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const upcoming = await db.select(enquiryClientColumns)
      .from(enquiries)
      .where(and(
        isPlatformAdmin(request.user) ? undefined : eq(enquiries.venueId, request.user.venueId ?? ""),
        inArray(enquiries.state, [...LIVE_ENQUIRY_STATES]),
        sql`${enquiries.preferredDate} >= (now() AT TIME ZONE 'Europe/London')::date`,
        sql`${enquiries.preferredDate} < (now() AT TIME ZONE 'Europe/London')::date + 366`,
      ))
      .orderBy(asc(enquiries.preferredDate), asc(enquiries.createdAt))
      .limit(10);
    return { data: upcoming };
  });
}
