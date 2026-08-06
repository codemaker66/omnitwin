import { describe, it, expect } from "vitest";
import { canAccessResource, canManageVenue, canWriteEvents, isEventWriteRole } from "../../utils/query.js";
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

// ---------------------------------------------------------------------------
// isEventWriteRole + canWriteEvents (T-540)
//
// Event writes are a narrower surface than event reads. `canAccessResource`
// answers "may this user SEE the event", and its ownership branch grants
// access to whoever created the row — which is the right question for a read
// and the wrong one for a write: a user whose venueId later changes would
// keep writing to their previous venue's events forever.
//
// So writes ask a different question: are you staff/admin AT THIS VENUE.
// The split mirrors the diary's DIARY_WRITE_ROLES policy, where hallkeeper is
// a read-facing ops role. Divergence from `canWriteBookings` (deliberate):
// platform admins keep the global escape hatch that `canManageVenue` already
// grants them everywhere else in events.ts.
//
//   | actor           | venue match | canWriteEvents |
//   |-----------------|-------------|----------------|
//   | platform admin  | -           | true           |
//   | admin@A         | A           | true           |
//   | admin@A         | B           | FALSE          |
//   | staff@A         | A           | true           |
//   | staff@A         | B           | FALSE          |
//   | hallkeeper@A    | A           | FALSE          |
//   | planner@A       | A           | FALSE          |
//   | client@A        | A           | FALSE          |
// ---------------------------------------------------------------------------

describe("isEventWriteRole", () => {
  it("admits staff and admin", () => {
    expect(isEventWriteRole(makeUser({ role: "staff", venueId: VENUE_A }))).toBe(true);
    expect(isEventWriteRole(makeUser({ role: "admin", venueId: VENUE_A }))).toBe(true);
  });

  it("refuses hallkeeper — a read-facing ops role on the event surface", () => {
    expect(isEventWriteRole(makeUser({ role: "hallkeeper", venueId: VENUE_A }))).toBe(false);
  });

  it("refuses planner and client", () => {
    expect(isEventWriteRole(makeUser({ role: "planner", venueId: VENUE_A }))).toBe(false);
    expect(isEventWriteRole(makeUser({ role: "client", venueId: VENUE_A }))).toBe(false);
  });

  it("admits a platform admin whatever their venue role reads", () => {
    expect(isEventWriteRole(makeUser({ role: "planner", platformRole: "admin", venueId: null }))).toBe(true);
  });

  it("is venue-blind — it answers role only, so routes can gate before a row load", () => {
    // The whole point of the split: a route can refuse a hallkeeper without
    // paying for the SELECT that would tell it which venue the event is in.
    expect(isEventWriteRole(makeUser({ role: "staff", venueId: null }))).toBe(true);
  });
});

describe("canWriteEvents", () => {
  it("staff at venue A can write venue A events", () => {
    expect(canWriteEvents(makeUser({ role: "staff", venueId: VENUE_A }), VENUE_A)).toBe(true);
  });

  it("admin at venue A can write venue A events", () => {
    expect(canWriteEvents(makeUser({ role: "admin", venueId: VENUE_A }), VENUE_A)).toBe(true);
  });

  it("staff at venue A CANNOT write venue B events (the tenant-isolation guard)", () => {
    expect(canWriteEvents(makeUser({ role: "staff", venueId: VENUE_A }), VENUE_B)).toBe(false);
  });

  it("admin at venue A CANNOT write venue B events", () => {
    expect(canWriteEvents(makeUser({ role: "admin", venueId: VENUE_A }), VENUE_B)).toBe(false);
  });

  it("hallkeeper at venue A CANNOT write venue A events, though they may read them", () => {
    const keeper = makeUser({ role: "hallkeeper", venueId: VENUE_A });
    expect(canWriteEvents(keeper, VENUE_A)).toBe(false);
    // The read gate is unchanged — this is the line the split protects.
    expect(canManageVenue(keeper, VENUE_A)).toBe(true);
  });

  it("planner and client cannot write events even at their own venue", () => {
    expect(canWriteEvents(makeUser({ role: "planner", venueId: VENUE_A }), VENUE_A)).toBe(false);
    expect(canWriteEvents(makeUser({ role: "client", venueId: VENUE_A }), VENUE_A)).toBe(false);
  });

  it("staff with no venueId cannot write any venue's events", () => {
    expect(canWriteEvents(makeUser({ role: "staff", venueId: null }), VENUE_A)).toBe(false);
  });

  it("platform admin can write any venue's events", () => {
    expect(canWriteEvents(makeUser({ role: "admin", platformRole: "admin", venueId: null }), VENUE_A)).toBe(true);
    expect(canWriteEvents(makeUser({ role: "admin", platformRole: "admin", venueId: VENUE_B }), VENUE_A)).toBe(true);
  });

  it("grants no one that canManageVenue would refuse — writes are a subset of manage", () => {
    // Guards against the gate ever widening by accident: every actor that can
    // write must also pass the venue-manage check the read paths use.
    const actors = [
      makeUser({ role: "staff", venueId: VENUE_A }),
      makeUser({ role: "admin", venueId: VENUE_A }),
      makeUser({ role: "hallkeeper", venueId: VENUE_A }),
      makeUser({ role: "planner", venueId: VENUE_A }),
      makeUser({ role: "client", venueId: VENUE_A }),
      makeUser({ role: "staff", venueId: VENUE_B }),
      makeUser({ role: "admin", platformRole: "admin", venueId: null }),
    ];
    for (const actor of actors) {
      if (canWriteEvents(actor, VENUE_A)) {
        expect(canManageVenue(actor, VENUE_A), `${actor.role}/${String(actor.venueId)}`).toBe(true);
      }
    }
  });
});
