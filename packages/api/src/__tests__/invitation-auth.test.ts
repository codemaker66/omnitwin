import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { userInvitations, users } from "../db/schema.js";
import {
  getApprovedDomainGrant,
  getUserByClerkId,
  normalizeAuthEmail,
  resolveVerifiedClerkEmail,
} from "../middleware/auth.js";

type UserRow = typeof users.$inferSelect;
type InvitationRow = typeof userInvitations.$inferSelect;

interface RecordedInsert {
  readonly table: unknown;
  readonly values: unknown;
}

interface RecordedUpdate {
  readonly table: unknown;
  readonly values: unknown;
}

interface MockDbState {
  readonly inserted: RecordedInsert[];
  readonly updated: RecordedUpdate[];
}

const USER_ID = "11111111-1111-4111-8111-111111111111";
const VENUE_ID = "22222222-2222-4222-8222-222222222222";

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: USER_ID,
    clerkId: null,
    email: "invited@example.com",
    name: "Invited User",
    displayName: null,
    phone: null,
    organizationName: null,
    role: "planner",
    venueId: null,
    username: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function invitationRow(overrides: Partial<InvitationRow> = {}): InvitationRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    email: "invited@example.com",
    domain: null,
    role: "staff",
    venueId: VENUE_ID,
    tokenHash: null,
    status: "pending",
    expiresAt: new Date("2030-01-01T00:00:00Z"),
    acceptedAt: null,
    acceptedBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function makeMockDb(options: {
  readonly existingByClerk?: UserRow;
  readonly existingByEmail?: UserRow;
  readonly emailInvitation?: InvitationRow;
  readonly domainInvitation?: InvitationRow;
  readonly createdUser?: UserRow;
  readonly invitationClaimSucceeds?: boolean;
} = {}): { readonly db: Database; readonly state: MockDbState } {
  const state: MockDbState = { inserted: [], updated: [] };
  let userSelectCount = 0;
  let invitationSelectCount = 0;
  const invitationClaimSucceeds = options.invitationClaimSucceeds ?? true;

  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: (_condition: unknown) => ({
          limit: (_limit: number): Promise<readonly unknown[]> => {
            if (table === users) {
              userSelectCount += 1;
              if (userSelectCount === 1) {
                return Promise.resolve(options.existingByClerk === undefined ? [] : [options.existingByClerk]);
              }
              return Promise.resolve(options.existingByEmail === undefined ? [] : [options.existingByEmail]);
            }

            if (table === userInvitations) {
              invitationSelectCount += 1;
              if (invitationSelectCount === 1) {
                return Promise.resolve(options.emailInvitation === undefined ? [] : [options.emailInvitation]);
              }
              return Promise.resolve(options.domainInvitation === undefined ? [] : [options.domainInvitation]);
            }

            return Promise.resolve([]);
          },
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: (_condition: unknown) => {
          state.updated.push({ table, values });
          const result = Promise.resolve([]);
          return Object.assign(result, {
            returning: (): Promise<readonly unknown[]> => {
              if (table === userInvitations && asRecord(values)["status"] === "accepted") {
                return Promise.resolve(invitationClaimSucceeds ? [{ id: "33333333-3333-4333-8333-333333333333" }] : []);
              }
              return Promise.resolve([]);
            },
          });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        returning: (): Promise<readonly unknown[]> => {
          state.inserted.push({ table, values });
          if (table !== users) return Promise.resolve([]);
          return Promise.resolve([options.createdUser ?? userRow({
            id: "44444444-4444-4444-8444-444444444444",
            clerkId: asRecord(values)["clerkId"] as string,
            email: asRecord(values)["email"] as string,
            role: asRecord(values)["role"] as string,
            venueId: asRecord(values)["venueId"] as string | null,
          })]);
        },
      }),
    }),
    transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => callback(db),
  };

  return { db: db as never as Database, state };
}

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
    return;
  }
  process.env[name] = value;
}

describe("Clerk invitation access policy", () => {
  const originalDomains = process.env["VENVIEWER_APPROVED_AUTH_DOMAINS"];
  const originalDomainRole = process.env["VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE"];
  const originalDomainVenue = process.env["VENVIEWER_APPROVED_AUTH_DOMAIN_VENUE_ID"];

  beforeEach(() => {
    setEnv("VENVIEWER_APPROVED_AUTH_DOMAINS", undefined);
    setEnv("VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE", undefined);
    setEnv("VENVIEWER_APPROVED_AUTH_DOMAIN_VENUE_ID", undefined);
  });

  afterEach(() => {
    setEnv("VENVIEWER_APPROVED_AUTH_DOMAINS", originalDomains);
    setEnv("VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE", originalDomainRole);
    setEnv("VENVIEWER_APPROVED_AUTH_DOMAIN_VENUE_ID", originalDomainVenue);
  });

  it("normalizes real email addresses and rejects invalid/missing email", () => {
    expect(normalizeAuthEmail("  Invited@Example.COM ")).toBe("invited@example.com");
    expect(normalizeAuthEmail("not-email")).toBeNull();
    expect(normalizeAuthEmail(undefined)).toBeNull();
  });

  it("requires an explicit verified email signal from Clerk payloads", () => {
    expect(resolveVerifiedClerkEmail({ email: "person@example.com", email_verified: true })).toEqual({
      ok: true,
      email: "person@example.com",
    });
    expect(resolveVerifiedClerkEmail({ email: "person@example.com" })).toEqual({
      ok: false,
      code: "EMAIL_UNVERIFIED",
      message: "Email address must be verified before access is granted",
    });
    expect(resolveVerifiedClerkEmail({ sub: "clerk_missing" })).toEqual({
      ok: false,
      code: "EMAIL_REQUIRED",
      message: "A verified email address is required",
    });
  });

  it("creates a local user only when a pending email invitation exists", async () => {
    const createdUser = userRow({
      id: "44444444-4444-4444-8444-444444444444",
      clerkId: "clerk_invited",
      email: "invited@example.com",
      role: "staff",
      venueId: VENUE_ID,
    });
    const { db, state } = makeMockDb({
      emailInvitation: invitationRow(),
      createdUser,
    });

    const user = await getUserByClerkId(db, "clerk_invited", "Invited@Example.com");

    expect(user).toEqual({
      id: createdUser.id,
      email: "invited@example.com",
      role: "staff",
      venueId: VENUE_ID,
    });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]?.table).toBe(users);
    expect(state.inserted[0]?.values).toMatchObject({
      clerkId: "clerk_invited",
      email: "invited@example.com",
      role: "staff",
      venueId: VENUE_ID,
    });
    expect(state.updated).toHaveLength(2);
    expect(state.updated[0]?.table).toBe(userInvitations);
    expect(state.updated[0]?.values).toMatchObject({
      status: "accepted",
    });
    expect(state.updated[1]?.table).toBe(userInvitations);
    expect(state.updated[1]?.values).toMatchObject({
      acceptedBy: createdUser.id,
    });
  });

  it("does not create a user when a concurrent login already claimed the invitation", async () => {
    const { db, state } = makeMockDb({
      emailInvitation: invitationRow(),
      invitationClaimSucceeds: false,
    });

    const user = await getUserByClerkId(db, "clerk_race", "Invited@Example.com");

    expect(user).toBeNull();
    expect(state.inserted).toHaveLength(0);
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0]?.table).toBe(userInvitations);
    expect(state.updated[0]?.values).toMatchObject({
      status: "accepted",
    });
  });

  it("does not create a planner user for an uninvited Clerk identity", async () => {
    const { db, state } = makeMockDb();

    const user = await getUserByClerkId(db, "clerk_uninvited", "stranger@example.com");

    expect(user).toBeNull();
    expect(state.inserted).toHaveLength(0);
    expect(state.updated).toHaveLength(0);
  });

  it("rejects expired invitations", async () => {
    const { db, state } = makeMockDb({
      emailInvitation: invitationRow({ expiresAt: new Date("2020-01-01T00:00:00Z") }),
    });

    const user = await getUserByClerkId(db, "clerk_expired", "invited@example.com");

    expect(user).toBeNull();
    expect(state.inserted).toHaveLength(0);
  });

  it("links an existing pre-provisioned user row without changing role or venue scope", async () => {
    const existing = userRow({
      id: "55555555-5555-4555-8555-555555555555",
      clerkId: null,
      email: "seeded@example.com",
      role: "hallkeeper",
      venueId: VENUE_ID,
    });
    const { db, state } = makeMockDb({ existingByEmail: existing });

    const user = await getUserByClerkId(db, "clerk_seeded", "seeded@example.com");

    expect(user).toEqual({
      id: existing.id,
      email: "seeded@example.com",
      role: "hallkeeper",
      venueId: VENUE_ID,
    });
    expect(state.inserted).toHaveLength(0);
    expect(state.updated[0]?.table).toBe(users);
    expect(state.updated[0]?.values).toMatchObject({ clerkId: "clerk_seeded" });
  });

  it("does not link an email row already bound to another Clerk identity", async () => {
    const { db, state } = makeMockDb({
      existingByEmail: userRow({ clerkId: "clerk_other", email: "taken@example.com" }),
    });

    const user = await getUserByClerkId(db, "clerk_attacker", "taken@example.com");

    expect(user).toBeNull();
    expect(state.inserted).toHaveLength(0);
    expect(state.updated).toHaveLength(0);
  });

  it("keeps approved domains disabled unless explicitly configured", () => {
    expect(getApprovedDomainGrant("planner@approved.example")).toBeNull();

    setEnv("VENVIEWER_APPROVED_AUTH_DOMAINS", "approved.example");
    setEnv("VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE", "planner");
    setEnv("VENVIEWER_APPROVED_AUTH_DOMAIN_VENUE_ID", VENUE_ID);

    expect(getApprovedDomainGrant("planner@approved.example")).toEqual({
      role: "planner",
      venueId: VENUE_ID,
    });
  });

  it("creates domain-approved users only under the explicit domain policy", async () => {
    setEnv("VENVIEWER_APPROVED_AUTH_DOMAINS", "approved.example");
    setEnv("VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE", "staff");
    setEnv("VENVIEWER_APPROVED_AUTH_DOMAIN_VENUE_ID", VENUE_ID);
    const createdUser = userRow({
      id: "66666666-6666-4666-8666-666666666666",
      clerkId: "clerk_domain",
      email: "person@approved.example",
      role: "staff",
      venueId: VENUE_ID,
    });
    const { db, state } = makeMockDb({ createdUser });

    const user = await getUserByClerkId(db, "clerk_domain", "person@approved.example");

    expect(user).toEqual({
      id: createdUser.id,
      email: "person@approved.example",
      role: "staff",
      venueId: VENUE_ID,
    });
    expect(state.inserted[0]?.values).toMatchObject({
      clerkId: "clerk_domain",
      email: "person@approved.example",
      role: "staff",
      venueId: VENUE_ID,
    });
  });
});
