import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, sql, ilike, or } from "drizzle-orm";
import {
  users, configurations, enquiries, guestLeads,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canManageVenue } from "../utils/query.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const SearchQuery = z.object({ q: z.string().trim().min(2).max(200) });
const UserIdParam = z.object({ userId: z.string().uuid() });
const LeadIdParam = z.object({ leadId: z.string().uuid() });

// ---------------------------------------------------------------------------
// Plugin — client search and profiles for hallkeepers
// ---------------------------------------------------------------------------

export async function clientRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // GET /clients/search?q=... — hallkeeper of venue or admin
  server.get("/search", { preHandler: [authenticate] }, async (request, reply) => {
    const query = SearchQuery.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Query must be at least 2 characters", code: "VALIDATION_ERROR" });
    }

    if (!canManageVenue(request.user, request.user.venueId ?? "")) {
      if (request.user.role !== "admin") {
        return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
      }
    }

    const pattern = `%${query.data.q}%`;
    const venueId = request.user.venueId;
    const isAdmin = request.user.role === "admin";

    // Search users — only those who have configurations or enquiries at this venue
    const venueUserFilter = isAdmin
      ? undefined
      : sql`(
          EXISTS (SELECT 1 FROM configurations WHERE user_id = ${users.id} AND venue_id = ${venueId} AND deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM enquiries WHERE user_id = ${users.id} AND venue_id = ${venueId})
        )`;

    const matchedUsers = await db.select({
      id: users.id,
      displayName: users.displayName,
      organizationName: users.organizationName,
      email: users.email,
      phone: users.phone,
      configurationCount: isAdmin
        ? sql<number>`(SELECT count(*)::int FROM configurations WHERE user_id = ${users.id} AND deleted_at IS NULL)`
        : sql<number>`(SELECT count(*)::int FROM configurations WHERE user_id = ${users.id} AND venue_id = ${venueId} AND deleted_at IS NULL)`,
      enquiryCount: isAdmin
        ? sql<number>`(SELECT count(*)::int FROM enquiries WHERE user_id = ${users.id})`
        : sql<number>`(SELECT count(*)::int FROM enquiries WHERE user_id = ${users.id} AND venue_id = ${venueId})`,
    })
      .from(users)
      .where(and(
        or(
          ilike(users.displayName, pattern),
          ilike(users.organizationName, pattern),
          ilike(users.email, pattern),
        ),
        venueUserFilter,
      ))
      .limit(20);

    // Search guest leads — only those with enquiries at this venue.
    //
    // A row in `enquiries` is "guest-originated" iff `guest_email` is set;
    // that bit is historical and permanent. When a user later claims the
    // public config the guest submitted against, the enquiry gets a
    // `user_id` but keeps its `guest_email` — the lead shouldn't vanish
    // from hallkeeper search just because the config changed hands. The
    // venue scope is enforced by joining on `guest_email` + `venue_id`
    // alone; claim state is irrelevant.
    const venueLeadFilter = isAdmin
      ? undefined
      : sql`EXISTS (SELECT 1 FROM enquiries WHERE guest_email = ${guestLeads.email} AND venue_id = ${venueId})`;

    const matchedLeads = await db.select({
      id: guestLeads.id,
      email: guestLeads.email,
      phone: guestLeads.phone,
      name: guestLeads.name,
      enquiryCount: isAdmin
        ? sql<number>`(SELECT count(*)::int FROM enquiries WHERE guest_email = ${guestLeads.email})`
        : sql<number>`(SELECT count(*)::int FROM enquiries WHERE guest_email = ${guestLeads.email} AND venue_id = ${venueId})`,
      convertedToUserId: guestLeads.convertedToUserId,
    })
      .from(guestLeads)
      .where(and(
        or(
          ilike(guestLeads.name, pattern),
          ilike(guestLeads.email, pattern),
        ),
        venueLeadFilter,
      ))
      .limit(20);

    // Search configurations — scoped to venue
    const venueConfigFilter = isAdmin
      ? undefined
      : eq(configurations.venueId, venueId ?? "");

    const matchedConfigs = await db.select({
      id: configurations.id,
      name: configurations.name,
      spaceName: sql<string>`(SELECT name FROM spaces WHERE id = ${configurations.spaceId})`,
      userName: sql<string | null>`(SELECT name FROM users WHERE id = ${configurations.userId})`,
      createdAt: configurations.createdAt,
    })
      .from(configurations)
      .where(and(
        ilike(configurations.name, pattern),
        isNull(configurations.deletedAt),
        venueConfigFilter,
      ))
      .limit(20);

    return {
      data: {
        users: matchedUsers,
        guestLeads: matchedLeads,
        configurations: matchedConfigs,
      },
    };
  });

  // GET /clients/:userId/profile — full client profile
  server.get("/:userId/profile", { preHandler: [authenticate] }, async (request, reply) => {
    const params = UserIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid user ID", code: "VALIDATION_ERROR" });
    }

    if (!canManageVenue(request.user, request.user.venueId ?? "")) {
      if (request.user.role !== "admin") {
        return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
      }
    }

    const profileVenueId = request.user.venueId;
    const profileIsAdmin = request.user.role === "admin";

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
      if (request.user.role !== "admin") {
        return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
      }
    }

    const leadVenueId = request.user.venueId;
    const leadIsAdmin = request.user.role === "admin";

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
      if (request.user.role !== "admin") {
        return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
      }
    }

    const venueFilter = request.user.role === "admin"
      ? undefined
      : eq(enquiries.venueId, request.user.venueId ?? "");

    const recentEnquiries = await db.select({
      id: enquiries.id,
      state: enquiries.state,
      name: enquiries.name,
      email: enquiries.email,
      guestEmail: enquiries.guestEmail,
      guestPhone: enquiries.guestPhone,
      guestName: enquiries.guestName,
      userId: enquiries.userId,
      eventType: enquiries.eventType,
      preferredDate: enquiries.preferredDate,
      createdAt: enquiries.createdAt,
    })
      .from(enquiries)
      .where(venueFilter)
      .orderBy(sql`${enquiries.createdAt} DESC`)
      .limit(20);

    return { data: recentEnquiries };
  });
}
