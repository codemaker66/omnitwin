import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { Webhook } from "svix";
import { users } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { getUserByClerkId, normalizeAuthEmail } from "../middleware/auth.js";

// ---------------------------------------------------------------------------
// Clerk webhook events — sync user data to local DB
// ---------------------------------------------------------------------------

interface ClerkEmailAddress {
  readonly email_address: string;
  readonly id: string;
  readonly verification?: {
    readonly status?: string;
  } | null;
}

interface ClerkUserEvent {
  readonly id: string;
  readonly email_addresses: readonly ClerkEmailAddress[];
  readonly primary_email_address_id: string;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly phone_numbers: readonly { readonly phone_number: string }[];
  readonly public_metadata: Record<string, unknown>;
  // Clerk mirrors the chosen username here when "Sign-up with username"
  // is enabled in the Clerk dashboard. We normalise invalid/empty values
  // to null so the DB CHECK constraint on users.username never rejects
  // a sync; a user can always update their handle via Clerk afterwards.
  readonly username: string | null;
}

// Mirror of @omnitwin/types UsernameSchema shape — duplicated inline so
// this route doesn't pull in the full schema module for one regex test.
const USERNAME_SHAPE = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])?$/;
function normaliseUsername(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const lower = raw.trim().toLowerCase();
  if (lower.length === 0) return null;
  return USERNAME_SHAPE.test(lower) ? lower : null;
}

interface ClerkWebhookPayload {
  readonly type: string;
  readonly data: ClerkUserEvent;
}

function emailIsVerified(email: ClerkEmailAddress): boolean {
  return email.verification?.status === "verified";
}

function getVerifiedPrimaryEmail(data: ClerkUserEvent): string | null {
  const primary = data.email_addresses.find((e) => e.id === data.primary_email_address_id);
  const candidate = primary ?? data.email_addresses[0] ?? null;
  if (candidate === null || !emailIsVerified(candidate)) return null;
  return normalizeAuthEmail(candidate.email_address);
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
      server.log.error("CLERK_WEBHOOK_SECRET unset — refusing webhook to avoid accepting unsigned events");
      return reply.status(500).send({ error: "Webhook verification not configured", code: "INTERNAL_ERROR" });
    }

    // --- Process event ---
    const payload = request.body as ClerkWebhookPayload;
    const { type, data } = payload;

    // Clerk metadata is profile data only. Role and venue scope come from
    // seed rows, invitation records, or explicit approved-domain policy.
    try {
      if (type === "user.created") {
        const email = getVerifiedPrimaryEmail(data);
        if (email === null) {
          server.log.warn({ clerkId: data.id }, "Clerk user.created ignored: verified email required");
          return reply.status(200).send({ received: true });
        }

        const name = getFullName(data);
        const phone = data.phone_numbers[0]?.phone_number ?? null;
        const username = normaliseUsername(data.username);
        const localUser = await getUserByClerkId(db, data.id, email);

        if (localUser === null) {
          server.log.warn({ clerkId: data.id, email }, "Clerk user.created ignored: invitation required");
          return reply.status(200).send({ received: true });
        }

        await db.update(users).set({
          name,
          displayName: name,
          phone,
          username,
          updatedAt: new Date(),
        }).where(eq(users.id, localUser.id));

        return reply.status(200).send({ received: true });
      }

      if (type === "user.updated") {
        const email = getVerifiedPrimaryEmail(data);
        if (email === null) {
          server.log.warn({ clerkId: data.id }, "Clerk user.updated ignored: verified email required");
          return reply.status(200).send({ received: true });
        }

        const name = getFullName(data);
        const phone = data.phone_numbers[0]?.phone_number ?? null;
        const username = normaliseUsername(data.username);

        await db.update(users).set({
          email,
          name,
          displayName: name,
          phone,
          username,
          updatedAt: new Date(),
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
