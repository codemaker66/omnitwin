import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { Webhook } from "svix";
import { users } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Clerk webhook events — sync user data to local DB
// ---------------------------------------------------------------------------

interface ClerkEmailAddress {
  readonly email_address: string;
  readonly id: string;
}

interface ClerkUserEvent {
  readonly id: string;
  readonly email_addresses: readonly ClerkEmailAddress[];
  readonly primary_email_address_id: string;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly phone_numbers: readonly { readonly phone_number: string }[];
  readonly public_metadata: Record<string, unknown>;
}

interface ClerkWebhookPayload {
  readonly type: string;
  readonly data: ClerkUserEvent;
}

function getPrimaryEmail(data: ClerkUserEvent): string {
  const primary = data.email_addresses.find((e) => e.id === data.primary_email_address_id);
  return primary?.email_address ?? data.email_addresses[0]?.email_address ?? "";
}

function getFullName(data: ClerkUserEvent): string {
  const parts = [data.first_name, data.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "User";
}

export async function webhookRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;
  const webhookSecret = process.env["CLERK_WEBHOOK_SECRET"];

  server.post("/clerk", {
    config: { rawBody: true },
  }, async (request, reply) => {
    // --- Signature verification ---
    if (webhookSecret !== undefined && webhookSecret !== "") {
      const svixId = request.headers["svix-id"] as string | undefined;
      const svixTimestamp = request.headers["svix-timestamp"] as string | undefined;
      const svixSignature = request.headers["svix-signature"] as string | undefined;

      if (svixId === undefined || svixTimestamp === undefined || svixSignature === undefined) {
        return reply.status(401).send({ error: "Missing svix headers", code: "UNAUTHORIZED" });
      }

      try {
        const wh = new Webhook(webhookSecret);
        // Use the actual raw bytes captured by fastify-raw-body.
        // JSON.stringify(request.body) can differ from the original payload
        // (key ordering, whitespace) which breaks HMAC signature verification.
        const body = (request as unknown as { rawBody?: Buffer }).rawBody;
        if (body === undefined) {
          return reply.status(500).send({ error: "Raw body not available", code: "INTERNAL_ERROR" });
        }
        wh.verify(body.toString("utf-8"), {
          "svix-id": svixId,
          "svix-timestamp": svixTimestamp,
          "svix-signature": svixSignature,
        });
      } catch {
        return reply.status(401).send({ error: "Invalid webhook signature", code: "UNAUTHORIZED" });
      }
    } else {
      // Punch list #5: signature verification can ONLY be skipped in
      // non-production environments. Startup validation in env.ts already
      // refuses to boot production without CLERK_WEBHOOK_SECRET, so this
      // branch is theoretically unreachable in prod — but the check is
      // a belt-and-suspenders defense in case startup was bypassed
      // (e.g. someone unsets the env var after boot).
      if (process.env["NODE_ENV"] === "production") {
        server.log.error("CLERK_WEBHOOK_SECRET unset in production — refusing webhook to avoid silently accepting unsigned events");
        return reply.status(500).send({ error: "Webhook verification not configured", code: "INTERNAL_ERROR" });
      }
      server.log.warn("CLERK_WEBHOOK_SECRET not set — skipping webhook signature verification (dev mode only)");
    }

    // --- Process event ---
    const payload = request.body as ClerkWebhookPayload;
    const { type, data } = payload;

    // Allowed roles — prevents privilege escalation via Clerk public_metadata.
    // If an unknown role arrives, default to "planner" (lowest privilege).
    const ALLOWED_ROLES = new Set(["client", "planner", "staff", "hallkeeper", "admin"]);
    const sanitizeRole = (raw: unknown): string => {
      if (typeof raw === "string" && ALLOWED_ROLES.has(raw)) return raw;
      return "planner";
    };

    try {
      if (type === "user.created") {
        const email = getPrimaryEmail(data);
        const name = getFullName(data);
        const role = sanitizeRole(data.public_metadata?.["role"]);
        const venueId = (data.public_metadata?.["venueId"] as string) ?? null;
        const phone = data.phone_numbers[0]?.phone_number ?? null;

        const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (existing !== undefined) {
          await db.update(users).set({ clerkId: data.id, name, updatedAt: new Date() }).where(eq(users.id, existing.id));
        } else {
          await db.insert(users).values({
            clerkId: data.id, email, name, displayName: name, phone, role, venueId,
          });
        }

        return reply.status(200).send({ received: true });
      }

      if (type === "user.updated") {
        const email = getPrimaryEmail(data);
        const name = getFullName(data);
        const phone = data.phone_numbers[0]?.phone_number ?? null;

        // Always sync role and venueId from metadata. If the key was removed
        // from Clerk, fall back to defaults so stale values don't persist.
        const role = sanitizeRole(data.public_metadata?.["role"]);
        const rawVenueId = data.public_metadata?.["venueId"];
        const venueId = typeof rawVenueId === "string" && rawVenueId.length > 0 ? rawVenueId : null;

        await db.update(users).set({
          email, name, displayName: name, phone, role, venueId, updatedAt: new Date(),
        }).where(eq(users.clerkId, data.id));

        return reply.status(200).send({ received: true });
      }

      if (type === "user.deleted") {
        await db.update(users).set({ clerkId: null, updatedAt: new Date() }).where(eq(users.clerkId, data.id));
        return reply.status(200).send({ received: true });
      }
    } catch (err) {
      // Return 200 to avoid Clerk retries, but log the DB error
      server.log.error({ err, type: payload.type }, "Clerk webhook DB error");
    }

    return reply.status(200).send({ received: true });
  });
}
