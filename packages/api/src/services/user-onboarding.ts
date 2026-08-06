import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { userOnboardingAudit, users } from "../db/schema.js";

const APPROVED_EMAIL_DOMAINS_ENV = "VENVIEWER_APPROVED_EMAIL_DOMAINS";
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

export type UserOnboardingSource = "auth" | "websocket" | "clerk_webhook";
export type UserOnboardingDecision = "allowed" | "denied";
export type UserOnboardingDecisionReason =
  | "email_invitation"
  | "approved_domain"
  | "missing_verified_email"
  | "not_invited";

export interface LocalUserRecord {
  readonly id: string;
  readonly clerkId: string | null;
  readonly email: string;
  readonly role: string;
  readonly venueId: string | null;
}

export interface ResolvedOnboardingUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly venueId: string | null;
}

export interface ClerkOnboardingIdentity {
  readonly clerkId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly source: UserOnboardingSource;
}

export interface CreateApprovedDomainUserInput {
  readonly clerkId: string;
  readonly email: string;
  readonly name: string;
}

export interface UserOnboardingAuditRecord {
  readonly clerkId: string;
  readonly email: string | null;
  readonly decision: UserOnboardingDecision;
  readonly reason: UserOnboardingDecisionReason;
  readonly source: UserOnboardingSource;
  readonly matchedUserId: string | null;
  readonly venueId: string | null;
  readonly role: string | null;
}

export interface UserOnboardingStore {
  findUserByClerkId(clerkId: string): Promise<LocalUserRecord | null>;
  findUserByEmail(email: string): Promise<LocalUserRecord | null>;
  linkUserToClerk(userId: string, clerkId: string): Promise<void>;
  createApprovedDomainUser(input: CreateApprovedDomainUserInput): Promise<LocalUserRecord | null>;
  recordOnboardingDecision(record: UserOnboardingAuditRecord): Promise<void>;
}

export interface UserOnboardingOptions {
  readonly approvedEmailDomains?: readonly string[];
}

export interface ClerkEmailClaims {
  readonly email: string | null;
  readonly emailVerified: boolean;
}

export function readClerkEmailClaims(claims: Readonly<Record<string, unknown>>): ClerkEmailClaims {
  const rawEmail = claims["email"];
  const rawEmailVerified = claims["email_verified"];

  return {
    email: typeof rawEmail === "string" ? rawEmail : null,
    emailVerified: rawEmailVerified === true,
  };
}

export function parseApprovedEmailDomains(raw: string | undefined): readonly string[] {
  if (raw === undefined) return [];

  return raw
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0 && DOMAIN_SHAPE.test(domain));
}

export function normalizeVerifiedEmail(email: string | null, emailVerified: boolean): string | null {
  if (!emailVerified || email === null) return null;

  const normalized = email.trim().toLowerCase();
  return EMAIL_SHAPE.test(normalized) ? normalized : null;
}

export function isApprovedEmailDomain(email: string, approvedEmailDomains: readonly string[]): boolean {
  const atIndex = email.lastIndexOf("@");
  if (atIndex < 0 || atIndex === email.length - 1) return false;

  const domain = email.slice(atIndex + 1).toLowerCase();
  return approvedEmailDomains.some((approvedDomain) => domain === approvedDomain);
}

export async function resolveUserForClerkIdentity(
  store: UserOnboardingStore,
  identity: ClerkOnboardingIdentity,
  options: UserOnboardingOptions = {},
): Promise<ResolvedOnboardingUser | null> {
  const existing = await store.findUserByClerkId(identity.clerkId);
  if (existing !== null) return toResolvedUser(existing);

  const email = normalizeVerifiedEmail(identity.email, identity.emailVerified);
  if (email === null) {
    await recordDenied(store, identity, null, "missing_verified_email");
    return null;
  }

  const invited = await store.findUserByEmail(email);
  if (invited !== null) {
    await store.linkUserToClerk(invited.id, identity.clerkId);
    const linked = { ...invited, clerkId: identity.clerkId };
    await recordAllowed(store, identity, email, "email_invitation", linked);
    return toResolvedUser(linked);
  }

  const approvedDomains = options.approvedEmailDomains
    ?? parseApprovedEmailDomains(process.env[APPROVED_EMAIL_DOMAINS_ENV]);

  if (isApprovedEmailDomain(email, approvedDomains)) {
    const created = await store.createApprovedDomainUser({
      clerkId: identity.clerkId,
      email,
      name: identity.name ?? deriveNameFromEmail(email),
    });

    if (created !== null) {
      await recordAllowed(store, identity, email, "approved_domain", created);
      return toResolvedUser(created);
    }
  }

  await recordDenied(store, identity, email, "not_invited");
  return null;
}

export function createDrizzleUserOnboardingStore(db: Database): UserOnboardingStore {
  return {
    async findUserByClerkId(clerkId) {
      const [row] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
      return row === undefined ? null : toLocalUser(row);
    },

    async findUserByEmail(email) {
      const [row] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
      return row === undefined ? null : toLocalUser(row);
    },

    async linkUserToClerk(userId, clerkId) {
      await db.update(users).set({ clerkId, updatedAt: new Date() }).where(eq(users.id, userId));
    },

    async createApprovedDomainUser(input) {
      const [row] = await db.insert(users).values({
        clerkId: input.clerkId,
        email: input.email,
        name: input.name,
        displayName: input.name,
        role: "planner",
      }).returning();

      return row === undefined ? null : toLocalUser(row);
    },

    async recordOnboardingDecision(record) {
      await db.insert(userOnboardingAudit).values({
        clerkId: record.clerkId,
        email: record.email,
        decision: record.decision,
        reason: record.reason,
        source: record.source,
        matchedUserId: record.matchedUserId,
        venueId: record.venueId,
        role: record.role,
      });
    },
  };
}

function toLocalUser(row: typeof users.$inferSelect): LocalUserRecord {
  return {
    id: row.id,
    clerkId: row.clerkId,
    email: row.email,
    role: row.role,
    venueId: row.venueId,
  };
}

function toResolvedUser(row: LocalUserRecord): ResolvedOnboardingUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    venueId: row.venueId,
  };
}

function deriveNameFromEmail(email: string): string {
  const localPart = email.split("@")[0];
  if (localPart === undefined || localPart.length === 0) return "User";
  return localPart;
}

async function recordAllowed(
  store: UserOnboardingStore,
  identity: ClerkOnboardingIdentity,
  email: string,
  reason: Extract<UserOnboardingDecisionReason, "email_invitation" | "approved_domain">,
  user: LocalUserRecord,
): Promise<void> {
  await store.recordOnboardingDecision({
    clerkId: identity.clerkId,
    email,
    decision: "allowed",
    reason,
    source: identity.source,
    matchedUserId: user.id,
    venueId: user.venueId,
    role: user.role,
  });
}

async function recordDenied(
  store: UserOnboardingStore,
  identity: ClerkOnboardingIdentity,
  email: string | null,
  reason: Extract<UserOnboardingDecisionReason, "missing_verified_email" | "not_invited">,
): Promise<void> {
  await store.recordOnboardingDecision({
    clerkId: identity.clerkId,
    email,
    decision: "denied",
    reason,
    source: identity.source,
    matchedUserId: null,
    venueId: null,
    role: null,
  });
}
