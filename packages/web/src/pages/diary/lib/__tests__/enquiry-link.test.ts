import { describe, expect, it } from "vitest";
import type { Enquiry } from "../../../../api/enquiries.js";
import { canHoldDateFor, convertSourceOf, diaryHoldHref, holdRefusal } from "../enquiry-link.js";

// ---------------------------------------------------------------------------
// Holding a date from the Enquiries desk (roadmap N6): the Diary's address
// for it, which enquiries may be held, and why the Diary refuses one.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";

function enquiry(fields: Partial<Enquiry> = {}): Enquiry {
  return {
    id: "00000000-0000-4000-8000-0000000000e1", venueId: VENUE, spaceId: "00000000-0000-4000-8000-0000000000a1",
    configurationId: null, userId: null, guestEmail: "elaine@example.test", guestPhone: null, guestName: null,
    state: "submitted", name: "Elaine Fraser", email: "elaine@example.test", preferredDate: "2027-05-14",
    eventType: "wedding", estimatedGuests: 120, message: null, source: "walkthrough", roomChosen: false,
    createdAt: "2026-09-27T09:00:00.000Z", updatedAt: "2026-09-27T09:00:00.000Z",
    ...fields,
  };
}

describe("diaryHoldHref", () => {
  it("opens the week of the date asked for, naming the enquiry", () => {
    expect(diaryHoldHref(enquiry())).toBe("/diary?date=2027-05-14&enquiry=00000000-0000-4000-8000-0000000000e1");
  });

  it("names only the enquiry when it asks for no date, or for one the Diary cannot read", () => {
    expect(diaryHoldHref(enquiry({ preferredDate: null }))).toBe("/diary?enquiry=00000000-0000-4000-8000-0000000000e1");
    expect(diaryHoldHref(enquiry({ preferredDate: "next spring" }))).toBe("/diary?enquiry=00000000-0000-4000-8000-0000000000e1");
  });
});

describe("canHoldDateFor", () => {
  it("offers a hold at every stage still going", () => {
    for (const state of ["submitted", "under_review", "approved"]) expect(canHoldDateFor(enquiry({ state })), state).toBe(true);
  });

  it("offers none once an enquiry is declined, withdrawn or closed, or for a request that asks for no date", () => {
    for (const state of ["rejected", "withdrawn", "archived"]) expect(canHoldDateFor(enquiry({ state })), state).toBe(false);
    expect(canHoldDateFor(enquiry({ eventType: "venue-access" }))).toBe(false);
    expect(canHoldDateFor(enquiry({ eventType: "venue-enquiry" }))).toBe(false);
  });
});

describe("holdRefusal", () => {
  it("holds an open enquiry at this venue", () => {
    expect(holdRefusal(enquiry({ state: "approved" }), VENUE)).toBeNull();
  });

  it("says why it holds no date, and that none was held", () => {
    expect(holdRefusal(enquiry(), "00000000-0000-4000-8000-000000000002"))
      .toBe("Elaine Fraser's enquiry is for another venue, so no date was held here.");
    expect(holdRefusal(enquiry({ eventType: "venue-access" }), VENUE))
      .toBe("Elaine Fraser did not ask for a date, so there is nothing to hold.");
    expect(holdRefusal(enquiry({ state: "rejected" }), VENUE)).toBe("Elaine Fraser's enquiry was declined, so no date was held.");
    expect(holdRefusal(enquiry({ state: "withdrawn" }), VENUE)).toBe("Elaine Fraser's enquiry was withdrawn, so no date was held.");
    expect(holdRefusal(enquiry({ state: "archived" }), VENUE)).toBe("Elaine Fraser's enquiry was closed, so no date was held.");
  });
});

describe("convertSourceOf", () => {
  it("carries whether the guest chose the room it is filed under", () => {
    expect(convertSourceOf(enquiry())).toEqual({
      id: "00000000-0000-4000-8000-0000000000e1", spaceId: "00000000-0000-4000-8000-0000000000a1", roomChosen: false,
      name: "Elaine Fraser", eventType: "wedding", preferredDate: "2027-05-14",
    });
  });
});
