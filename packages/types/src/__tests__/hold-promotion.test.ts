import { describe, expect, it } from "vitest";
import {
  PromotionDraftSchema,
  holdPromotionActionPath,
  promotedHoldFromActionPath,
} from "../hold-promotion.js";

const HOLD = "5f0d6c8e-2a4b-4c1d-9e3f-0a1b2c3d4e5f";

describe("the promotion notice's action path", () => {
  it("round-trips the day and the hold", () => {
    const path = holdPromotionActionPath("2030-06-15", HOLD);
    expect(path).toBe(`/diary?goto=2030-06-15&hold=${HOLD}`);
    expect(promotedHoldFromActionPath(path)).toBe(HOLD);
  });

  it("refuses to build a path from a malformed day or id", () => {
    expect(() => holdPromotionActionPath("15/06/2030", HOLD)).toThrow();
    expect(() => holdPromotionActionPath("2030-06-15", "not-an-id")).toThrow();
  });

  it("finds no hold in any other path", () => {
    expect(promotedHoldFromActionPath(null)).toBeNull();
    expect(promotedHoldFromActionPath("/dashboard?view=enquiries")).toBeNull();
    expect(promotedHoldFromActionPath("/diary?goto=2030-06-15")).toBeNull();
    expect(promotedHoldFromActionPath("/diary?hold=../../admin")).toBeNull();
    expect(promotedHoldFromActionPath(`/elsewhere?hold=${HOLD}`)).toBeNull();
  });
});

describe("PromotionDraftSchema", () => {
  it("accepts a draft with or without a recorded client", () => {
    const base = { bookingId: HOLD, subject: "Grand Hall, Saturday 15 June 2030", body: "Dear Jane,\n\n…" };
    expect(PromotionDraftSchema.parse({ ...base, to: null }).to).toBeNull();
    expect(PromotionDraftSchema.parse({
      ...base, to: { name: "Jane Example", email: "jane@example.test", source: "enquiry" },
    }).to?.source).toBe("enquiry");
  });

  it("refuses an address that is not an email", () => {
    expect(PromotionDraftSchema.safeParse({
      bookingId: HOLD, subject: "s", body: "b", to: { name: "Jane", email: "not an email", source: "enquiry" },
    }).success).toBe(false);
  });
});
