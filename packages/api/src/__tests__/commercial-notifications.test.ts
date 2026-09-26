import { describe, expect, it } from "vitest";
import { USER_ROLES } from "@omnitwin/types";
import { COMMERCIAL_AUDIENCE_ROLES } from "../services/commercial-notifications.js";
import { canManageCommercial } from "../utils/query.js";

// ---------------------------------------------------------------------------
// Who hears about a new enquiry or a client's proposal decision must be
// exactly who can act on it. The list once named staff, admin and sales, so a
// manager, who owns the pipeline, was never told a new enquiry had arrived.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";

describe("the commercial audience", () => {
  it("is every role that works the pipeline, and no other", () => {
    for (const role of USER_ROLES) {
      const worksPipeline = canManageCommercial({ role, venueId: VENUE, platformRole: "none" }, VENUE);
      expect(COMMERCIAL_AUDIENCE_ROLES.includes(role), role).toBe(worksPipeline);
    }
  });
});
