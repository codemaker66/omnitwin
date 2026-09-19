import { describe, it, expect } from "vitest";
import {
  canAccessInternalEvent,
  canAccessResource,
  canAdministerVenue,
  canManageCommercial,
  canManageVenue,
  canReadInventory,
  canReadVenuePlanningData,
  canWriteEvents,
  canWriteInventory,
  isEventWriteRole,
} from "../../utils/query.js";
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
//   | platform admin| -       | -           | true     |
//   | venue admin@A | -       | A           | true     |
//   | venue admin@A | -       | B           | FALSE    |
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
    name: overrides.name ?? "Test User",
    role: overrides.role,
    platformRole: overrides.platformRole ?? "none",
    venueId: overrides.venueId ?? null,
  };
}

// ---------------------------------------------------------------------------
// canManageVenue
// ---------------------------------------------------------------------------

describe("canManageVenue", () => {
  it("platform admin can manage any venue regardless of their own venueId", () => {
    expect(canManageVenue(makeUser({ role: "admin", platformRole: "admin", venueId: null }), VENUE_A)).toBe(true);
    expect(canManageVenue(makeUser({ role: "admin", platformRole: "admin", venueId: VENUE_B }), VENUE_A)).toBe(true);
  });

  it("venue admin can manage only their assigned venue", () => {
    expect(canManageVenue(makeUser({ role: "admin", platformRole: "none", venueId: VENUE_A }), VENUE_A)).toBe(true);
    expect(canManageVenue(makeUser({ role: "admin", platformRole: "none", venueId: VENUE_B }), VENUE_A)).toBe(false);
    expect(canManageVenue(makeUser({ role: "admin", platformRole: "none", venueId: null }), VENUE_A)).toBe(false);
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

  it("platform admin can access any resource", () => {
    const user = makeUser({ role: "admin", platformRole: "admin", venueId: null });
    expect(canAccessResource(user, USER_PLANNER_1, VENUE_A)).toBe(true);
    expect(canAccessResource(user, null, VENUE_B)).toBe(true);
  });

  it("venue admin can access only resources at their venue", () => {
    const user = makeUser({ role: "admin", platformRole: "none", venueId: VENUE_A });
    expect(canAccessResource(user, USER_PLANNER_1, VENUE_A)).toBe(true);
    expect(canAccessResource(user, USER_PLANNER_1, VENUE_B)).toBe(false);
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

  it("null ownerId + platform admin → granted (the anonymous-owned-resource path)", () => {
    const user = makeUser({ role: "admin", platformRole: "admin", venueId: null });
    expect(canAccessResource(user, null, VENUE_A)).toBe(true);
  });
});

describe("event write policy", () => {
  it("admits staff/admin roles and refuses read-only roles", () => {
    expect(isEventWriteRole(makeUser({ role: "staff", venueId: VENUE_A }))).toBe(true);
    expect(isEventWriteRole(makeUser({ role: "admin", venueId: VENUE_A }))).toBe(true);
    expect(isEventWriteRole(makeUser({ role: "hallkeeper", venueId: VENUE_A }))).toBe(false);
    expect(isEventWriteRole(makeUser({ role: "planner", venueId: VENUE_A }))).toBe(false);
    expect(isEventWriteRole(makeUser({ role: "client", venueId: VENUE_A }))).toBe(false);
  });

  it("requires the persisted venue for staff/admin and preserves platform admin scope", () => {
    expect(canWriteEvents(makeUser({ role: "staff", venueId: VENUE_A }), VENUE_A)).toBe(true);
    expect(canWriteEvents(makeUser({ role: "staff", venueId: VENUE_A }), VENUE_B)).toBe(false);
    expect(canWriteEvents(makeUser({ role: "admin", venueId: VENUE_B }), VENUE_A)).toBe(false);
    expect(canWriteEvents(makeUser({ role: "hallkeeper", venueId: VENUE_A }), VENUE_A)).toBe(false);
    expect(canWriteEvents(
      makeUser({ role: "admin", platformRole: "admin", venueId: null }),
      VENUE_B,
    )).toBe(true);
  });
});

describe("internal event authority", () => {
  it("retains current venue operations and explicit platform administration", () => {
    for (const role of ["staff", "hallkeeper", "admin"] as const) {
      expect(canAccessInternalEvent(makeUser({ role, venueId: VENUE_A }), VENUE_A)).toBe(true);
    }
    expect(canAccessInternalEvent(makeUser({ role: "admin", platformRole: "admin" }), VENUE_A)).toBe(true);
  });

  it("does not preserve event access after the creator loses role or venue authority", () => {
    for (const user of [
      makeUser({ id: USER_PLANNER_1, role: "client", venueId: VENUE_A }),
      makeUser({ id: USER_PLANNER_1, role: "planner", venueId: VENUE_A }),
      makeUser({ id: USER_PLANNER_1, role: "staff", venueId: VENUE_B }),
      makeUser({ id: USER_PLANNER_1, role: "admin", venueId: null }),
    ]) {
      expect(canAccessInternalEvent(user, VENUE_A)).toBe(false);
      // Personal configuration ownership remains an independent grant.
      expect(canAccessResource(user, USER_PLANNER_1, VENUE_A)).toBe(true);
    }
  });
});

describe("venue planning-data read policy", () => {
  it("admits each same-venue operational role", () => {
    for (const role of ["staff", "hallkeeper", "admin"] as const) {
      expect(canReadVenuePlanningData(makeUser({ role, venueId: VENUE_A }), VENUE_A))
        .toBe(true);
    }
  });

  it("admits platform admins independent of tenant assignment", () => {
    expect(canReadVenuePlanningData(
      makeUser({ role: "admin", platformRole: "admin", venueId: null }),
      VENUE_A,
    )).toBe(true);
    expect(canReadVenuePlanningData(
      makeUser({ role: "admin", platformRole: "admin", venueId: VENUE_B }),
      VENUE_A,
    )).toBe(true);
  });

  it("fails closed for clients, unknown roles, null venues, and cross-venue actors", () => {
    expect(canReadVenuePlanningData(makeUser({ role: "planner", venueId: VENUE_A }), VENUE_A))
      .toBe(false);
    expect(canReadVenuePlanningData(makeUser({ role: "client", venueId: VENUE_A }), VENUE_A))
      .toBe(false);
    expect(canReadVenuePlanningData(makeUser({ role: "future_role", venueId: VENUE_A }), VENUE_A))
      .toBe(false);
    expect(canReadVenuePlanningData(makeUser({ role: "planner", venueId: null }), VENUE_A))
      .toBe(false);
    expect(canReadVenuePlanningData(makeUser({ role: "planner", venueId: VENUE_B }), VENUE_A))
      .toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Capability helpers — canAdministerVenue / canManageCommercial /
// canReadInventory / canWriteInventory
//
// One definition per capability, imported by every route that gates on it.
// The matrix these pin down (goal 18 §2 line 25, §6 decisions 6a and 6b):
//
//   | role at venue A | administer | commercial | inv. read | inv. write |
//   |-----------------|------------|------------|-----------|------------|
//   | platform admin  | true       | true       | true      | true       |
//   | admin           | true       | true       | true      | true       |
//   | manager         | true       | true       | true      | true       |
//   | staff           | true       | true       | true      | FALSE      |
//   | sales           | FALSE      | true       | FALSE     | FALSE      |
//   | hallkeeper      | FALSE      | FALSE      | true      | FALSE      |
//   | planner         | FALSE      | FALSE      | true      | FALSE      |
//   | caterer         | FALSE      | FALSE      | FALSE     | FALSE      |
//   | client          | FALSE      | FALSE      | FALSE     | FALSE      |
//
// Every capability is venue-scoped: the same role at venue B is false for
// venue A, and a null venueId is false everywhere.
// ---------------------------------------------------------------------------

interface CapabilityCase {
  readonly name: string;
  readonly fn: (user: JwtUser, venueId: string) => boolean;
  readonly allowed: readonly string[];
  readonly denied: readonly string[];
}

const CAPABILITIES: readonly CapabilityCase[] = [
  { name: "canAdministerVenue", fn: canAdministerVenue,
    allowed: ["admin", "manager", "staff"],
    denied: ["sales", "hallkeeper", "planner", "caterer", "client", "future_role"] },
  { name: "canManageCommercial", fn: canManageCommercial,
    allowed: ["admin", "manager", "staff", "sales"],
    denied: ["hallkeeper", "planner", "caterer", "client", "future_role"] },
  { name: "canReadInventory", fn: canReadInventory,
    allowed: ["admin", "manager", "staff", "hallkeeper", "planner"],
    denied: ["sales", "caterer", "client", "future_role"] },
  { name: "canWriteInventory", fn: canWriteInventory,
    allowed: ["admin", "manager"],
    denied: ["staff", "sales", "hallkeeper", "planner", "caterer", "client", "future_role"] },
];

describe.each(CAPABILITIES)("$name", ({ fn, allowed, denied }) => {
  it("admits a platform admin for any venue, whatever their own venueId", () => {
    expect(fn(makeUser({ role: "client", platformRole: "admin", venueId: null }), VENUE_A)).toBe(true);
    expect(fn(makeUser({ role: "client", platformRole: "admin", venueId: VENUE_B }), VENUE_A)).toBe(true);
  });

  it.each(allowed)("admits %s at that venue", (role) => {
    expect(fn(makeUser({ role, venueId: VENUE_A }), VENUE_A)).toBe(true);
  });

  it.each(allowed)("refuses %s for another venue and with no venue", (role) => {
    expect(fn(makeUser({ role, venueId: VENUE_B }), VENUE_A)).toBe(false);
    expect(fn(makeUser({ role, venueId: null }), VENUE_A)).toBe(false);
  });

  it.each(denied)("refuses %s even at that venue", (role) => {
    expect(fn(makeUser({ role, venueId: VENUE_A }), VENUE_A)).toBe(false);
  });
});

describe("capability helpers as a set", () => {
  it("keeps hallkeepers off venue, space and pricing edit while leaving room-state read intact", () => {
    const hallkeeper = makeUser({ role: "hallkeeper", venueId: VENUE_A });
    expect(canAdministerVenue(hallkeeper, VENUE_A)).toBe(false);
    expect(canManageCommercial(hallkeeper, VENUE_A)).toBe(false);
    expect(canReadInventory(hallkeeper, VENUE_A)).toBe(true);
    expect(canWriteInventory(hallkeeper, VENUE_A)).toBe(false);
    expect(canManageVenue(hallkeeper, VENUE_A)).toBe(true);
  });

  it("gives a venue admin the commercial surface its own staff has", () => {
    const venueAdmin = makeUser({ role: "admin", venueId: VENUE_A });
    const venueStaff = makeUser({ role: "staff", venueId: VENUE_A });
    expect(canManageCommercial(venueStaff, VENUE_A)).toBe(true);
    expect(canManageCommercial(venueAdmin, VENUE_A)).toBe(true);
  });

  it("keeps caterers out of every venue-wide capability", () => {
    const caterer = makeUser({ role: "caterer", venueId: VENUE_A });
    expect(canAdministerVenue(caterer, VENUE_A)).toBe(false);
    expect(canManageCommercial(caterer, VENUE_A)).toBe(false);
    expect(canReadInventory(caterer, VENUE_A)).toBe(false);
    expect(canWriteInventory(caterer, VENUE_A)).toBe(false);
    expect(canManageVenue(caterer, VENUE_A)).toBe(false);
  });
});
