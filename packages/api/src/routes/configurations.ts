import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, sql } from "drizzle-orm";
import { configurations, spaces } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { PaginationQuerySchema, paginate } from "../utils/pagination.js";
import { canAccessResource } from "../utils/query.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const IdParam = z.object({ id: z.string().uuid() });

const CreateConfigBody = z.object({
  spaceId: z.string().uuid(),
  venueId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  layoutStyle: z.enum(["ceremony", "dinnerRounds", "dinnerBanquet", "theatre", "boardroom", "cabaret", "cocktail", "custom"]),
  guestCount: z.number().int().nonnegative().default(0),
  isTemplate: z.boolean().default(false),
  visibility: z.enum(["private", "staff", "public"]).default("private"),
});

const UpdateConfigBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  state: z.enum(["draft", "published"]).optional(),
  layoutStyle: z.enum(["ceremony", "dinnerRounds", "dinnerBanquet", "theatre", "boardroom", "cabaret", "cocktail", "custom"]).optional(),
  guestCount: z.number().int().nonnegative().optional(),
  visibility: z.enum(["private", "staff", "public"]).optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function configurationRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // GET /configurations — authenticated, filtered by role
  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const pq = PaginationQuerySchema.safeParse(request.query);
    if (!pq.success) {
      return reply.status(400).send({ error: "Invalid pagination", code: "VALIDATION_ERROR" });
    }

    const user = request.user;
    let whereClause;

    if (user.role === "admin") {
      // Admin sees all non-deleted configurations
      whereClause = isNull(configurations.deletedAt);
    } else if ((user.role === "staff" || user.role === "hallkeeper") && user.venueId !== null) {
      // Staff/hallkeeper sees configs for their venue
      whereClause = and(
        eq(configurations.venueId, user.venueId),
        isNull(configurations.deletedAt),
      );
    } else {
      // Everyone else sees only their own
      whereClause = and(
        eq(configurations.userId, user.id),
        isNull(configurations.deletedAt),
      );
    }

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(configurations)
      .where(whereClause);

    const total = countResult?.count ?? 0;

    const rows = await db.select()
      .from(configurations)
      .where(whereClause)
      .limit(pq.data.limit)
      .offset(pq.data.offset)
      .orderBy(configurations.updatedAt);

    return paginate(rows, total, pq.data);
  });

  // GET /configurations/:id — authenticated, owner/venue-admin/admin
  server.get("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const [config] = await db.select()
      .from(configurations)
      .where(and(eq(configurations.id, params.data.id), isNull(configurations.deletedAt)))
      .limit(1);

    if (config === undefined) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    return { data: config };
  });

  // POST /configurations — authenticated
  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateConfigBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Verify space exists
    const [space] = await db.select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.id, parsed.data.spaceId), isNull(spaces.deletedAt)))
      .limit(1);

    if (space === undefined) {
      return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    }

    const [config] = await db.insert(configurations).values({
      spaceId: parsed.data.spaceId,
      venueId: parsed.data.venueId,
      userId: request.user.id,
      name: parsed.data.name,
      layoutStyle: parsed.data.layoutStyle,
      guestCount: parsed.data.guestCount,
      isTemplate: parsed.data.isTemplate,
      visibility: parsed.data.visibility,
    }).returning();

    return reply.status(201).send({ data: config });
  });

  // PATCH /configurations/:id — owner or admin
  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const parsed = UpdateConfigBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [config] = await db.select()
      .from(configurations)
      .where(and(eq(configurations.id, params.data.id), isNull(configurations.deletedAt)))
      .limit(1);

    if (config === undefined) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updateData["name"] = parsed.data.name;
    if (parsed.data.state !== undefined) {
      updateData["state"] = parsed.data.state;
      if (parsed.data.state === "published") updateData["publishedAt"] = new Date();
    }
    if (parsed.data.layoutStyle !== undefined) updateData["layoutStyle"] = parsed.data.layoutStyle;
    if (parsed.data.guestCount !== undefined) updateData["guestCount"] = parsed.data.guestCount;
    if (parsed.data.visibility !== undefined) updateData["visibility"] = parsed.data.visibility;
    if (parsed.data.thumbnailUrl !== undefined) updateData["thumbnailUrl"] = parsed.data.thumbnailUrl;

    const [updated] = await db.update(configurations)
      .set(updateData)
      .where(eq(configurations.id, params.data.id))
      .returning();

    return { data: updated };
  });

  // DELETE /configurations/:id — owner or admin, soft delete
  server.delete("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const [config] = await db.select()
      .from(configurations)
      .where(and(eq(configurations.id, params.data.id), isNull(configurations.deletedAt)))
      .limit(1);

    if (config === undefined) {
      return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
    }

    if (!canAccessResource(request.user, config.userId, config.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    await db.update(configurations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(configurations.id, params.data.id));

    return reply.status(204).send();
  });
}
