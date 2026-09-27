import { describe, expect, it } from "vitest";
import { USER_ROLES } from "@omnitwin/types";
import {
  ANALYTICS_ROLES,
  CLIENT_SEARCH_ROLES,
  COMMERCIAL_ROLES,
  CRM_PIPELINE_ROLES,
  DIARY_ROLES,
  DIARY_WRITE_ROLES,
  EVENT_WRITE_ROLES,
  INVENTORY_WRITE_ROLES,
  PLANNER_ROLES,
  REVIEW_QUEUE_ROLES,
  VENUE_DAY_ROLES,
  VENUE_FLOOR_ROLES,
  WORKSPACE_ROLES,
  hasRole,
} from "../role-capabilities.js";
import { NAV_ITEMS, canShowNavItem } from "../../components/dashboard/DashboardLayout.js";
import { canOpenDashboardView } from "../../pages/DashboardPage.js";
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

  it("offers the Clients desk only to the roles /clients admits", () => {
    // routes/clients.ts gates its search and lists on canManageVenue, so
    // sales and planner were being offered a tab that answers 403.
    expect([...CLIENT_SEARCH_ROLES]).toEqual(["admin", "manager", "staff", "hallkeeper"]);
    for (const role of USER_ROLES) {
      expect(canOpenDashboardView("search", role, "none"), `search for ${role}`)
        .toBe(hasRole(VENUE_FLOOR_ROLES, role));
    }
    expect(canOpenDashboardView("search", "sales", "none")).toBe(false);
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
    }
  });

  it("keeps the diary and the hallkeeper day as separate gates", () => {
    // One boolean for both is what offered sales a Hallkeeper link that
    // /hallkeeper/today refuses.
    expect(hasRole(DIARY_ROLES, "sales")).toBe(true);
    expect(hasRole(VENUE_DAY_ROLES, "sales")).toBe(false);
  });

  it("offers Diary writes to exactly the roles booking-mutations.ts DIARY_WRITE_ROLES admits", () => {
    // A manager or sales member was shown a read-only Diary the API would
    // have let them write; a hallkeeper must never be offered a write.
    expect([...DIARY_WRITE_ROLES]).toEqual(["admin", "manager", "staff", "sales"]);
    for (const role of DIARY_WRITE_ROLES) expect(hasRole(DIARY_ROLES, role), `${role} writes what it can read`).toBe(true);
    expect(hasRole(DIARY_WRITE_ROLES, "hallkeeper")).toBe(false);
  });

  it("mirrors the API's canAccessInternalEvent for internal event readers", () => {
    for (const role of USER_ROLES) {
      const allowed = canReadInternalEventData({
        isLoading: false,
        isAuthenticated: true,
        user: { role, platformRole: "none" },
      });
      expect(allowed, `canReadInternalEventData for ${role}`).toBe(hasRole(VENUE_FLOOR_ROLES, role));
    }
  });

  it("refuses an unresolved identity before any role check", () => {
    for (const auth of [
      { isLoading: true, isAuthenticated: true, user: { role: "admin", platformRole: "none" as const } },
      { isLoading: false, isAuthenticated: false, user: { role: "admin", platformRole: "none" as const } },
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
      EVENT_WRITE_ROLES, DIARY_WRITE_ROLES,
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
      EVENT_WRITE_ROLES, DIARY_WRITE_ROLES,
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
