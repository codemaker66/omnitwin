import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { venues, spaces } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { PaginationQuerySchema, paginate } from "../utils/pagination.js";
import { canManageVenue } from "../utils/query.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateVenueBody = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/),
  address: z.string().trim().min(1).max(500),
  logoUrl: z.string().url().nullable().optional(),
  brandColour: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

const UpdateVenueBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  address: z.string().trim().min(1).max(500).optional(),
  logoUrl: z.string().url().nullable().optional(),
  brandColour: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

const IdParam = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function venueRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // GET /venues — public, paginated
  server.get("/", async (request, reply) => {
    const pq = PaginationQuerySchema.safeParse(request.query);
    if (!pq.success) {
      return reply.status(400).send({ error: "Invalid pagination", code: "VALIDATION_ERROR", details: pq.error.issues });
    }

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(venues)
      .where(isNull(venues.deletedAt));

    const total = countResult?.count ?? 0;

    const rows = await db.select()
      .from(venues)
      .where(isNull(venues.deletedAt))
      .limit(pq.data.limit)
      .offset(pq.data.offset)
      .orderBy(venues.createdAt);

    return paginate(rows, total, pq.data);
  });

  // GET /venues/:id — public, with spaces
  server.get("/:id", async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const [venue] = await db.select()
      .from(venues)
      .where(eq(venues.id, params.data.id))
      .limit(1);

    if (venue === undefined || venue.deletedAt !== null) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }

    const venueSpaces = await db.select()
      .from(spaces)
      .where(and(eq(spaces.venueId, venue.id), isNull(spaces.deletedAt)));

    return { data: { ...venue, spaces: venueSpaces } };
  });

  // POST /venues — admin only
  server.post("/", { preHandler: [authenticate, authorize("admin")] }, async (request, reply) => {
    const parsed = CreateVenueBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const existing = await db.select({ id: venues.id }).from(venues).where(eq(venues.slug, parsed.data.slug)).limit(1);
    if (existing.length > 0) {
      return reply.status(409).send({ error: "Slug already exists", code: "SLUG_EXISTS" });
    }

    const [venue] = await db.insert(venues).values({
      name: parsed.data.name,
      slug: parsed.data.slug,
      address: parsed.data.address,
      logoUrl: parsed.data.logoUrl ?? null,
      brandColour: parsed.data.brandColour ?? null,
    }).returning();

    return reply.status(201).send({ data: venue });
  });

  // PATCH /venues/:id — admin or hallkeeper of that venue
  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }
    const parsed = UpdateVenueBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [venue] = await db.select().from(venues).where(eq(venues.id, params.data.id)).limit(1);
    if (venue === undefined || venue.deletedAt !== null) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }

    if (!canManageVenue(request.user, venue.id)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const [updated] = await db.update(venues)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(venues.id, params.data.id))
      .returning();

    return { data: updated };
  });

  // DELETE /venues/:id — admin only, soft delete
  server.delete("/:id", { preHandler: [authenticate, authorize("admin")] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const [venue] = await db.select().from(venues).where(eq(venues.id, params.data.id)).limit(1);
    if (venue === undefined || venue.deletedAt !== null) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }

    await db.update(venues)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(venues.id, params.data.id));

    return reply.status(204).send();
  });
}
