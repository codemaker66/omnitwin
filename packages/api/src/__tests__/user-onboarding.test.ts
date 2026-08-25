import { describe, expect, it } from "vitest";
import {
  isApprovedEmailDomain,
  parseApprovedEmailDomains,
  readClerkEmailClaims,
  resolveUserForClerkIdentity,
  type CreateApprovedDomainUserInput,
  type LocalUserRecord,
  type UserOnboardingAuditRecord,
  type UserOnboardingStore,
} from "../services/user-onboarding.js";

class MemoryOnboardingStore implements UserOnboardingStore {
  readonly decisions: UserOnboardingAuditRecord[] = [];
  private readonly rows: LocalUserRecord[];

  constructor(initialRows: readonly LocalUserRecord[] = []) {
    this.rows = [...initialRows];
  }

  findUserByClerkId(clerkId: string): Promise<LocalUserRecord | null> {
    return Promise.resolve(this.rows.find((row) => row.clerkId === clerkId) ?? null);
  }

  findUserByEmail(email: string): Promise<LocalUserRecord | null> {
    return Promise.resolve(this.rows.find((row) => row.email === email) ?? null);
  }

  linkUserToClerk(userId: string, clerkId: string): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === userId);
    if (index < 0) return Promise.resolve();

    const row = this.rows[index];
    if (row === undefined) return Promise.resolve();
    this.rows[index] = { ...row, clerkId };
    return Promise.resolve();
  }

  createApprovedDomainUser(input: CreateApprovedDomainUserInput): Promise<LocalUserRecord | null> {
    const row: LocalUserRecord = {
      id: `created-${String(this.rows.length + 1)}`,
      clerkId: input.clerkId,
      email: input.email,
      role: "planner",
      venueId: null,
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  recordOnboardingDecision(record: UserOnboardingAuditRecord): Promise<void> {
    this.decisions.push(record);
    return Promise.resolve();
  }

  getUserByEmail(email: string): LocalUserRecord | null {
    return this.rows.find((row) => row.email === email) ?? null;
  }

  get userCount(): number {
    return this.rows.length;
  }
}

describe("user onboarding gate", () => {
  it("links a verified Clerk identity to a pre-provisioned invited user", async () => {
    const store = new MemoryOnboardingStore([{
      id: "user-invited",
      clerkId: null,
      email: "planner@tradeshall.co.uk",
      role: "staff",
      venueId: "venue-grand-hall",
    }]);

    const result = await resolveUserForClerkIdentity(store, {
      clerkId: "clerk_invited",
      email: "Planner@TradesHall.co.uk",
      emailVerified: true,
      name: "Planner Invite",
      source: "auth",
    });

    expect(result).toEqual({
      id: "user-invited",
      email: "planner@tradeshall.co.uk",
      role: "staff",
      venueId: "venue-grand-hall",
    });
    expect(store.getUserByEmail("planner@tradeshall.co.uk")?.clerkId).toBe("clerk_invited");
    expect(store.decisions).toHaveLength(1);
    expect(store.decisions[0]).toMatchObject({
      decision: "allowed",
      reason: "email_invitation",
      matchedUserId: "user-invited",
      venueId: "venue-grand-hall",
      role: "staff",
    });
  });

  it("creates only a planner user for a verified approved-domain identity", async () => {
    const store = new MemoryOnboardingStore();

    const result = await resolveUserForClerkIdentity(store, {
      clerkId: "clerk_domain",
      email: "Planner@TradesHall.co.uk",
      emailVerified: true,
      name: "Domain Planner",
      source: "clerk_webhook",
    }, {
      approvedEmailDomains: ["tradeshall.co.uk"],
    });

    expect(result).toEqual({
      id: "created-1",
      email: "planner@tradeshall.co.uk",
      role: "planner",
      venueId: null,
    });
    expect(store.decisions[0]).toMatchObject({
      decision: "allowed",
      reason: "approved_domain",
      source: "clerk_webhook",
      role: "planner",
    });
  });

  it("does not create a user for an arbitrary verified Clerk identity", async () => {
    const store = new MemoryOnboardingStore();

    const result = await resolveUserForClerkIdentity(store, {
      clerkId: "clerk_arbitrary",
      email: "unknown@example.com",
      emailVerified: true,
      name: "Unknown Person",
      source: "auth",
    });

    expect(result).toBeNull();
    expect(store.userCount).toBe(0);
    expect(store.decisions).toEqual([{
      clerkId: "clerk_arbitrary",
      email: "unknown@example.com",
      decision: "denied",
      reason: "not_invited",
      source: "auth",
      matchedUserId: null,
      venueId: null,
      role: null,
    }]);
  });

  it("fails closed when Clerk provides no verified email", async () => {
    const store = new MemoryOnboardingStore();

    const result = await resolveUserForClerkIdentity(store, {
      clerkId: "clerk_missing_email",
      email: null,
      emailVerified: true,
      name: null,
      source: "websocket",
    }, {
      approvedEmailDomains: ["tradeshall.co.uk"],
    });

    expect(result).toBeNull();
    expect(store.userCount).toBe(0);
    expect(store.decisions[0]).toMatchObject({
      decision: "denied",
      reason: "missing_verified_email",
      source: "websocket",
    });
  });

  it("fails closed when Clerk marks the email unverified", async () => {
    const store = new MemoryOnboardingStore();

    const result = await resolveUserForClerkIdentity(store, {
      clerkId: "clerk_unverified",
      email: "planner@tradeshall.co.uk",
      emailVerified: false,
      name: "Unverified Person",
      source: "auth",
    }, {
      approvedEmailDomains: ["tradeshall.co.uk"],
    });

    expect(result).toBeNull();
    expect(store.userCount).toBe(0);
    expect(store.decisions[0]?.reason).toBe("missing_verified_email");
  });

  it("keeps existing linked users working without re-onboarding", async () => {
    const store = new MemoryOnboardingStore([{
      id: "user-linked",
      clerkId: "clerk_linked",
      email: "linked@venue.com",
      role: "hallkeeper",
      venueId: "venue-grand-hall",
    }]);

    const result = await resolveUserForClerkIdentity(store, {
      clerkId: "clerk_linked",
      email: null,
      emailVerified: false,
      name: null,
      source: "auth",
    });

    expect(result?.id).toBe("user-linked");
    expect(result?.role).toBe("hallkeeper");
    expect(store.decisions).toHaveLength(0);
  });
});

describe("approved email domain helpers", () => {
  it("parses approved domains conservatively", () => {
    expect(parseApprovedEmailDomains(" TradesHall.co.uk, invalid domain, venue.example ")).toEqual([
      "tradeshall.co.uk",
      "venue.example",
    ]);
  });

  it("requires an exact domain match", () => {
    expect(isApprovedEmailDomain("planner@tradeshall.co.uk", ["tradeshall.co.uk"])).toBe(true);
    expect(isApprovedEmailDomain("planner@eviltradeshall.co.uk", ["tradeshall.co.uk"])).toBe(false);
    expect(isApprovedEmailDomain("planner@sub.tradeshall.co.uk", ["tradeshall.co.uk"])).toBe(false);
  });
});

describe("Clerk email claims", () => {
  it("reads only boolean verified email claims", () => {
    expect(readClerkEmailClaims({ email: "Planner@TradesHall.co.uk", email_verified: true })).toEqual({
      email: "Planner@TradesHall.co.uk",
      emailVerified: true,
    });
    expect(readClerkEmailClaims({ email: "Planner@TradesHall.co.uk", email_verified: "true" })).toEqual({
      email: "Planner@TradesHall.co.uk",
      emailVerified: false,
    });
  });
});
