import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyToken } from "@clerk/backend";
import { z } from "zod";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { userInvitations, users } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// User type — attached to request after authentication
// ---------------------------------------------------------------------------

/** The shape available on request.user after authenticate(). */
export interface JwtUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly venueId: string | null;
}

// Punch list #7: Zod schema for validating mock tokens in test mode.
// The previous code did `JSON.parse(token) as JwtUser` which trusted
// any JSON shape, including objects with missing or wrong-typed fields.
// Downstream code (ownership checks, venue filtering) silently broke
// when fields were missing or had wrong types.
const MockTokenSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  role: z.string().min(1),
  venueId: z.string().nullable(),
});

const AuthEmailSchema = z.string().trim().toLowerCase().email();
const ALLOWED_ROLES = ["client", "planner", "staff", "hallkeeper", "admin"] as const;
type AuthRole = typeof ALLOWED_ROLES[number];
const allowedRoleSet = new Set<string>(ALLOWED_ROLES);

export type VerifiedEmailResolution =
  | { readonly ok: true; readonly email: string }
  | { readonly ok: false; readonly code: "EMAIL_REQUIRED" | "EMAIL_UNVERIFIED"; readonly message: string };

// Augment FastifyRequest to include user
declare module "fastify" {
  interface FastifyRequest {
    user: JwtUser;
  }
}

// ---------------------------------------------------------------------------
// Module-level DB reference — set once during server startup
// ---------------------------------------------------------------------------

let _db: Database | null = null;

/** Called once at startup to inject the database reference. */
export function setAuthDb(db: Database): void {
  _db = db;
}

// ---------------------------------------------------------------------------
// Clerk email + access policy helpers
// ---------------------------------------------------------------------------

export function normalizeAuthEmail(raw: unknown): string | null {
  const result = AuthEmailSchema.safeParse(raw);
  return result.success ? result.data : null;
}

function isExplicitlyVerified(value: unknown): boolean {
  return value === true || value === "true" || value === "verified";
}

/**
 * Clerk JWT templates can name the verification claim differently depending
 * on configuration. Venviewer fails closed: a token needs an explicit verified
 * signal, not just an email string.
 */
export function resolveVerifiedClerkEmail(payload: Record<string, unknown>): VerifiedEmailResolution {
  const email = normalizeAuthEmail(payload["email"]);
  if (email === null) {
    return {
      ok: false,
      code: "EMAIL_REQUIRED",
      message: "A verified email address is required",
    };
  }

  const verified =
    isExplicitlyVerified(payload["email_verified"]) ||
    isExplicitlyVerified(payload["emailVerified"]) ||
    isExplicitlyVerified(payload["email_verification_status"]) ||
    isExplicitlyVerified(payload["emailVerificationStatus"]) ||
    isExplicitlyVerified(payload["primary_email_verified"]) ||
    isExplicitlyVerified(payload["primaryEmailVerified"]) ||
    isExplicitlyVerified(payload["primary_email_verification_status"]) ||
    isExplicitlyVerified(payload["primaryEmailVerificationStatus"]);

  if (!verified) {
    return {
      ok: false,
      code: "EMAIL_UNVERIFIED",
      message: "Email address must be verified before access is granted",
    };
  }

  return { ok: true, email };
}

function sanitizeRole(raw: string): AuthRole {
  return allowedRoleSet.has(raw) ? raw as AuthRole : "planner";
}

function getEmailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

function defaultNameFromEmail(email: string): string {
  const at = email.indexOf("@");
  const local = at > 0 ? email.slice(0, at) : "";
  return local.length > 0 ? local : "User";
}

function parseDomainList(raw: string | undefined): readonly string[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase().replace(/^@/, ""))
    .filter((item) => item.length > 0);
}

interface AccessGrant {
  readonly role: AuthRole;
  readonly venueId: string | null;
}

export function getApprovedDomainGrant(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): AccessGrant | null {
  const domain = getEmailDomain(email);
  if (domain === null) return null;

  const approvedDomains = parseDomainList(env["VENVIEWER_APPROVED_AUTH_DOMAINS"]);
  if (!approvedDomains.includes(domain)) return null;

  return {
    role: sanitizeRole(env["VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE"] ?? "planner"),
    venueId: env["VENVIEWER_APPROVED_AUTH_DOMAIN_VENUE_ID"] ?? null,
  };
}

type InvitationRow = typeof userInvitations.$inferSelect;

function invitationIsActive(invitation: InvitationRow, now: Date): boolean {
  return invitation.status === "pending" &&
    (invitation.expiresAt === null || invitation.expiresAt > now) &&
    invitation.acceptedAt === null;
}

async function findPendingInvitation(db: Database, email: string, now: Date): Promise<InvitationRow | null> {
  const [emailInvitation] = await db
    .select()
    .from(userInvitations)
    .where(and(
      eq(userInvitations.status, "pending"),
      eq(userInvitations.email, email),
      or(isNull(userInvitations.expiresAt), gt(userInvitations.expiresAt, now)),
    ))
    .limit(1);

  if (emailInvitation !== undefined && invitationIsActive(emailInvitation, now)) {
    return emailInvitation;
  }

  const domain = getEmailDomain(email);
  if (domain === null) return null;

  const [domainInvitation] = await db
    .select()
    .from(userInvitations)
    .where(and(
      eq(userInvitations.status, "pending"),
      eq(userInvitations.domain, domain),
      or(isNull(userInvitations.expiresAt), gt(userInvitations.expiresAt, now)),
    ))
    .limit(1);

  if (domainInvitation !== undefined && invitationIsActive(domainInvitation, now)) {
    return domainInvitation;
  }

  return null;
}

// ---------------------------------------------------------------------------
// getUserByClerkId — find or authorize local user from Clerk identity.
//
// This is the authoritative bridge from Clerk's opaque `sub` (the JWT
// `payload.sub` claim) to our local `users.id` UUID. Both HTTP and
// WebSocket auth paths MUST go through this so ownership checks against
// `configurations.userId` compare apples to apples.
//
// New local users require a pending invitation or an explicit approved-domain
// policy. A Clerk identity alone is not enough to become a planner.
// ---------------------------------------------------------------------------

export async function getUserByClerkId(
  db: Database,
  clerkId: string,
  email: string,
): Promise<JwtUser | null> {
  const normalizedEmail = normalizeAuthEmail(email);
  if (normalizedEmail === null) return null;

  // Look up existing user by clerkId
  const [existing] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (existing !== undefined) {
    return {
      id: existing.id,
      email: existing.email,
      role: existing.role,
      venueId: existing.venueId,
    };
  }

  // Also check by email (for users created before Clerk migration, or seed users)
  const [byEmail] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  if (byEmail !== undefined) {
    if (byEmail.clerkId !== null && byEmail.clerkId !== clerkId) {
      return null;
    }
    // Link Clerk ID to existing user
    await db.update(users).set({ clerkId, updatedAt: new Date() }).where(eq(users.id, byEmail.id));
    return {
      id: byEmail.id,
      email: byEmail.email,
      role: byEmail.role,
      venueId: byEmail.venueId,
    };
  }

  const now = new Date();
  const invitation = await findPendingInvitation(db, normalizedEmail, now);
  const grant: AccessGrant | null = invitation === null
    ? getApprovedDomainGrant(normalizedEmail)
    : { role: sanitizeRole(invitation.role), venueId: invitation.venueId };

  if (grant === null) return null;

  if (invitation !== null) {
    const created = await db.transaction(async (tx) => {
      const [claimedInvitation] = await tx.update(userInvitations).set({
        status: "accepted",
        acceptedAt: now,
        updatedAt: now,
      }).where(and(
        eq(userInvitations.id, invitation.id),
        eq(userInvitations.status, "pending"),
        isNull(userInvitations.acceptedAt),
        or(isNull(userInvitations.expiresAt), gt(userInvitations.expiresAt, now)),
      )).returning({ id: userInvitations.id });

      if (claimedInvitation === undefined) return null;

      const [inserted] = await tx.insert(users).values({
        clerkId,
        email: normalizedEmail,
        name: defaultNameFromEmail(normalizedEmail),
        role: grant.role,
        venueId: grant.venueId,
      }).returning();

      if (inserted === undefined) return null;

      await tx.update(userInvitations).set({
        acceptedBy: inserted.id,
        updatedAt: now,
      }).where(eq(userInvitations.id, invitation.id));

      return inserted;
    });

    if (created === null) return null;

    return {
      id: created.id,
      email: created.email,
      role: created.role,
      venueId: created.venueId,
    };
  }

  const [created] = await db.insert(users).values({
    clerkId,
    email: normalizedEmail,
    name: defaultNameFromEmail(normalizedEmail),
    role: grant.role,
    venueId: grant.venueId,
  }).returning();

  if (created === undefined) return null;

  return {
    id: created.id,
    email: created.email,
    role: created.role,
    venueId: created.venueId,
  };
}

// ---------------------------------------------------------------------------
// authenticate — verifies Clerk session token, attaches user to request
// ---------------------------------------------------------------------------

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (authHeader === undefined || !authHeader.startsWith("Bearer ")) {
    await reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    return;
  }

  const token = authHeader.slice(7);

  // In test mode ONLY, accept mock tokens (JSON-encoded user objects).
  // This MUST be gated behind NODE_ENV to prevent production exploitation.
  // Punch list #7: the parsed JSON is validated via Zod so malformed mock
  // tokens (missing fields, wrong types) are rejected with 401 instead of
  // silently producing a broken request.user.
  const isTest = process.env["NODE_ENV"] === "test" || process.env["VITEST"] !== undefined;
  if (isTest && token.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(token);
      const result = MockTokenSchema.safeParse(parsed);
      if (result.success) {
        request.user = result.data;
        return;
      }
      // Shape doesn't match — fall through to Clerk verification.
      // In practice this means the token was JSON but not a valid
      // mock user, so Clerk will also reject it (401).
    } catch {
      // Not valid JSON — fall through
    }
  }

  const secretKey = process.env["CLERK_SECRET_KEY"];
  if (secretKey === undefined || secretKey === "") {
    await reply.status(500).send({ error: "Clerk not configured", code: "SERVER_ERROR" });
    return;
  }

  let payload: Awaited<ReturnType<typeof verifyToken>>;
  try {
    payload = await verifyToken(token, {
      secretKey,
    });
  } catch {
    await reply.status(401).send({ error: "Invalid or expired token", code: "UNAUTHORIZED" });
    return;
  }

  const clerkId = payload.sub;
  const emailResolution = resolveVerifiedClerkEmail(payload as Record<string, unknown>);
  if (!emailResolution.ok) {
    await reply.status(403).send({ error: emailResolution.message, code: emailResolution.code });
    return;
  }

  if (_db === null) {
    await reply.status(500).send({ error: "Database not available", code: "SERVER_ERROR" });
    return;
  }

  try {
    const user = await getUserByClerkId(_db, clerkId, emailResolution.email);
    if (user === null) {
      await reply.status(403).send({ error: "Invitation required", code: "INVITATION_REQUIRED" });
      return;
    }

    request.user = user;
  } catch {
    await reply.status(500).send({ error: "Failed to resolve user", code: "SERVER_ERROR" });
  }
}

// ---------------------------------------------------------------------------
// authorize — role-based guard
//
// CRITICAL: returns the reply to halt the Fastify lifecycle so the actual
// route handler does NOT run after a 403. The previous version sent the
// 403 body but didn't return — Fastify then proceeded to invoke the
// downstream handler with `request.user` still set, silently bypassing
// the role check on every admin route.
//
// Pinned by the regression tests in __tests__/auth.test.ts that hit
// `POST /venues` (admin-only) with a planner token.
// ---------------------------------------------------------------------------

export function authorize(
  ...allowedRoles: readonly string[]
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const roleSet = new Set(allowedRoles);

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!roleSet.has(request.user.role)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
  };
}
