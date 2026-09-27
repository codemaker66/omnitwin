import { describe, expect, it } from "vitest";
import { USER_ROLES } from "@omnitwin/types";
import { rotaAccess } from "../routes/rota.js";
import { isVenueTeamRole, rotaActionPath, rotaShiftLine } from "../services/rota.js";
import { canAdministerVenue, canManageCommercial, canManageVenue } from "../utils/query.js";

// ---------------------------------------------------------------------------
// Who reaches which part of the rota (T-637 slice B), read through the
// capability helpers rather than role lists, so a role added to a capability
// moves the rota with it.
// ---------------------------------------------------------------------------

const VENUE = "91111111-1111-4111-8111-111111111111";
const OTHER = "92222222-2222-4222-8222-222222222222";

describe("rota access", () => {
  it("follows the capability helpers for every role in the vocabulary", () => {
    for (const role of USER_ROLES) {
      const user = { role, venueId: VENUE, platformRole: "none" as const };
      const expected = canAdministerVenue(user, VENUE) ? "manage" : canManageVenue(user, VENUE) ? "read" : "own";
      expect(rotaAccess(user, VENUE), role).toBe(expected);
    }
    expect(rotaAccess({ role: "admin", venueId: VENUE, platformRole: "none" }, VENUE)).toBe("manage");
    expect(rotaAccess({ role: "hallkeeper", venueId: VENUE, platformRole: "none" }, VENUE)).toBe("read");
    expect(rotaAccess({ role: "sales", venueId: VENUE, platformRole: "none" }, VENUE)).toBe("own");
  });

  it("gives nothing at another venue, and a platform administrator the whole rota", () => {
    for (const role of USER_ROLES) {
      expect(rotaAccess({ role, venueId: OTHER, platformRole: "none" }, VENUE), role).toBeNull();
    }
    expect(rotaAccess({ role: "planner", venueId: null, platformRole: "admin" }, VENUE)).toBe("manage");
  });

  it("links and sends to the Rota view only the venue's own team", () => {
    for (const role of USER_ROLES) {
      const member = { role, venueId: VENUE, platformRole: "none" as const };
      expect(isVenueTeamRole(role, VENUE, VENUE), role).toBe(canManageVenue(member, VENUE) || canManageCommercial(member, VENUE));
      expect(isVenueTeamRole(role, OTHER, VENUE), role).toBe(false);
    }
    expect(isVenueTeamRole("sales", VENUE, VENUE)).toBe(true);
    expect(isVenueTeamRole("planner", VENUE, VENUE)).toBe(false);
    expect(isVenueTeamRole("caterer", VENUE, VENUE)).toBe(false);
  });
});

describe("rota notification words", () => {
  it("says a shift on the venue's clock, in plain words", () => {
    const shift = { role: "setup" as const, startsAt: new Date("2026-10-10T07:00:00Z"), endsAt: new Date("2026-10-10T15:00:00Z") };
    expect(rotaShiftLine(shift, "Grand Hall", "Europe/London")).toBe("Saturday 10 October, 08:00 to 16:00, set-up, Grand Hall");
    expect(rotaShiftLine({ ...shift, role: "first_aid" }, null, "Europe/London")).toBe("Saturday 10 October, 08:00 to 16:00, first-aid cover");
    expect(rotaActionPath("2026-10-05")).toBe("/dashboard?view=rota&week=2026-10-05");
  });
});
