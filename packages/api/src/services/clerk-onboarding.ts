import { eq, ilike } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { onboardingAuditEvents, users } from "../db/schema.js";

export type ClerkOnboardingSource = "http_session" | "websocket_session" | "clerk_webhook";

export type ClerkOnboardingDecision =
  | "allowed_invited_user"
  | "allowed_approved_domain"
  | "denied_missing_verified_email"
  | "denied_uninvited_email"
  | "denied_conflicting_email";

export interface OnboardingUser {
  readonly id: string;
  readonly clerkId: string | null;
  readonly email: string;
  readonly role: string;
  readonly venueId: string | null;
}

export interface ClerkOnboardingProfile {
  readonly name?: string;
  readonly displayName?: string | null;
  readonly phone?: string | null;
  readonly username?: string | null;
}

export interface ClerkOnboardingRequest {
  readonly clerkId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly source: ClerkOnboardingSource;
  readonly approvedEmailDomains: readonly string[];
  readonly profile?: ClerkOnboardingProfile;
}

export interface ClerkOnboardingAuditEvent {
  readonly clerkId: string;
  readonly email: string | null;
  readonly source: ClerkOnboardingSource;
  readonly decision: ClerkOnboardingDecision;
  readonly reason: string;
}

export interface ClerkOnboardingStore {
  findUserByClerkId(clerkId: string): Promise<OnboardingUser | null>;
  findUserByEmail(email: string): Promise<OnboardingUser | null>;
  linkInvitedUser(userId: string, clerkId: string, profile: ClerkOnboardingProfile | undefined): Promise<OnboardingUser | null>;
  createApprovedDomainUser(input: {
    readonly clerkId: string;
    readonly email: string;
    readonly profile: ClerkOnboardingProfile | undefined;
  }): Promise<OnboardingUser | null>;
  recordAudit(event: ClerkOnboardingAuditEvent): Promise<void>;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function parseApprovedEmailDomains(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim().length === 0) return [];
  const domains = raw
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => DOMAIN_SHAPE.test(domain));
  return [...new Set(domains)];
}

export function normaliseVerifiedEmail(email: string | null, verified: boolean): string | null {
  if (!verified || email === null) return null;
  const normalised = email.trim().toLowerCase();
  return EMAIL_SHAPE.test(normalised) ? normalised : null;
}

export function extractVerifiedClerkSessionEmail(payload: Record<string, unknown>): {
  readonly email: string | null;
  readonly emailVerified: boolean;
} {
  const rawEmail = payload["email"];
  const email = typeof rawEmail === "string" ? rawEmail : null;
  const emailVerified = payload["email_verified"] === true ||
    payload["email_verified"] === "true" ||
    typeof payload["email_verified_at"] === "string";
  return { email, emailVerified };
}

function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

function isApprovedDomain(email: string, approvedEmailDomains: readonly string[]): boolean {
  const domain = emailDomain(email);
  return approvedEmailDomains.includes(domain);
}

async function deny(
  store: ClerkOnboardingStore,
  request: ClerkOnboardingRequest,
  decision: Extract<ClerkOnboardingDecision, `denied_${string}`>,
  reason: string,
): Promise<null> {
  await store.recordAudit({
    clerkId: request.clerkId,
    email: request.email,
    source: request.source,
    decision,
    reason,
  });
  return null;
}

async function allow(
  store: ClerkOnboardingStore,
  request: ClerkOnboardingRequest,
  email: string,
  decision: Extract<ClerkOnboardingDecision, `allowed_${string}`>,
  reason: string,
): Promise<void> {
  await store.recordAudit({
    clerkId: request.clerkId,
    email,
    source: request.source,
    decision,
    reason,
  });
}

export async function resolveClerkOnboardingUser(
  store: ClerkOnboardingStore,
  request: ClerkOnboardingRequest,
): Promise<OnboardingUser | null> {
  const existingByClerk = await store.findUserByClerkId(request.clerkId);
  if (existingByClerk !== null) return existingByClerk;

  const verifiedEmail = normaliseVerifiedEmail(request.email, request.emailVerified);
  if (verifiedEmail === null) {
    return deny(store, request, "denied_missing_verified_email", "Clerk identity did not include a verified email address");
  }

  const existingByEmail = await store.findUserByEmail(verifiedEmail);
  if (existingByEmail !== null) {
    if (existingByEmail.clerkId !== null && existingByEmail.clerkId !== request.clerkId) {
      return deny(store, request, "denied_conflicting_email", "Email is already linked to another Clerk user");
    }

    const linked = await store.linkInvitedUser(existingByEmail.id, request.clerkId, request.profile);
    if (linked === null) {
      return deny(store, request, "denied_conflicting_email", "Invited user row disappeared before Clerk linkage");
    }
    await allow(store, request, verifiedEmail, "allowed_invited_user", "Matched pre-provisioned invited user row");
    return linked;
  }

  if (isApprovedDomain(verifiedEmail, request.approvedEmailDomains)) {
    const created = await store.createApprovedDomainUser({
      clerkId: request.clerkId,
      email: verifiedEmail,
      profile: request.profile,
    });
    if (created === null) {
      return deny(store, request, "denied_conflicting_email", "Approved-domain user could not be created");
    }
    await allow(store, request, verifiedEmail, "allowed_approved_domain", "Matched configured approved email domain");
    return created;
  }

  return deny(store, request, "denied_uninvited_email", "Email was neither invited nor on an approved domain");
}

function profileName(profile: ClerkOnboardingProfile | undefined, email: string): string {
  const rawName = profile?.name?.trim();
  if (rawName !== undefined && rawName.length > 0) return rawName;
  return email.slice(0, email.indexOf("@"));
}

export function createDrizzleClerkOnboardingStore(db: Database): ClerkOnboardingStore {
  return {
    async findUserByClerkId(clerkId) {
      const [existing] = await db.select({
        id: users.id,
        clerkId: users.clerkId,
        email: users.email,
        role: users.role,
        venueId: users.venueId,
      }).from(users).where(eq(users.clerkId, clerkId)).limit(1);
      return existing ?? null;
    },

    async findUserByEmail(email) {
      const [existing] = await db.select({
        id: users.id,
        clerkId: users.clerkId,
        email: users.email,
        role: users.role,
        venueId: users.venueId,
      }).from(users).where(ilike(users.email, email)).limit(1);
      return existing ?? null;
    },

    async linkInvitedUser(userId, clerkId, profile) {
      const update: {
        clerkId: string;
        updatedAt: Date;
        name?: string;
        displayName?: string | null;
        phone?: string | null;
        username?: string | null;
      } = {
        clerkId,
        updatedAt: new Date(),
      };
      if (profile?.name !== undefined) update.name = profile.name;
      if (profile?.displayName !== undefined) update.displayName = profile.displayName;
      if (profile?.phone !== undefined) update.phone = profile.phone;
      if (profile?.username !== undefined) update.username = profile.username;

      await db.update(users).set(update).where(eq(users.id, userId));

      const [linked] = await db.select({
        id: users.id,
        clerkId: users.clerkId,
        email: users.email,
        role: users.role,
        venueId: users.venueId,
      }).from(users).where(eq(users.id, userId)).limit(1);
      return linked ?? null;
    },

    async createApprovedDomainUser(input) {
      const [created] = await db.insert(users).values({
        clerkId: input.clerkId,
        email: input.email,
        name: profileName(input.profile, input.email),
        displayName: input.profile?.displayName ?? input.profile?.name ?? null,
        phone: input.profile?.phone ?? null,
        username: input.profile?.username ?? null,
        role: "planner",
      }).returning({
        id: users.id,
        clerkId: users.clerkId,
        email: users.email,
        role: users.role,
        venueId: users.venueId,
      });
      return created ?? null;
    },

    async recordAudit(event) {
      await db.insert(onboardingAuditEvents).values({
        clerkId: event.clerkId,
        email: event.email,
        source: event.source,
        decision: event.decision,
        reason: event.reason,
      });
    },
  };
}
