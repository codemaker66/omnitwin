import { describe, it, expect } from "vitest";
import {
  UserIdSchema,
  USER_ROLES,
  UserRoleSchema,
  EmailSchema,
  UserSchema,
  CreateUserSchema,
} from "../user.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_VENUE_UUID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const VALID_DATETIME = "2025-01-15T10:30:00.000Z";

// New UserSchema: adds clerkId, displayName, phone, organizationName (all nullable).
const validUser = {
  id: VALID_UUID,
  clerkId: "user_2abc123def456",
  email: "alice@example.com",
  name: "Alice Smith",
  displayName: "Alice",
  phone: "+44 7911 000001",
  organizationName: "Acme Events",
  role: "staff" as const,
  venueId: VALID_VENUE_UUID,
  createdAt: VALID_DATETIME,
  updatedAt: VALID_DATETIME,
};

const validCreateUser = {
  email: "alice@example.com",
  name: "Alice Smith",
  role: "staff" as const,
  venueId: VALID_VENUE_UUID,
};

// ---------------------------------------------------------------------------
// UserIdSchema
// ---------------------------------------------------------------------------

describe("UserIdSchema", () => {
  it("accepts a valid UUID", () => {
    expect(UserIdSchema.safeParse(VALID_UUID).success).toBe(true);
  });

  it("rejects a non-UUID string", () => {
    expect(UserIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(UserIdSchema.safeParse("").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UserRoleSchema
// ---------------------------------------------------------------------------

describe("UserRoleSchema", () => {
  it.each(USER_ROLES)("accepts '%s'", (role) => {
    expect(UserRoleSchema.safeParse(role).success).toBe(true);
  });

  it("has exactly 5 roles (client, planner, staff, hallkeeper, admin)", () => {
    expect(USER_ROLES).toHaveLength(5);
  });

  it("contains the expected roles", () => {
    expect(USER_ROLES).toEqual(["client", "planner", "staff", "hallkeeper", "admin"]);
  });

  it("accepts 'planner' (default Clerk role)", () => {
    expect(UserRoleSchema.safeParse("planner").success).toBe(true);
  });

  it("rejects 'Client' (case sensitive)", () => {
    expect(UserRoleSchema.safeParse("Client").success).toBe(false);
  });

  it("rejects 'ADMIN' (case sensitive)", () => {
    expect(UserRoleSchema.safeParse("ADMIN").success).toBe(false);
  });

  it("rejects 'superadmin' (not a valid role)", () => {
    expect(UserRoleSchema.safeParse("superadmin").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(UserRoleSchema.safeParse("").success).toBe(false);
  });

  it("rejects null", () => {
    expect(UserRoleSchema.safeParse(null).success).toBe(false);
  });

  it("rejects a number", () => {
    expect(UserRoleSchema.safeParse(1).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EmailSchema
// ---------------------------------------------------------------------------

describe("EmailSchema", () => {
  it("accepts a valid email", () => {
    expect(EmailSchema.safeParse("alice@example.com").success).toBe(true);
  });

  it("accepts email with subdomain", () => {
    expect(EmailSchema.safeParse("user@mail.example.co.uk").success).toBe(true);
  });

  it("trims whitespace", () => {
    const result = EmailSchema.safeParse("  alice@example.com  ");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("alice@example.com");
    }
  });

  it("rejects empty string", () => {
    expect(EmailSchema.safeParse("").success).toBe(false);
  });

  it("rejects whitespace-only (empty after trim)", () => {
    expect(EmailSchema.safeParse("   ").success).toBe(false);
  });

  it("rejects missing @ symbol", () => {
    expect(EmailSchema.safeParse("aliceexample.com").success).toBe(false);
  });

  it("rejects missing domain", () => {
    expect(EmailSchema.safeParse("alice@").success).toBe(false);
  });

  it("rejects email exceeding 320 characters", () => {
    const longEmail = "a".repeat(310) + "@example.com";
    expect(EmailSchema.safeParse(longEmail).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UserSchema — full entity
// ---------------------------------------------------------------------------

describe("UserSchema", () => {
  it("accepts a fully valid user", () => {
    const result = UserSchema.safeParse(validUser);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Alice Smith");
      expect(result.data.role).toBe("staff");
    }
  });

  it("accepts null clerkId (users created before Clerk migration)", () => {
    const result = UserSchema.safeParse({ ...validUser, clerkId: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clerkId).toBeNull();
    }
  });

  it("accepts null displayName", () => {
    const result = UserSchema.safeParse({ ...validUser, displayName: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBeNull();
    }
  });

  it("accepts null phone", () => {
    const result = UserSchema.safeParse({ ...validUser, phone: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBeNull();
    }
  });

  it("accepts null organizationName", () => {
    const result = UserSchema.safeParse({ ...validUser, organizationName: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organizationName).toBeNull();
    }
  });

  // venueId is singular and nullable to match the runtime DB.
  // Multi-venue is a future SaaS milestone.
  it("accepts null venueId (client users without a venue)", () => {
    const result = UserSchema.safeParse({ ...validUser, venueId: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.venueId).toBeNull();
    }
  });

  it("trims whitespace from name", () => {
    const result = UserSchema.safeParse({ ...validUser, name: "  Alice  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Alice");
    }
  });

  it("rejects whitespace-only name", () => {
    expect(UserSchema.safeParse({ ...validUser, name: "   " }).success).toBe(false);
  });

  it("rejects missing id", () => {
    const { id: _, ...noId } = validUser;
    expect(UserSchema.safeParse(noId).success).toBe(false);
  });

  it("rejects missing email", () => {
    const { email: _, ...noEmail } = validUser;
    expect(UserSchema.safeParse(noEmail).success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validUser;
    expect(UserSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing role", () => {
    const { role: _, ...noRole } = validUser;
    expect(UserSchema.safeParse(noRole).success).toBe(false);
  });

  it("rejects missing venueId (must be present, even if null)", () => {
    const { venueId: _, ...noVenueId } = validUser;
    expect(UserSchema.safeParse(noVenueId).success).toBe(false);
  });

  it("rejects missing createdAt", () => {
    const { createdAt: _, ...noCreatedAt } = validUser;
    expect(UserSchema.safeParse(noCreatedAt).success).toBe(false);
  });

  it("rejects missing updatedAt", () => {
    const { updatedAt: _, ...noUpdatedAt } = validUser;
    expect(UserSchema.safeParse(noUpdatedAt).success).toBe(false);
  });

  it("rejects invalid UUID for id", () => {
    expect(UserSchema.safeParse({ ...validUser, id: "bad" }).success).toBe(false);
  });

  it("rejects invalid email", () => {
    expect(UserSchema.safeParse({ ...validUser, email: "not-an-email" }).success).toBe(false);
  });

  it("rejects invalid role", () => {
    expect(UserSchema.safeParse({ ...validUser, role: "superadmin" }).success).toBe(false);
  });

  it("rejects invalid UUID for venueId", () => {
    expect(UserSchema.safeParse({ ...validUser, venueId: "bad-uuid" }).success).toBe(false);
  });

  it("rejects name exceeding 200 characters", () => {
    expect(UserSchema.safeParse({ ...validUser, name: "A".repeat(201) }).success).toBe(false);
  });

  it("rejects invalid datetime for createdAt", () => {
    expect(UserSchema.safeParse({ ...validUser, createdAt: "nope" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CreateUserSchema
// ---------------------------------------------------------------------------

describe("CreateUserSchema", () => {
  it("accepts a valid create user payload", () => {
    expect(CreateUserSchema.safeParse(validCreateUser).success).toBe(true);
  });

  it("accepts optional clerkId", () => {
    expect(
      CreateUserSchema.safeParse({ ...validCreateUser, clerkId: "user_2abc123" }).success,
    ).toBe(true);
  });

  it("accepts optional displayName", () => {
    expect(
      CreateUserSchema.safeParse({ ...validCreateUser, displayName: "Alice" }).success,
    ).toBe(true);
  });

  it("accepts optional phone", () => {
    expect(
      CreateUserSchema.safeParse({ ...validCreateUser, phone: "+44 7911 000001" }).success,
    ).toBe(true);
  });

  it("accepts optional organizationName", () => {
    expect(
      CreateUserSchema.safeParse({ ...validCreateUser, organizationName: "Acme Events" }).success,
    ).toBe(true);
  });

  it("rejects missing email", () => {
    const { email: _, ...noEmail } = validCreateUser;
    expect(CreateUserSchema.safeParse(noEmail).success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validCreateUser;
    expect(CreateUserSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing role", () => {
    const { role: _, ...noRole } = validCreateUser;
    expect(CreateUserSchema.safeParse(noRole).success).toBe(false);
  });

  it("rejects missing venueId", () => {
    const { venueId: _, ...noVenueId } = validCreateUser;
    expect(CreateUserSchema.safeParse(noVenueId).success).toBe(false);
  });

  it("accepts null venueId for client users", () => {
    expect(CreateUserSchema.safeParse({ ...validCreateUser, venueId: null }).success).toBe(true);
  });

  it("does not accept id field (strips extra keys)", () => {
    const result = CreateUserSchema.safeParse({ ...validCreateUser, id: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("id" in result.data).toBe(false);
    }
  });

  it("does not accept createdAt field (strips extra keys)", () => {
    const result = CreateUserSchema.safeParse({ ...validCreateUser, createdAt: VALID_DATETIME });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("createdAt" in result.data).toBe(false);
    }
  });
});

// LoginRequestSchema, RegisterRequestSchema, AuthTokensSchema were deleted —
// pre-Clerk auth flow no longer exists. System uses Clerk session tokens.
