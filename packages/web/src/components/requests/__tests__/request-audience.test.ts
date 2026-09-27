import { describe, expect, it } from "vitest";
import { STAFF_AUDIENCE_ROLES } from "@omnitwin/types";
import { VENUE_DAY_ROLES } from "../../../lib/role-capabilities.js";

// A request's slab lives on the Day Board and its inbox copy links there.
// Everyone a request is written for must be able to open that page, and
// nobody the page admits may be left out of the room's requests.
describe("who a request is for", () => {
  it("is exactly the roles the Day Board admits", () => {
    expect([...STAFF_AUDIENCE_ROLES].sort()).toEqual([...VENUE_DAY_ROLES].sort());
  });
});
