import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { Webhook } from "svix";
import { z } from "zod";
import { users } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { getUserByClerkId, normalizeAuthEmail } from "../middleware/auth.js";

const ClerkEmailAddressSchema = z.object({
  email_address: z.string().email(),
  id: z.string().min(1),
  verification: z.object({ status: z.string().optional() }).nullable().optional(),
});

const ClerkUserDataSchema = z.object({
  id: z.string().min(1),
  email_addresses: z.array(ClerkEmailAddressSchema),
  primary_email_address_id: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  phone_numbers: z.array(z.object({ phone_number: z.string() })),
  public_metadata: z.record(z.unknown()),
  username: z.string().nullable().optional(),
});

const ClerkDeletedUserDataSchema = z.object({
  id: z.string().min(1),
  object: z.literal("user").optional(),
  deleted: z.boolean().optional(),
});

const SupportedClerkWebhookEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user.created"), data: ClerkUserDataSchema }),
  z.object({ type: z.literal("user.updated"), data: ClerkUserDataSchema }),
  z.object({ type: z.literal("user.deleted"), data: ClerkDeletedUserDataSchema }),
]);

const ClerkWebhookEnvelopeSchema = z.object({
  type: z.string().min(1),
  data: z.unknown(),
});

type ClerkUserData = z.infer<typeof ClerkUserDataSchema>;
export type SupportedClerkWebhookEvent = z.infer<typeof SupportedClerkWebhookEventSchema>;

export type ParsedClerkWebhookPayload =
  | { readonly kind: "supported"; readonly event: SupportedClerkWebhookEvent }
  | { readonly kind: "ignored"; readonly type: string }
  | { readonly kind: "invalid"; readonly issues: readonly z.ZodIssue[] };

export interface ClerkUserUpdate {
  readonly email?: string;
  readonly name?: string;
  readonly displayName?: string;
  readonly phone?: string | null;
  readonly username?: string | null;
  readonly clerkId?: null;
  readonly updatedAt: Date;
}

export interface ClerkWebhookPersistence {
  readonly resolveCreatedUser: (clerkId: string, email: string) => Promise<{ readonly id: string } | null>;
  readonly updateUserById: (userId: string, values: ClerkUserUpdate) => Promise<void>;
  readonly updateUserByClerkId: (clerkId: string, values: ClerkUserUpdate) => Promise<void>;
  readonly unlinkUser: (clerkId: string, updatedAt: Date) => Promise<void>;
}

export type ClerkWebhookProcessingResult =
  | { readonly status: "processed"; readonly clerkId: string }
  | {
      readonly status: "ignored";
      readonly clerkId: string;
      readonly reason: "verified_email_required" | "invitation_required";
      readonly email?: string;
    };

const USERNAME_SHAPE = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])?$/;

function normaliseUsername(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const lower = raw.trim().toLowerCase();
  if (lower.length === 0) return null;
  return USERNAME_SHAPE.test(lower) ? lower : null;
}

function emailIsVerified(email: z.infer<typeof ClerkEmailAddressSchema>): boolean {
  return email.verification?.status === "verified";
}

function getVerifiedPrimaryEmail(data: ClerkUserData): string | null {
  const primary = data.email_addresses.find((email) => email.id === data.primary_email_address_id);
  const candidate = primary ?? data.email_addresses[0] ?? null;
  if (candidate === null || !emailIsVerified(candidate)) return null;
  return normalizeAuthEmail(candidate.email_address);
}

function getFullName(data: ClerkUserData): string {
  const parts = [data.first_name, data.last_name].filter((part): part is string => part !== null && part.length > 0);
  return parts.length > 0 ? parts.join(" ") : "User";
}

export function parseClerkWebhookPayload(payload: unknown): ParsedClerkWebhookPayload {
  const envelope = ClerkWebhookEnvelopeSchema.safeParse(payload);
  if (!envelope.success) return { kind: "invalid", issues: envelope.error.issues };

  if (envelope.data.type !== "user.created" &&
      envelope.data.type !== "user.updated" &&
      envelope.data.type !== "user.deleted") {
    return { kind: "ignored", type: envelope.data.type };
  }

  const supported = SupportedClerkWebhookEventSchema.safeParse(payload);
  return supported.success
    ? { kind: "supported", event: supported.data }
    : { kind: "invalid", issues: supported.error.issues };
}

function profileUpdate(data: ClerkUserData, updatedAt: Date, email?: string): ClerkUserUpdate {
  const name = getFullName(data);
  return {
    ...(email === undefined ? {} : { email }),
    name,
    displayName: name,
    phone: data.phone_numbers[0]?.phone_number ?? null,
    username: normaliseUsername(data.username),
    updatedAt,
  };
}

export async function processClerkWebhookEvent(
  event: SupportedClerkWebhookEvent,
  persistence: ClerkWebhookPersistence,
  updatedAt: Date = new Date(),
): Promise<ClerkWebhookProcessingResult> {
  if (event.type === "user.deleted") {
    await persistence.unlinkUser(event.data.id, updatedAt);
    return { status: "processed", clerkId: event.data.id };
  }

  const email = getVerifiedPrimaryEmail(event.data);
  if (email === null) {
    return { status: "ignored", clerkId: event.data.id, reason: "verified_email_required" };
  }

  if (event.type === "user.created") {
    const localUser = await persistence.resolveCreatedUser(event.data.id, email);
    if (localUser === null) {
      return { status: "ignored", clerkId: event.data.id, email, reason: "invitation_required" };
    }
    await persistence.updateUserById(localUser.id, profileUpdate(event.data, updatedAt));
    return { status: "processed", clerkId: event.data.id };
  }

  await persistence.updateUserByClerkId(event.data.id, profileUpdate(event.data, updatedAt, email));
  return { status: "processed", clerkId: event.data.id };
}

function databasePersistence(db: Database): ClerkWebhookPersistence {
  return {
    resolveCreatedUser: async (clerkId, email) => {
      const user = await getUserByClerkId(db, clerkId, email);
      return user === null ? null : { id: user.id };
    },
    updateUserById: async (userId, values) => {
      await db.update(users).set(values).where(eq(users.id, userId));
    },
    updateUserByClerkId: async (clerkId, values) => {
      await db.update(users).set(values).where(eq(users.clerkId, clerkId));
    },
    unlinkUser: async (clerkId, updatedAt) => {
      await db.update(users).set({ clerkId: null, updatedAt }).where(eq(users.clerkId, clerkId));
    },
  };
}

function headerValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function webhookRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const webhookSecret = process.env["CLERK_WEBHOOK_SECRET"];
  const persistence = databasePersistence(opts.db);

  server.post("/clerk", { config: { rawBody: true } }, async (request, reply) => {
    if (webhookSecret === undefined || webhookSecret === "") {
      server.log.error("CLERK_WEBHOOK_SECRET unset — refusing webhook to avoid accepting unsigned events");
      return reply.status(500).send({ error: "Webhook verification not configured", code: "INTERNAL_ERROR" });
    }

    const svixId = headerValue(request.headers["svix-id"]);
    const svixTimestamp = headerValue(request.headers["svix-timestamp"]);
    const svixSignature = headerValue(request.headers["svix-signature"]);
    if (svixId === undefined || svixTimestamp === undefined || svixSignature === undefined) {
      return reply.status(401).send({ error: "Missing svix headers", code: "UNAUTHORIZED" });
    }

    const body = request.rawBody;
    if (body === undefined) {
      return reply.status(500).send({ error: "Raw body not available", code: "INTERNAL_ERROR" });
    }
    try {
      const wh = new Webhook(webhookSecret);
      wh.verify(body.toString("utf-8"), {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch {
      return reply.status(401).send({ error: "Invalid webhook signature", code: "UNAUTHORIZED" });
    }

    const parsed = parseClerkWebhookPayload(request.body);
    if (parsed.kind === "invalid") {
      server.log.warn({ issues: parsed.issues }, "Rejected malformed Clerk webhook payload");
      return reply.status(400).send({
        error: "Invalid Clerk webhook payload",
        code: "VALIDATION_ERROR",
        details: parsed.issues,
      });
    }
    if (parsed.kind === "ignored") {
      return reply.status(200).send({ received: true, ignored: true });
    }

    try {
      const result = await processClerkWebhookEvent(parsed.event, persistence);
      if (result.status === "ignored") {
        server.log.warn(result, "Clerk user event ignored by access policy");
      }
      return reply.status(200).send({ received: true });
    } catch (err) {
      server.log.error({ err, type: parsed.event.type }, "Clerk webhook processing failed");
      return reply.status(503).send({
        error: "Webhook processing failed; retry delivery",
        code: "WEBHOOK_PROCESSING_FAILED",
        retryable: true,
      });
    }
  });
}
