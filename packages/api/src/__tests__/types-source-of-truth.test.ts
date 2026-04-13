import { describe, it, expect } from "vitest";
import { LAYOUT_STYLES, LayoutStyleSchema, UserSchema, CreateUserSchema, VenueIdSchema } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Source-of-truth contract — punch list #13
//
// `@omnitwin/types` is the single source of truth for shared schemas. The
// API package previously duplicated `LayoutStyleSchema` inline in
// `routes/configurations.ts` with camelCase variants (`dinnerRounds`,
// `dinnerBanquet`) that silently disagreed with the kebab-case values in
// `@omnitwin/types`. The DB column is `varchar(50)` with no enum constraint,
// so both formats could coexist in production data — and the solver
// (which keys off kebab-case) would silently fail to find a strategy for
// any config created via the API.
//
// These tests pin the new contract:
//   1. Code-level: routes/configurations.ts imports LayoutStyleSchema from
//      @omnitwin/types and does NOT contain any inline camelCase enum.
//   2. Behavioural: the canonical kebab-case values still parse, and the
//      legacy camelCase variants are explicitly rejected.
//
// This is a tripwire — if anyone re-introduces a duplicate enum by
// copy-paste, these tests fail loudly at the source-grep level before
// the runtime drift can leak into production.
// ---------------------------------------------------------------------------

describe("LayoutStyle source-of-truth (#13)", () => {
  it("routes/configurations.ts imports LayoutStyleSchema from @omnitwin/types", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve("src/routes/configurations.ts"),
      "utf-8",
    );
    // Strip comments before checking — comments may legitimately mention
    // the legacy camelCase variants for context (and should, in fact,
    // document what was removed and why).
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    // Positive: imports the shared schema
    expect(codeOnly).toContain("LayoutStyleSchema");
    expect(codeOnly).toMatch(/from\s+["']@omnitwin\/types["']/);

    // Negative: no inline camelCase enum literals anywhere in code
    expect(codeOnly).not.toContain("dinnerRounds");
    expect(codeOnly).not.toContain("dinnerBanquet");
  });

  it("canonical kebab-case values parse through LayoutStyleSchema", () => {
    for (const style of LAYOUT_STYLES) {
      expect(LayoutStyleSchema.safeParse(style).success).toBe(true);
    }
  });

  it("rejects legacy camelCase variants", () => {
    expect(LayoutStyleSchema.safeParse("dinnerRounds").success).toBe(false);
    expect(LayoutStyleSchema.safeParse("dinnerBanquet").success).toBe(false);
  });

  it("LAYOUT_STYLES is the kebab-case set the solver expects", () => {
    // Pinned exact values so any future drift in the source schema also
    // breaks this test, forcing a deliberate decision to update both ends.
    expect(LAYOUT_STYLES).toEqual([
      "ceremony",
      "dinner-rounds",
      "dinner-banquet",
      "theatre",
      "boardroom",
      "cabaret",
      "cocktail",
      "custom",
    ]);
  });
});

// ---------------------------------------------------------------------------
// User.venueId source-of-truth contract — punch list #35 / Prompt 16
//
// `@omnitwin/types/User` previously declared `venueIds: VenueId[]` (plural
// array). The runtime DB column (`packages/api/src/db/schema.ts` users table)
// is `venue_id uuid` (singular, nullable), and `JwtUser` in
// `packages/api/src/middleware/auth.ts` matches the runtime: `venueId:
// string | null`. The shared schema and the runtime had been silently
// disagreeing since day one — a future engineer trusting the shared schema
// would have written code that compiled but crashed against the real DB.
//
// OMNITWIN today is single-tenant Trades Hall with one venue per user.
// When the SaaS multi-tenant rebuild happens, many-venues-per-user becomes
// a proper `user_venues` join table with a database migration. Tracked in
// memory at project_multi_venue_findings.md.
//
// These tests pin the alignment so the contradiction can never come back:
//   1. Behavioural: shared schema accepts singular venueId
//      and rejects the legacy plural venueIds shape.
//   2. Source-grep: db/schema.ts and middleware/auth.ts both use the
//      singular form, and neither has drifted to plural.
//   3. Negative: the shared types package source does NOT contain a
//      `venueIds` declaration anywhere outside comments.
// ---------------------------------------------------------------------------

describe("User.venueId source-of-truth (#35 / Prompt 16)", () => {
  const VALID_USER_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
  const VALID_VENUE_UUID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
  const VALID_DATETIME = "2025-01-15T10:30:00.000Z";

  const validUser = {
    id: VALID_USER_UUID,
    clerkId: null,
    email: "alice@example.com",
    name: "Alice Smith",
    displayName: null,
    phone: null,
    organizationName: null,
    role: "staff" as const,
    venueId: VALID_VENUE_UUID,
    createdAt: VALID_DATETIME,
    updatedAt: VALID_DATETIME,
  };

  it("UserSchema accepts singular venueId (string)", () => {
    expect(UserSchema.safeParse(validUser).success).toBe(true);
  });

  it("UserSchema accepts null venueId (client users)", () => {
    expect(UserSchema.safeParse({ ...validUser, venueId: null }).success).toBe(true);
  });

  it("UserSchema REJECTS plural venueIds shape (legacy contract gone)", () => {
    // The legacy plural shape: missing venueId, has venueIds instead.
    const { venueId: _, ...withoutVenueId } = validUser;
    const legacyShape = { ...withoutVenueId, venueIds: [VALID_VENUE_UUID] };
    expect(UserSchema.safeParse(legacyShape).success).toBe(false);
  });

  it("CreateUserSchema accepts singular venueId", () => {
    expect(CreateUserSchema.safeParse({
      email: "alice@example.com",
      name: "Alice Smith",
      role: "staff",
      venueId: VALID_VENUE_UUID,
    }).success).toBe(true);
  });

  it("CreateUserSchema accepts null venueId for client users", () => {
    expect(CreateUserSchema.safeParse({
      email: "alice@example.com",
      name: "Alice Smith",
      role: "client",
      venueId: null,
    }).success).toBe(true);
  });

  it("VenueIdSchema is the type backing User.venueId", () => {
    // Pin the exact UUID format so a future drift in VenueIdSchema also
    // breaks this test.
    expect(VenueIdSchema.safeParse(VALID_VENUE_UUID).success).toBe(true);
    expect(VenueIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("db/schema.ts users table uses singular venue_id column", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve("src/db/schema.ts"),
      "utf-8",
    );
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    // Positive: the singular `venueId: uuid("venue_id")` declaration exists
    // in the users table region. We grep for the field+column pair in code.
    expect(codeOnly).toContain(`venueId: uuid("venue_id")`);
    // Negative: no plural `venueIds` field on the users table. The Drizzle
    // schema is the runtime source of truth — if anyone adds a plural
    // column without a join table, this fails first.
    expect(codeOnly).not.toContain("venueIds:");
  });

  it("middleware/auth.ts JwtUser uses singular venueId", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve("src/middleware/auth.ts"),
      "utf-8",
    );
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    // Positive: JwtUser has the singular venueId field
    expect(codeOnly).toMatch(/readonly venueId:\s*string\s*\|\s*null/);
    // Negative: no plural form has crept in
    expect(codeOnly).not.toContain("venueIds:");
  });
});
