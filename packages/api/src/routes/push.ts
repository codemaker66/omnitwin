import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { pushSubscriptions } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { vapidPublicKey } from "../services/push.js";
import { canManageVenue } from "../utils/query.js";

// ---------------------------------------------------------------------------
// A device asks to be told (goal 19 S7). One subscription per browser
// endpoint, owned by the signed-in person at one venue; the floor only. The
// endpoint is the identity: the same device subscribing again updates its
// own row and comes back on if a push service had marked it gone.
// ---------------------------------------------------------------------------

const DeviceKindSchema = z.enum(["wall", "phone", "desk"]);

const SubscribeBody = z.object({
  venueId: z.string().uuid(),
  endpoint: z.string().url().max(2000).refine((url) => url.startsWith("https://"), "Push endpoints are https"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }).strict(),
  deviceKind: DeviceKindSchema,
  userAgent: z.string().max(300).optional(),
}).strict();

const UnsubscribeBody = z.object({ endpoint: z.string().url().max(2000) }).strict();

export async function pushRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  // The public half of the key pair, for the browser's subscribe call. Null
  // while push is off, and the switch says so.
  server.get("/vapid-public-key", { preHandler: [authenticate] }, async () => {
    const publicKey = vapidPublicKey();
    return { data: publicKey === null ? null : { publicKey } };
  });

  server.post("/subscriptions", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = SubscribeBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    if (!canManageVenue(request.user, parsed.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const now = new Date();
    const values = {
      userId: request.user.id,
      venueId: parsed.data.venueId,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      deviceKind: parsed.data.deviceKind,
      userAgent: parsed.data.userAgent ?? null,
      disabledAt: null,
    };
    const [row] = await db
      .insert(pushSubscriptions)
      .values({ ...values, endpoint: parsed.data.endpoint, createdAt: now })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })
      .returning({ id: pushSubscriptions.id, deviceKind: pushSubscriptions.deviceKind, createdAt: pushSubscriptions.createdAt });
    if (row === undefined) return reply.status(500).send({ error: "Subscription could not be saved", code: "SERVER_ERROR" });
    return reply.status(201).send({ data: { id: row.id, deviceKind: row.deviceKind, createdAt: row.createdAt.toISOString() } });
  });

  // The endpoint rides in the query: a DELETE carries no body through the
  // house client.
  server.delete("/subscriptions", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = UnsubscribeBody.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, parsed.data.endpoint), eq(pushSubscriptions.userId, request.user.id)));
    return reply.status(204).send();
  });

  // The signed-in person's live devices, for the switch's first reading and
  // for a rehearsal to assert against.
  server.get("/subscriptions/mine", { preHandler: [authenticate] }, async (request) => {
    const rows = await db
      .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, deviceKind: pushSubscriptions.deviceKind, venueId: pushSubscriptions.venueId, createdAt: pushSubscriptions.createdAt })
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, request.user.id), isNull(pushSubscriptions.disabledAt)))
      .limit(50);
    return { data: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) };
  });
}
