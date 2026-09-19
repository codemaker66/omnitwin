import { describe, expect, it } from "vitest";
import { USER_ROLES } from "@omnitwin/types";
import {
  ANALYTICS_ROLES,
  CLIENT_SEARCH_ROLES,
  COMMERCIAL_ROLES,
  CRM_PIPELINE_ROLES,
  DIARY_ROLES,
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

  it("offers the Pipeline tab only to the roles routes/crm.ts still admits", () => {
    // Lane 7 has not landed: crm.ts and opportunities.ts read
    // `user.role === "staff"`. Until then a venue admin seeing a Pipeline tab
    // would be walking into a 403. When Lane 7 lands, widen CRM_PIPELINE_ROLES
    // to COMMERCIAL_ROLES and this expectation moves with it.
    for (const role of USER_ROLES) {
      expect(canOpenDashboardView("pipeline", role, "none"), `pipeline for ${role}`)
        .toBe(hasRole(CRM_PIPELINE_ROLES, role));
    }
  });

  it("offers Proposals to the whole commercial set, because /proposals admits it", () => {
    for (const role of USER_ROLES) {
      expect(canOpenDashboardView("proposals", role, "none"), `proposals for ${role}`)
        .toBe(hasRole(COMMERCIAL_ROLES, role));
    }
  });

  it("offers Analytics no wider than /analytics/venue-dashboard admits", () => {
    // Route truth at this head: routes/revenue-analytics.ts:313 gates the
    // venue-dashboard payload on canManageCommercial — admin, manager, staff,
    // sales — and refuses the hallkeeper, the priced half of decision 6b.
    // The offer is deliberately NARROWER: sales is held back until Lane 7's
    // #24 lands (see ANALYTICS_ROLES). Narrower is safe, wider is a dead end,
    // so the assertion is the subset, plus the two named cases.
    for (const role of USER_ROLES) {
      const offered = canOpenDashboardView("analytics", role, "none");
      expect(offered, `analytics for ${role}`).toBe(hasRole(ANALYTICS_ROLES, role));
      if (offered) {
        expect(hasRole(COMMERCIAL_ROLES, role), `${role} is admitted by the analytics route`).toBe(true);
      }
    }
    expect(canOpenDashboardView("analytics", "hallkeeper", "none")).toBe(false);
    expect(canOpenDashboardView("analytics", "sales", "none")).toBe(false);
    // The un-hide when #24 lands is ANALYTICS_ROLES = COMMERCIAL_ROLES, and
    // that is the only difference between the two.
    expect([...COMMERCIAL_ROLES].filter((role) => !hasRole(ANALYTICS_ROLES, role))).toEqual(["sales"]);
  });

  it("offers Client Search only to the roles /clients admits", () => {
    // routes/clients.ts:36,145,231,293 all gate on canManageVenue, so sales
    // and planner were being offered a tab that answers 403.
    expect([...CLIENT_SEARCH_ROLES]).toEqual(["admin", "manager", "staff", "hallkeeper"]);
    for (const role of USER_ROLES) {
      expect(canOpenDashboardView("search", role, "none"), `search for ${role}`)
        .toBe(hasRole(VENUE_FLOOR_ROLES, role));
    }
    expect(canOpenDashboardView("search", "sales", "none")).toBe(false);
    expect(canOpenDashboardView("search", "planner", "none")).toBe(false);
  });

  it("offers Pending Reviews only to the roles the review queue admits", () => {
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
    ]) {
      for (const role of set) {
        expect(vocabulary.has(role), `${role} is not in USER_ROLES`).toBe(true);
      }
    }
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
