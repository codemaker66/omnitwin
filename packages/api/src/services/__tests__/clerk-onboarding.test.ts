import { describe, expect, it } from "vitest";
import {
  extractVerifiedClerkSessionEmail,
  parseApprovedEmailDomains,
  resolveClerkOnboardingUser,
  type ClerkOnboardingAuditEvent,
  type ClerkOnboardingProfile,
  type ClerkOnboardingStore,
  type OnboardingUser,
} from "../clerk-onboarding.js";

class MemoryOnboardingStore implements ClerkOnboardingStore {
  private readonly rows: OnboardingUser[];
  private nextUserIndex = 1;
  readonly auditEvents: ClerkOnboardingAuditEvent[] = [];

  constructor(initialRows: readonly OnboardingUser[] = []) {
    this.rows = initialRows.map((row) => ({ ...row }));
  }

  get users(): readonly OnboardingUser[] {
    return this.rows;
  }

  findUserByClerkId(clerkId: string): Promise<OnboardingUser | null> {
    return Promise.resolve(this.rows.find((row) => row.clerkId === clerkId) ?? null);
  }

  findUserByEmail(email: string): Promise<OnboardingUser | null> {
    return Promise.resolve(this.rows.find((row) => row.email === email) ?? null);
  }

  linkInvitedUser(userId: string, clerkId: string, _profile: ClerkOnboardingProfile | undefined): Promise<OnboardingUser | null> {
    const index = this.rows.findIndex((row) => row.id === userId);
    if (index === -1) return Promise.resolve(null);
    const current = this.rows[index];
    if (current === undefined) return Promise.resolve(null);
    const updated: OnboardingUser = { ...current, clerkId };
    this.rows[index] = updated;
    return Promise.resolve(updated);
  }

  createApprovedDomainUser(input: {
    readonly clerkId: string;
    readonly email: string;
    readonly profile: ClerkOnboardingProfile | undefined;
  }): Promise<OnboardingUser | null> {
    const row: OnboardingUser = {
      id: `created-${String(this.nextUserIndex)}`,
      clerkId: input.clerkId,
      email: input.email,
      role: "planner",
      venueId: null,
    };
    this.nextUserIndex += 1;
    this.rows.push(row);
    return Promise.resolve(row);
  }

  recordAudit(event: ClerkOnboardingAuditEvent): Promise<void> {
    this.auditEvents.push(event);
    return Promise.resolve();
  }
}

function user(overrides: Partial<OnboardingUser>): OnboardingUser {
  return {
    id: "user-1",
    clerkId: null,
    email: "planner@tradeshall.com",
    role: "staff",
    venueId: "venue-1",
    ...overrides,
  };
}

describe("Clerk onboarding gate", () => {
  it("allows an existing linked Clerk user without requiring email claims on every session", async () => {
    const store = new MemoryOnboardingStore([
      user({ id: "linked-user", clerkId: "clerk_linked", email: "linked@tradeshall.com" }),
    ]);

    const result = await resolveClerkOnboardingUser(store, {
      clerkId: "clerk_linked",
      email: null,
      emailVerified: false,
      source: "http_session",
      approvedEmailDomains: [],
    });

    expect(result?.id).toBe("linked-user");
    expect(store.auditEvents).toHaveLength(0);
  });

  it("links a verified invited user and preserves the pre-provisioned role and venue", async () => {
    const store = new MemoryOnboardingStore([
      user({ id: "invited-user", clerkId: null, role: "hallkeeper", venueId: "venue-42" }),
    ]);

    const result = await resolveClerkOnboardingUser(store, {
      clerkId: "clerk_invited",
      email: "Planner@TradesHall.com",
      emailVerified: true,
      source: "clerk_webhook",
      approvedEmailDomains: [],
    });

    expect(result).toMatchObject({
      id: "invited-user",
      clerkId: "clerk_invited",
      role: "hallkeeper",
      venueId: "venue-42",
    });
    expect(store.auditEvents.at(-1)?.decision).toBe("allowed_invited_user");
  });

  it("creates only a planner user for a verified approved-domain email", async () => {
    const store = new MemoryOnboardingStore();

    const result = await resolveClerkOnboardingUser(store, {
      clerkId: "clerk_domain",
      email: "new.person@venviewer.com",
      emailVerified: true,
      source: "http_session",
      approvedEmailDomains: ["venviewer.com"],
    });

    expect(result).toMatchObject({
      clerkId: "clerk_domain",
      email: "new.person@venviewer.com",
      role: "planner",
      venueId: null,
    });
    expect(store.users).toHaveLength(1);
    expect(store.auditEvents.at(-1)?.decision).toBe("allowed_approved_domain");
  });

  it("does not auto-create arbitrary verified Clerk users", async () => {
    const store = new MemoryOnboardingStore();

    const result = await resolveClerkOnboardingUser(store, {
      clerkId: "clerk_random",
      email: "random@example.com",
      emailVerified: true,
      source: "http_session",
      approvedEmailDomains: [],
    });

    expect(result).toBeNull();
    expect(store.users).toHaveLength(0);
    expect(store.auditEvents.at(-1)?.decision).toBe("denied_uninvited_email");
  });

  it("does not link an invited row when the Clerk email is unverified", async () => {
    const store = new MemoryOnboardingStore([
      user({ id: "invited-user", clerkId: null }),
    ]);

    const result = await resolveClerkOnboardingUser(store, {
      clerkId: "clerk_unverified",
      email: "planner@tradeshall.com",
      emailVerified: false,
      source: "clerk_webhook",
      approvedEmailDomains: ["tradeshall.com"],
    });

    expect(result).toBeNull();
    expect(store.users[0]?.clerkId).toBeNull();
    expect(store.auditEvents.at(-1)?.decision).toBe("denied_missing_verified_email");
  });

  it("fails safely when the Clerk identity has no email", async () => {
    const store = new MemoryOnboardingStore();

    const result = await resolveClerkOnboardingUser(store, {
      clerkId: "clerk_missing_email",
      email: null,
      emailVerified: true,
      source: "websocket_session",
      approvedEmailDomains: ["venviewer.com"],
    });

    expect(result).toBeNull();
    expect(store.users).toHaveLength(0);
    expect(store.auditEvents.at(-1)?.decision).toBe("denied_missing_verified_email");
  });

  it("refuses to relink an email already attached to a different Clerk user", async () => {
    const store = new MemoryOnboardingStore([
      user({ id: "already-linked", clerkId: "clerk_original", email: "planner@tradeshall.com" }),
    ]);

    const result = await resolveClerkOnboardingUser(store, {
      clerkId: "clerk_attacker",
      email: "planner@tradeshall.com",
      emailVerified: true,
      source: "http_session",
      approvedEmailDomains: ["tradeshall.com"],
    });

    expect(result).toBeNull();
    expect(store.users[0]?.clerkId).toBe("clerk_original");
    expect(store.auditEvents.at(-1)?.decision).toBe("denied_conflicting_email");
  });
});

describe("Clerk onboarding helpers", () => {
  it("normalises configured approved email domains", () => {
    expect(parseApprovedEmailDomains(" Venviewer.com,invalid domain,VENVIEWER.com,tradeshall.com ")).toEqual([
      "venviewer.com",
      "tradeshall.com",
    ]);
  });

  it("extracts only verified email claims from Clerk session payloads", () => {
    expect(extractVerifiedClerkSessionEmail({ email: "a@venviewer.com", email_verified: true })).toEqual({
      email: "a@venviewer.com",
      emailVerified: true,
    });
    expect(extractVerifiedClerkSessionEmail({ email: "a@venviewer.com" })).toEqual({
      email: "a@venviewer.com",
      emailVerified: false,
    });
  });
});
