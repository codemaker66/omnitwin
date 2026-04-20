import { describe, it, expect } from "vitest";
import { canAccessResource, canManageVenue } from "../../utils/query.js";
import type { JwtUser } from "../../middleware/auth.js";

// ---------------------------------------------------------------------------
// Auth helpers — `canAccessResource` + `canManageVenue`
//
// These two functions are the keystone of the role-gated-route auth
// model. Every read/write route eventually calls canAccessResource to
// decide whether the current user can see a given config, enquiry, or
// snapshot. A bug here compromises every downstream route.
//
// The matrix under test:
//
//   | actor         | owner?  | venue match | expected |
//   |---------------|---------|-------------|----------|
//   | admin         | -       | -           | true     |
//   | staff@A       | -       | A           | true     |
//   | staff@A       | -       | B           | FALSE    |
//   | hallkeeper@A  | -       | A           | true     |
//   | hallkeeper@A  | -       | B           | FALSE    |
//   | planner       | yes     | any         | true     |
//   | planner       | no      | any         | FALSE    |
//   | client        | yes     | any         | true     |
//   | client        | no      | any         | FALSE    |
// ---------------------------------------------------------------------------

const VENUE_A = "00000000-0000-0000-0000-0000000000a0";
const VENUE_B = "00000000-0000-0000-0000-0000000000b0";
const USER_PLANNER_1 = "00000000-0000-0000-0000-0000000000f1";
const USER_PLANNER_2 = "00000000-0000-0000-0000-0000000000f2";

function makeUser(overrides: Partial<JwtUser> & Pick<JwtUser, "role">): JwtUser {
  return {
    id: overrides.id ?? "00000000-0000-0000-0000-000000000001",
    email: overrides.email ?? "user@test.com",
    role: overrides.role,
    venueId: overrides.venueId ?? null,
  };
}

// ---------------------------------------------------------------------------
// canManageVenue
// ---------------------------------------------------------------------------

describe("canManageVenue", () => {
  it("admin can manage any venue regardless of their own venueId", () => {
    expect(canManageVenue(makeUser({ role: "admin", venueId: null }), VENUE_A)).toBe(true);
    expect(canManageVenue(makeUser({ role: "admin", venueId: VENUE_B }), VENUE_A)).toBe(true);
  });

  it("staff at venue A can manage venue A", () => {
    expect(canManageVenue(makeUser({ role: "staff", venueId: VENUE_A }), VENUE_A)).toBe(true);
  });

  it("staff at venue A CANNOT manage venue B (cross-venue bypass guard)", () => {
    expect(canManageVenue(makeUser({ role: "staff", venueId: VENUE_A }), VENUE_B)).toBe(false);
  });

  it("hallkeeper at venue A can manage venue A", () => {
    expect(canManageVenue(makeUser({ role: "hallkeeper", venueId: VENUE_A }), VENUE_A)).toBe(true);
  });

  it("hallkeeper at venue A CANNOT manage venue B", () => {
    expect(canManageVenue(makeUser({ role: "hallkeeper", venueId: VENUE_A }), VENUE_B)).toBe(false);
  });

  it("staff with no venueId cannot manage any venue", () => {
    expect(canManageVenue(makeUser({ role: "staff", venueId: null }), VENUE_A)).toBe(false);
  });

  it("planner cannot manage a venue even if assigned to one", () => {
    expect(canManageVenue(makeUser({ role: "planner", venueId: VENUE_A }), VENUE_A)).toBe(false);
  });

  it("client cannot manage a venue", () => {
    expect(canManageVenue(makeUser({ role: "client", venueId: VENUE_A }), VENUE_A)).toBe(false);
  });

  it("unknown role cannot manage a venue (fail-closed default)", () => {
    expect(canManageVenue(makeUser({ role: "future_role", venueId: VENUE_A }), VENUE_A)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canAccessResource — ownership OR venue-managed
// ---------------------------------------------------------------------------

describe("canAccessResource", () => {
  it("the owner can always access their own resource (even across venues)", () => {
    const user = makeUser({ id: USER_PLANNER_1, role: "planner", venueId: null });
    expect(canAccessResource(user, USER_PLANNER_1, VENUE_A)).toBe(true);
    expect(canAccessResource(user, USER_PLANNER_1, VENUE_B)).toBe(true);
  });

  it("a planner cannot access another planner's resource at any venue", () => {
    const user = makeUser({ id: USER_PLANNER_1, role: "planner", venueId: null });
    expect(canAccessResource(user, USER_PLANNER_2, VENUE_A)).toBe(false);
    expect(canAccessResource(user, USER_PLANNER_2, VENUE_B)).toBe(false);
  });

  it("admin can access any resource", () => {
    const user = makeUser({ role: "admin", venueId: null });
    expect(canAccessResource(user, USER_PLANNER_1, VENUE_A)).toBe(true);
    expect(canAccessResource(user, null, VENUE_B)).toBe(true);
  });

  it("staff at venue A can access any resource at venue A (non-owner path)", () => {
    const user = makeUser({ role: "staff", venueId: VENUE_A });
    expect(canAccessResource(user, USER_PLANNER_1, VENUE_A)).toBe(true);
  });

  it("staff at venue A CANNOT access resources at venue B (cross-venue bypass guard)", () => {
    const user = makeUser({ role: "staff", venueId: VENUE_A });
    expect(canAccessResource(user, USER_PLANNER_1, VENUE_B)).toBe(false);
  });

  it("hallkeeper at venue A CANNOT access resources at venue B", () => {
    const user = makeUser({ role: "hallkeeper", venueId: VENUE_A });
    expect(canAccessResource(user, USER_PLANNER_1, VENUE_B)).toBe(false);
  });

  it("null ownerId + non-admin + wrong venue → denied", () => {
    const user = makeUser({ role: "staff", venueId: VENUE_A });
    expect(canAccessResource(user, null, VENUE_B)).toBe(false);
  });

  it("null ownerId + admin → granted (the anonymous-owned-resource path)", () => {
    const user = makeUser({ role: "admin", venueId: null });
    expect(canAccessResource(user, null, VENUE_A)).toBe(true);
  });
});
