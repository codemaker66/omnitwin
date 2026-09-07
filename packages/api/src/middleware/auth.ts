import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyToken } from "@clerk/backend";
import { z } from "zod";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { PlatformRoleSchema, type PlatformRole } from "@omnitwin/types";
import { onboardingAuditEvents, userInvitations, users, venues, workspaceMemberships, workspaces } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// User type — attached to request after authentication
// ---------------------------------------------------------------------------

/** The shape available on request.user after authenticate(). */
export interface JwtUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: string;
  readonly platformRole: PlatformRole;
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
  name: z.string().min(1).default("Test User"),
  role: z.string().min(1),
  platformRole: PlatformRoleSchema.default("none"),
  venueId: z.string().nullable(),
});

const ALLOWED_ROLES = ["client", "planner", "staff", "hallkeeper", "admin"] as const;
type AuthRole = typeof ALLOWED_ROLES[number];
const allowedRoleSet = new Set<string>(ALLOWED_ROLES);

// Verified-email primitives live in the auth-email.ts leaf (T-518: breaks the
// auth ↔ clerk-email import cycle); re-exported here so existing importers
// (webhooks, ws, tests) are unaffected.
export {
  normalizeAuthEmail,
  resolveVerifiedClerkEmail,
  type VerifiedEmailResolution,
} from "./auth-email.js";
import { normalizeAuthEmail } from "./auth-email.js";
import { resolveVerifiedClerkEmailWithFallback } from "./clerk-email.js";

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


function sanitizeRole(raw: string): AuthRole {
  return allowedRoleSet.has(raw) ? raw as AuthRole : "planner";
}

function sanitizePlatformRole(raw: unknown): PlatformRole {
  const parsed = PlatformRoleSchema.safeParse(raw);
  return parsed.success ? parsed.data : "none";
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
type AuthTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function invitationIsActive(invitation: InvitationRow, now: Date): boolean {
  return invitation.status === "pending" &&
    (invitation.expiresAt === null || invitation.expiresAt > now) &&
    invitation.acceptedAt === null;
}

async function findPendingInvitation(db: AuthTransaction, email: string, now: Date): Promise<InvitationRow | null> {
  const [emailInvitation] = await db
    .select()
    .from(userInvitations)
    .where(and(
      eq(userInvitations.status, "pending"),
      eq(userInvitations.email, email),
      isNull(userInvitations.acceptedAt),
      or(isNull(userInvitations.expiresAt), gt(userInvitations.expiresAt, now)),
    ))
    .orderBy(asc(userInvitations.createdAt), asc(userInvitations.id))
    .limit(1).for("update");

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
      isNull(userInvitations.acceptedAt),
      or(isNull(userInvitations.expiresAt), gt(userInvitations.expiresAt, now)),
    ))
    .orderBy(asc(userInvitations.createdAt), asc(userInvitations.id))
    .limit(1).for("update");

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

  return db.transaction(async (tx) => {
    // HTTP, WebSocket, webhook and administrator writes share this lock.
    // A second first-login request observes the committed account instead of
    // losing an invitation race or creating a duplicate local identity.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${normalizedEmail}))`);
    const [byClerk] = await tx.select().from(users).where(eq(users.clerkId, clerkId)).limit(1).for("update");
    const [byEmail] = byClerk === undefined
      ? await tx.select().from(users).where(eq(users.email, normalizedEmail)).limit(1).for("update")
      : [];
    let user = byClerk ?? byEmail;
    if (user !== undefined && user.clerkId !== null && user.clerkId !== clerkId) return null;

    const now = new Date();
    let invitation = await findPendingInvitation(tx, normalizedEmail, now);
    if (invitation !== null) {
      const memberships = await tx.select().from(workspaceMemberships)
        .where(eq(workspaceMemberships.invitationId, invitation.id));
      if (memberships.length > 0) {
        const membership = memberships[0];
        const [workspace] = membership === undefined ? [] : await tx.select().from(workspaces)
          .where(and(eq(workspaces.id, membership.workspaceId), isNull(workspaces.deletedAt))).limit(1);
        // Managed invitations cannot outlive a removed/suspended membership
        // or move authority across a workspace/venue mismatch.
        if (memberships.length !== 1 || membership?.status !== "invited" ||
            membership.email !== normalizedEmail || workspace === undefined ||
            (workspace.status !== "active" && workspace.status !== "onboarding") ||
            workspace.primaryVenueId !== invitation.venueId || membership.venueRole !== invitation.role) invitation = null;
      }
      if (invitation?.venueId !== null && invitation !== null) {
        const [venue] = await tx.select({ id: venues.id }).from(venues)
          .where(and(eq(venues.id, invitation.venueId), isNull(venues.deletedAt))).limit(1);
        if (venue === undefined) invitation = null;
      }
    }

    // Existing users never change tenant through an invitation, and an
    // existing administrator cannot lose rights by accepting a lesser grant.
    if (invitation !== null && user !== undefined && user.venueId !== null &&
        (user.venueId !== invitation.venueId ||
          (user.role !== invitation.role && invitation.role !== "admin" && user.role !== "admin"))) invitation = null;
    const grant = invitation === null
      ? (user === undefined ? getApprovedDomainGrant(normalizedEmail) : null)
      : { role: sanitizeRole(invitation.role), venueId: invitation.venueId };

    if (user === undefined) {
      if (grant === null) return null;
      [user] = await tx.insert(users).values({
        clerkId, email: normalizedEmail, name: defaultNameFromEmail(normalizedEmail),
        role: grant.role, platformRole: "none", venueId: grant.venueId,
      }).returning();
      if (user === undefined) throw new Error("User insert returned no row");
    } else if (user.clerkId === null || invitation !== null) {
      const role = user.role === "admin" ? "admin" : grant?.role ?? user.role;
      [user] = await tx.update(users).set({
        clerkId, role, venueId: grant?.venueId ?? user.venueId, updatedAt: now,
      }).where(and(eq(users.id, user.id), or(isNull(users.clerkId), eq(users.clerkId, clerkId)))).returning();
      if (user === undefined) throw new Error("Identity changed during account linking");
    }

    if (invitation !== null) {
      // The accepted marker is one write: the database CHECK requires both
      // acceptedAt and acceptedBy whenever status is accepted.
      const [accepted] = await tx.update(userInvitations).set({
        status: "accepted", acceptedAt: now, acceptedBy: user.id, updatedAt: now,
      }).where(and(eq(userInvitations.id, invitation.id), eq(userInvitations.status, "pending"),
        isNull(userInvitations.acceptedAt), or(isNull(userInvitations.expiresAt), gt(userInvitations.expiresAt, now))))
        .returning({ id: userInvitations.id });
      if (accepted === undefined) throw new Error("Invitation changed during account linking");
      const activated = await tx.update(workspaceMemberships).set({
        userId: user.id, status: "active", venueRole: user.role, acceptedAt: now, updatedAt: now,
      }).where(and(eq(workspaceMemberships.invitationId, invitation.id), eq(workspaceMemberships.status, "invited")))
        .returning();
      for (const membership of activated) {
        await tx.insert(onboardingAuditEvents).values({
          workspaceId: membership.workspaceId, eventType: "member_access_accepted",
          summary: `Verified account connected for ${normalizedEmail} with ${user.role} venue access`, actorUserId: user.id,
        });
      }
    }
    return { id: user.id, email: user.email, name: user.name, role: user.role,
      platformRole: sanitizePlatformRole(user.platformRole), venueId: user.venueId };
  });
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
  const isTest = process.env["NODE_ENV"] === "test";
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
  // Claims first (production's customised session token); Backend-API
  // fallback for instances issuing default tokens with no email claim —
  // see middleware/clerk-email.ts. Both paths fail closed on unverified.
  const emailResolution = await resolveVerifiedClerkEmailWithFallback(
    payload as Record<string, unknown>,
    clerkId,
  );
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

export function isPlatformAdmin(user: Pick<JwtUser, "platformRole">): boolean {
  return user.platformRole === "admin";
}

export function authorizePlatformAdmin(): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!isPlatformAdmin(request.user)) {
      return reply.status(403).send({
        error: "Venviewer platform administrator access required",
        code: "FORBIDDEN",
      });
    }
  };
}
