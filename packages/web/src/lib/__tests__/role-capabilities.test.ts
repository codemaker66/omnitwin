import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { INVENTORY_ADJUSTER_ROLES, USER_ROLES, VENUE_TEAM_INVITER_ROLES } from "@omnitwin/types";
import {
  ANALYTICS_ROLES,
  CLIENT_SEARCH_ROLES,
  CLIENT_SIDE_ROLES,
  COMMERCIAL_ROLES,
  CRM_PIPELINE_ROLES,
  DIARY_ROLES,
  DIARY_WRITE_ROLES,
  EVENT_WRITE_ROLES,
  INVENTORY_WRITE_ROLES,
  PLANNER_ROLES,
  PRICING_READ_ROLES,
  PRICING_WRITE_ROLES,
  REVIEW_QUEUE_ROLES,
  TEAM_TAB_ROLES,
  VENUE_DAY_ROLES,
  VENUE_FLOOR_ROLES,
  VENUE_MEMBER_ROLES,
  WORKSPACE_ROLES,
  awaitsVenue,
  canDraftWithAI,
  diaryVenueOf,
  hasRole,
  opensDiary,
} from "../role-capabilities.js";
import { NAV_ITEMS, canShowNavItem } from "../../components/dashboard/DashboardLayout.js";
import { canOpenDashboardView, dashboardViewFromSearchValue } from "../../pages/DashboardPage.js";
import { getDefaultRoute } from "../role-routing.js";
import { canReadInternalEventData } from "../event-access.js";

// ---------------------------------------------------------------------------
// The drift guard (goal 18 §2 line 25, review finding I9)
//
// The web used to keep this matrix in five places, and four had drifted apart:
// the Hallkeeper link was offered to sales and /hallkeeper/today refused it;
// the Event Architect link was offered to manager and its guard refused it.
// Both are the same bug — a navigation offer the surface behind it denies.
//
// The rule enforced here: nothing is OFFERED that the thing behind it refuses.
// ---------------------------------------------------------------------------

/** Every role in the vocabulary, plus the shapes a stale token can take. */
const ALL_ROLES: readonly (string | null)[] = [...USER_ROLES, "executive", "supplier", "future_role", null];

describe("nav offers are reachable", () => {
  it("never offers a dashboard tab that canOpenDashboardView then refuses", () => {
    for (const role of ALL_ROLES) {
      for (const platformRole of ["none", "admin"] as const) {
        for (const item of NAV_ITEMS) {
          if (!canShowNavItem(item, role, platformRole)) continue;
          expect(
            canOpenDashboardView(item.view, role, platformRole),
            `${String(role)} (platformRole ${platformRole}) was offered "${item.label}" but cannot open it`,
          ).toBe(true);
        }
      }
    }
  });

  it("offers the Pipeline tab to exactly the roles routes/crm.ts admits", () => {
    // crm.ts and opportunities.ts gate on canManageCommercial, so the venue's
    // own admin, manager and sales work the pipeline alongside staff, and the
    // hallkeeper, planner, client and caterer are not offered a tab that
    // would answer 403.
    expect([...CRM_PIPELINE_ROLES]).toEqual([...COMMERCIAL_ROLES]);
    for (const role of USER_ROLES) {
      expect(canOpenDashboardView("pipeline", role, "none"), `pipeline for ${role}`)
        .toBe(hasRole(COMMERCIAL_ROLES, role));
    }
    expect(canOpenDashboardView("pipeline", "admin", "none")).toBe(true);
    expect(canOpenDashboardView("pipeline", "sales", "none")).toBe(true);
    expect(canOpenDashboardView("pipeline", "hallkeeper", "none")).toBe(false);
  });

  it("offers Proposals to the whole commercial set, because /proposals admits it", () => {
    for (const role of USER_ROLES) {
      expect(canOpenDashboardView("proposals", role, "none"), `proposals for ${role}`)
        .toBe(hasRole(COMMERCIAL_ROLES, role));
    }
  });

  it("offers Analytics to exactly the roles /analytics/venue-dashboard admits", () => {
    // routes/revenue-analytics.ts gates the venue-dashboard payload on
    // canManageCommercial — admin, manager, staff, sales — and refuses the
    // hallkeeper, the priced half of decision 6b.
    expect([...ANALYTICS_ROLES]).toEqual([...COMMERCIAL_ROLES]);
    for (const role of USER_ROLES) {
      expect(canOpenDashboardView("analytics", role, "none"), `analytics for ${role}`)
        .toBe(hasRole(COMMERCIAL_ROLES, role));
    }
    expect(canOpenDashboardView("analytics", "hallkeeper", "none")).toBe(false);
    expect(canOpenDashboardView("analytics", "sales", "none")).toBe(true);
  });

  it("offers the Pricing desk to the commercial team that /pricing-desk admits, and never the hallkeeper", () => {
    // routes/pricing-desk.ts reads the list with canManageCommercial; the
    // hallkeeper does not see prices (decision 6b). Who may change a price
    // is the one list the API's canWritePricing reads.
    expect([...PRICING_READ_ROLES]).toEqual([...COMMERCIAL_ROLES]);
    expect([...PRICING_WRITE_ROLES]).toEqual(["admin", "manager"]);
    for (const role of USER_ROLES) {
      expect(canOpenDashboardView("pricing", role, "none"), `pricing for ${role}`)
        .toBe(hasRole(COMMERCIAL_ROLES, role));
    }
    expect(canOpenDashboardView("pricing", "hallkeeper", "none")).toBe(false);
    expect(canOpenDashboardView("pricing", "sales", "none")).toBe(true);
    const pricingItem = NAV_ITEMS.find((item) => item.view === "pricing");
    expect(pricingItem?.label).toBe("Pricing");
    if (pricingItem === undefined) throw new Error("Pricing tab missing");
    expect(canShowNavItem(pricingItem, "hallkeeper", "none")).toBe(false);
    expect(canShowNavItem(pricingItem, "manager", "none")).toBe(true);
  });

  it("offers the Clients desk to the roles /clients admits, sales included", () => {
    // routes/clients.ts gates on canReadClients: the venue floor and the commercial team (People Book design §6.7).
    expect([...CLIENT_SEARCH_ROLES]).toEqual(["admin", "manager", "staff", "hallkeeper", "sales"]);
    for (const role of USER_ROLES) {
      expect(canOpenDashboardView("search", role, "none"), `search for ${role}`)
        .toBe(hasRole(VENUE_FLOOR_ROLES, role) || hasRole(COMMERCIAL_ROLES, role));
    }
    expect(canOpenDashboardView("search", "sales", "none")).toBe(true);
    expect(canOpenDashboardView("search", "planner", "none")).toBe(false);
  });

  it("offers Pending reviews only to the roles the review queue admits", () => {
    // GET /configurations/reviews/pending now takes its role set from the
    // review state machine itself (VENUE_REVIEW_ROLES: staff, manager,
    // admin), so approving and listing are one gate.
    expect([...REVIEW_QUEUE_ROLES]).toEqual(["admin", "manager", "staff"]);
    for (const role of USER_ROLES) {
      expect(canOpenDashboardView("reviews", role, "none"), `reviews for ${role}`)
        .toBe(hasRole(REVIEW_QUEUE_ROLES, role));
    }
    for (const role of ["hallkeeper", "planner", "sales", "client"]) {
      expect(canOpenDashboardView("reviews", role, "none"), `reviews for ${role}`).toBe(false);
    }
  });

  it("offers venue stock only to the roles canWriteInventory admits", () => {
    for (const role of USER_ROLES) {
      expect(canOpenDashboardView("inventory", role, "none"), `inventory for ${role}`)
        .toBe(hasRole(INVENTORY_WRITE_ROLES, role));
    }
  });

  it("offers inventory to exactly the roles the server lets keep it", () => {
    expect([...INVENTORY_WRITE_ROLES]).toEqual([...INVENTORY_ADJUSTER_ROLES]);
  });

  it("never lets a platform admin inherit venue stock authority", () => {
    // A Venviewer platform admin is not a member of any venue. Consolidating
    // these gates, an early `platformRole === "admin"` shortcut silently
    // granted them the Inventory tab at every venue; the order of the checks
    // is the whole guarantee, so pin it from both entry points.
    expect(canOpenDashboardView("inventory", "staff", "admin")).toBe(false);
    expect(canOpenDashboardView("inventory", "hallkeeper", "admin")).toBe(false);
    expect(canOpenDashboardView("inventory", "planner", "admin")).toBe(false);
    const stock = NAV_ITEMS.find((item) => item.view === "inventory");
    expect(stock).toBeDefined();
    if (stock !== undefined) {
      expect(canShowNavItem(stock, "staff", "admin")).toBe(false);
      expect(canShowNavItem(stock, "admin", "admin")).toBe(true);
    }
  });

  it("offers the Team tab to exactly the roles canManageVenueTeam admits", () => {
    // routes/venue-team.ts gates on canManageVenueTeam, which reads the one
    // list in @omnitwin/types (Blake, 24 October 2026: the venue's
    // administrators invite; managers and staff do not). A platform admin
    // passes that gate at any venue.
    expect(TEAM_TAB_ROLES).toBe(VENUE_TEAM_INVITER_ROLES);
    expect([...TEAM_TAB_ROLES]).toEqual(["admin"]);
    expect(dashboardViewFromSearchValue("team")).toBe("team");
    const team = NAV_ITEMS.find((item) => item.view === "team");
    expect(team?.label).toBe("Team");
    if (team === undefined) throw new Error("Team tab missing");

    for (const role of USER_ROLES) {
      expect(canOpenDashboardView("team", role, "none"), `team for ${role}`).toBe(role === "admin");
    }
    expect(canShowNavItem(team, "admin", "none")).toBe(true);
    for (const role of ["manager", "staff", "hallkeeper", "sales"]) {
      expect(canShowNavItem(team, role, "none"), `${role} is offered Team`).toBe(false);
      expect(canOpenDashboardView("team", role, "none"), `${role} opens Team`).toBe(false);
    }
    // A platform admin passes whatever its venue role; an operator does not.
    for (const role of ["admin", "manager", "staff"]) {
      expect(canShowNavItem(team, role, "admin"), `${role} as platform admin`).toBe(true);
    }
    expect(canShowNavItem(team, "staff", "operator")).toBe(false);

    // Offered exactly where it opens, for every role and platform role.
    for (const role of ALL_ROLES) {
      for (const platformRole of ["none", "operator", "admin"] as const) {
        expect(canShowNavItem(team, role, platformRole), `${String(role)} (platformRole ${platformRole})`)
          .toBe(canOpenDashboardView("team", role, platformRole));
      }
    }
  });

  it("hides the Event Architect entry for R1", () => {
    // Goal 18 §6 decision 8. The route survives; only the way in is closed.
    expect(NAV_ITEMS.some((item) => item.label.includes("Event Architect"))).toBe(false);
  });
});

describe("route gates and their landing surfaces agree", () => {
  it("sends every role to a route that role may open", () => {
    for (const role of USER_ROLES) {
      const route = getDefaultRoute(role);
      if (route === "/dashboard") {
        expect(hasRole(WORKSPACE_ROLES, role), `${role} lands on /dashboard`).toBe(true);
      }
      if (route === "/hallkeeper/today") {
        expect(hasRole(VENUE_DAY_ROLES, role), `${role} lands on the Day Board`).toBe(true);
      }
      if (route === "/events") {
        // The /events route admits exactly the client's side (router.tsx).
        expect(hasRole(CLIENT_SIDE_ROLES, role), `${role} lands on the client's home`).toBe(true);
      }
    }
  });

  it("keeps the diary and the hallkeeper day as separate gates", () => {
    // One boolean for both is what offered sales a Hallkeeper link that
    // /hallkeeper/today refuses.
    expect(hasRole(DIARY_ROLES, "sales")).toBe(true);
    expect(hasRole(VENUE_DAY_ROLES, "sales")).toBe(false);
  });

  it("offers Diary writes to exactly the roles booking-mutations.ts DIARY_WRITE_ROLES admits", () => {
    // Since goal 19 D2 (10 October 2026) only the office inks a time: a
    // manager or sales member reads the Diary the API would refuse them to
    // write; a hallkeeper must never be offered a write.
    expect([...DIARY_WRITE_ROLES]).toEqual(["admin", "staff"]);
    for (const role of DIARY_WRITE_ROLES) expect(hasRole(DIARY_ROLES, role), `${role} writes what it can read`).toBe(true);
    expect(hasRole(DIARY_WRITE_ROLES, "hallkeeper")).toBe(false);
  });

  it("mirrors the API's canAccessInternalEvent for internal event readers", () => {
    for (const role of USER_ROLES) {
      const allowed = canReadInternalEventData({
        isLoading: false,
        isAuthenticated: true,
        user: { role, platformRole: "none", venueId: "venue-1" },
      });
      expect(allowed, `canReadInternalEventData for ${role}`).toBe(hasRole(VENUE_FLOOR_ROLES, role));
    }
  });

  it("mounts no internal reader for an account not connected to a venue, which the API refuses", () => {
    for (const role of VENUE_FLOOR_ROLES) {
      expect(canReadInternalEventData({ isLoading: false, isAuthenticated: true, user: { role, platformRole: "none", venueId: null } }), role)
        .toBe(false);
    }
    // A platform admin reads every venue's events with no venue of its own.
    expect(canReadInternalEventData({ isLoading: false, isAuthenticated: true, user: { role: "admin", platformRole: "admin", venueId: null } }))
      .toBe(true);
  });

  it("refuses an unresolved identity before any role check", () => {
    for (const auth of [
      { isLoading: true, isAuthenticated: true, user: { role: "admin", platformRole: "none" as const, venueId: "venue-1" } },
      { isLoading: false, isAuthenticated: false, user: { role: "admin", platformRole: "none" as const, venueId: "venue-1" } },
      { isLoading: false, isAuthenticated: true, user: null },
    ]) {
      expect(canReadInternalEventData(auth)).toBe(false);
    }
  });
});

describe("the capability sets themselves", () => {
  it("keeps every administering role on the venue floor", () => {
    for (const role of ["admin", "manager", "staff"]) {
      expect(hasRole(VENUE_FLOOR_ROLES, role), `${role} on the floor`).toBe(true);
    }
  });

  it("keeps caterers out of every venue-wide set", () => {
    for (const set of [
      VENUE_FLOOR_ROLES, COMMERCIAL_ROLES, INVENTORY_WRITE_ROLES,
      DIARY_ROLES, VENUE_DAY_ROLES, PLANNER_ROLES, WORKSPACE_ROLES,
      ANALYTICS_ROLES, CLIENT_SEARCH_ROLES, REVIEW_QUEUE_ROLES,
      EVENT_WRITE_ROLES, DIARY_WRITE_ROLES, TEAM_TAB_ROLES,
    ]) {
      expect(hasRole(set, "caterer")).toBe(false);
    }
  });

  it("admits no role outside the vocabulary", () => {
    const vocabulary = new Set<string>(USER_ROLES);
    for (const set of [
      VENUE_FLOOR_ROLES, COMMERCIAL_ROLES, INVENTORY_WRITE_ROLES, DIARY_ROLES,
      VENUE_DAY_ROLES, PLANNER_ROLES, WORKSPACE_ROLES, CRM_PIPELINE_ROLES,
      ANALYTICS_ROLES, CLIENT_SEARCH_ROLES, REVIEW_QUEUE_ROLES,
      EVENT_WRITE_ROLES, DIARY_WRITE_ROLES, TEAM_TAB_ROLES,
    ]) {
      for (const role of set) {
        expect(vocabulary.has(role), `${role} is not in USER_ROLES`).toBe(true);
      }
    }
  });

  it("lets every Diary writer read the Diary, and keeps the hallkeeper a reader", () => {
    // DIARY_WRITE_ROLES mirrors services/booking-mutations.ts; a writer who
    // could not open the board would hold half a job.
    for (const role of DIARY_WRITE_ROLES) expect(hasRole(DIARY_ROLES, role), role).toBe(true);
    expect(hasRole(DIARY_WRITE_ROLES, "hallkeeper")).toBe(false);
    // Event writers run the day; sales sells the room.
    expect([...EVENT_WRITE_ROLES]).toEqual(["admin", "manager", "staff"]);
  });

  it("treats a null or unknown role as no capability at all", () => {
    for (const set of [VENUE_FLOOR_ROLES, COMMERCIAL_ROLES, WORKSPACE_ROLES]) {
      expect(hasRole(set, null)).toBe(false);
      expect(hasRole(set, undefined)).toBe(false);
      expect(hasRole(set, "executive")).toBe(false);
      expect(hasRole(set, "supplier")).toBe(false);
    }
  });
});

// An account that works at a venue and is not connected to one yet: the API's
// venue gates (canManageVenue, canManageCommercial) refuse every read, so the
// dashboard tells it so. Only the venue's own roles wait for a venue.
describe("an account waiting for its venue", () => {
  const unplaced = { role: "staff", venueId: null, platformRole: "none" };

  it("is every venue role with no venue, and only those", () => {
    expect([...VENUE_MEMBER_ROLES].sort()).toEqual(["admin", "hallkeeper", "manager", "sales", "staff"]);
    for (const role of USER_ROLES) {
      expect(awaitsVenue({ ...unplaced, role }), role).toBe(hasRole(VENUE_MEMBER_ROLES, role));
    }
    // An operator is refused as anyone else is: the API's shortcut is the admin's alone.
    expect(awaitsVenue({ ...unplaced, platformRole: "operator" })).toBe(true);
  });

  it("is never an account with a venue, a platform admin, or nobody", () => {
    expect(awaitsVenue({ ...unplaced, venueId: "venue-1" })).toBe(false);
    expect(awaitsVenue({ ...unplaced, role: "admin", platformRole: "admin" })).toBe(false);
    expect(awaitsVenue(null)).toBe(false);
  });
});

// Whose Diary the staff desks read (Find's day answer, the Enquiries desk's
// Diary fact): never one the API's canReadDiary would refuse.
describe("the Diary a person reads from the desks", () => {
  const PLATFORM_ROLES = ["none", "operator", "admin"] as const;

  it("is their own venue for every Diary reader and a platform admin, and no one else's", () => {
    for (const role of USER_ROLES) {
      for (const platformRole of PLATFORM_ROLES) {
        const reads = platformRole === "admin" || hasRole(DIARY_ROLES, role);
        expect(diaryVenueOf({ role, venueId: "venue-1", platformRole }), `${role} ${platformRole}`).toBe(reads ? "venue-1" : null);
      }
    }
  });

  it("is no venue for an account without one, or for nobody", () => {
    for (const role of USER_ROLES) {
      for (const platformRole of PLATFORM_ROLES) {
        expect(diaryVenueOf({ role, venueId: null, platformRole }), `${role} ${platformRole}`).toBeNull();
      }
    }
    expect(diaryVenueOf(null)).toBeNull();
  });
});

// T-656: POST /ai/drafts charges a draft to the venue of the person asking,
// so it answers the venue's floor and commercial team (canManageVenue or
// canManageCommercial at their own venue) and refuses everyone else with
// 403. The panel is offered to exactly the people the API answers.
describe("who is offered the general AI draft panel", () => {
  const placed = { venueId: "venue-1", platformRole: "none" } as const;

  it("is the venue's own team, and never a customer or an event-scoped role", () => {
    for (const role of USER_ROLES) {
      expect(canDraftWithAI({ ...placed, role }), role).toBe(hasRole(VENUE_MEMBER_ROLES, role));
    }
    for (const role of ["planner", "client", "caterer"]) {
      expect(canDraftWithAI({ ...placed, role }), role).toBe(false);
    }
  });

  it("is nobody without a venue to charge, and a platform admin only through its venue", () => {
    expect(canDraftWithAI({ ...placed, role: "staff", venueId: null })).toBe(false);
    expect(canDraftWithAI({ role: "admin", venueId: null, platformRole: "admin" })).toBe(false);
    expect(canDraftWithAI({ role: "planner", venueId: "venue-1", platformRole: "admin" })).toBe(true);
    expect(canDraftWithAI({ ...placed, role: "planner", platformRole: "operator" })).toBe(false);
    expect(canDraftWithAI(null)).toBe(false);
  });
});

// The Diary page (/diary) is offered by the staff header and Find, and its
// route admits, by one rule: its readers, and a platform admin whatever its
// venue role, as GET /calendar's canReadDiary admits (canManageVenue passes a
// platform admin). The route used to check the role alone, so a platform admin
// holding a customer's role was offered the Diary and then refused it.
describe("who opens the Diary", () => {
  it("is every Diary reader, and a platform admin whatever its role, and nobody else", () => {
    for (const role of USER_ROLES) {
      for (const platformRole of ["none", "operator", "admin"] as const) {
        expect(opensDiary({ role, platformRole }), `${role} (platformRole ${platformRole})`)
          .toBe(platformRole === "admin" || hasRole(DIARY_ROLES, role));
      }
    }
    expect(opensDiary(null)).toBe(false);
    expect(opensDiary(undefined)).toBe(false);
  });

  it("is the rule the /diary route admits by, not a role list of its own", () => {
    const source = readFileSync(resolve("src/router.tsx"), "utf8");
    const route = /staffPage\("\/diary",[\s\S]*?<\/ProtectedRoute>\)/u.exec(source)?.[0] ?? "";
    expect(route).toContain("<ProtectedRoute admits={opensDiary}>");
    expect(route).not.toContain("allowedRoles");
  });
});
