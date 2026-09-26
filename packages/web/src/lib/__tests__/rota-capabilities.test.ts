import { describe, expect, it } from "vitest";
import { USER_ROLES } from "@omnitwin/types";
import {
  COMMERCIAL_ROLES,
  ROTA_MANAGE_ROLES,
  ROTA_READ_ROLES,
  ROTA_TAB_ROLES,
  VENUE_ADMIN_ROLES,
  VENUE_FLOOR_ROLES,
  hasRole,
} from "../role-capabilities.js";
import { NAV_ITEMS, canShowNavItem } from "../../components/dashboard/DashboardLayout.js";
import { canOpenDashboardView } from "../../pages/DashboardPage.js";

// ---------------------------------------------------------------------------
// The rota's drift guard (T-637 slice B). routes/rota.ts answers three ways:
// canAdministerVenue manages the rota, canManageVenue reads the published
// week, and anyone else in the venue's team (isVenueTeamRole: the floor and
// the commercial side) sees their own shifts. The web mirrors each gate, and
// offers the Rota tab exactly where the dashboard then opens it.
// packages/api/src/__tests__/rota-access.test.ts pins the API's side of the
// same matrix.
// ---------------------------------------------------------------------------

const ALL_ROLES: readonly (string | null)[] = [...USER_ROLES, "executive", "supplier", "future_role", null];

describe("the rota's capability block", () => {
  it("mirrors the three gates of routes/rota.ts", () => {
    expect([...ROTA_MANAGE_ROLES]).toEqual(["admin", "manager", "staff"]);
    expect(ROTA_MANAGE_ROLES).toBe(VENUE_ADMIN_ROLES);
    expect([...ROTA_READ_ROLES]).toEqual(["admin", "manager", "staff", "hallkeeper"]);
    expect(ROTA_READ_ROLES).toBe(VENUE_FLOOR_ROLES);
    expect([...ROTA_TAB_ROLES].sort()).toEqual(["admin", "hallkeeper", "manager", "sales", "staff"]);
    for (const role of USER_ROLES) {
      expect(hasRole(ROTA_TAB_ROLES, role), role).toBe(hasRole(VENUE_FLOOR_ROLES, role) || hasRole(COMMERCIAL_ROLES, role));
    }
  });

  it("offers the tab to everyone who manages or reads the week", () => {
    for (const role of ROTA_MANAGE_ROLES) expect(hasRole(ROTA_READ_ROLES, role), role).toBe(true);
    for (const role of ROTA_READ_ROLES) expect(hasRole(ROTA_TAB_ROLES, role), role).toBe(true);
  });

  it("keeps customers and caterers away from the rota", () => {
    for (const role of ["client", "planner", "caterer"]) {
      expect(hasRole(ROTA_TAB_ROLES, role), role).toBe(false);
      expect(canOpenDashboardView("rota", role, "none"), role).toBe(false);
    }
    expect(hasRole(ROTA_READ_ROLES, "sales")).toBe(false);
    expect(hasRole(ROTA_MANAGE_ROLES, "hallkeeper")).toBe(false);
  });

  it("admits no role outside the vocabulary", () => {
    const vocabulary = new Set<string>(USER_ROLES);
    for (const role of [...ROTA_MANAGE_ROLES, ...ROTA_READ_ROLES, ...ROTA_TAB_ROLES]) {
      expect(vocabulary.has(role), `${role} is not in USER_ROLES`).toBe(true);
    }
  });
});

describe("the Rota tab is offered exactly where it opens", () => {
  it("opens the Rota view for exactly the rota's team roles", () => {
    for (const role of USER_ROLES) {
      expect(canOpenDashboardView("rota", role, "none"), `rota for ${role}`).toBe(hasRole(ROTA_TAB_ROLES, role));
    }
  });

  it("never offers the Rota tab that the dashboard then refuses, nor hides one it opens", () => {
    const rota = NAV_ITEMS.find((item) => item.view === "rota");
    expect(rota?.label).toBe("Rota");
    if (rota === undefined) return;
    for (const role of ALL_ROLES) {
      for (const platformRole of ["none", "admin"] as const) {
        expect(canShowNavItem(rota, role, platformRole), `${String(role)} (platformRole ${platformRole})`)
          .toBe(canOpenDashboardView("rota", role, platformRole));
      }
    }
  });
});
