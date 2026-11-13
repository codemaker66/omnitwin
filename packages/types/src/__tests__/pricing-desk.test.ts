import { describe, expect, it } from "vitest";
import {
  PRICING_WRITE_ROLES,
  PricingAdviceDismissalSchema,
  PricingAdviceKeySchema,
  dayNumber,
  pricingAdviceKey,
  rateReplacements,
  standingRates,
  type RateSpecificityFields,
} from "../pricing-desk.js";

const ROOM = "11111111-1111-4111-8111-111111111111";
const OTHER_ROOM = "22222222-2222-4222-8222-222222222222";

function rate(overrides: Partial<RateSpecificityFields> & { readonly name: string }): RateSpecificityFields & { readonly name: string } {
  return {
    spaceId: ROOM, type: "flat_rate", appliesFrom: "19:00:00", appliesUntil: "00:30:00",
    validFrom: null, validTo: null, ...overrides,
  };
}

describe("who sets a price", () => {
  it("is the venue's admins and managers", () => {
    expect([...PRICING_WRITE_ROLES]).toEqual(["admin", "manager"]);
  });
});

describe("a rate for particular dates", () => {
  it("takes the place of the everyday rate for the same room, time and way of charging", () => {
    const everyday = rate({ name: "Grand Hall — Evening" });
    const saturday = rate({ name: "Grand Hall — Evening, 13 Jun", validFrom: "2027-06-13", validTo: "2027-06-13", appliesFrom: "19:00" });
    expect(standingRates([everyday, saturday]).map((r) => r.name)).toEqual(["Grand Hall — Evening, 13 Jun"]);
    expect(rateReplacements([everyday, saturday]).get(everyday)).toBe(saturday);
  });

  it("lets the rate naming fewer dates stand over a wider dated rate", () => {
    const june = rate({ name: "June", validFrom: "2027-06-01", validTo: "2027-06-30" });
    const day = rate({ name: "One day", validFrom: "2027-06-13", validTo: "2027-06-13" });
    const everyday = rate({ name: "Everyday" });
    expect(standingRates([everyday, june, day]).map((r) => r.name)).toEqual(["One day"]);
  });

  it("treats a later start as naming fewer dates than an earlier one", () => {
    const old = rate({ name: "From 2026", validFrom: "2026-01-01" });
    const next = rate({ name: "From 2027", validFrom: "2027-01-01" });
    expect(standingRates([old, next]).map((r) => r.name)).toEqual(["From 2027"]);
  });

  it("keeps stacking rules that name the same dates, as before", () => {
    const a = rate({ name: "A" });
    const b = rate({ name: "B" });
    expect(standingRates([a, b])).toHaveLength(2);
  });

  it("never sets aside another room's rate, another time's or another way of charging", () => {
    const everyday = rate({ name: "Evening" });
    const others = [
      rate({ name: "Other room", spaceId: OTHER_ROOM, validFrom: "2027-06-13", validTo: "2027-06-13" }),
      rate({ name: "Morning", appliesFrom: "09:00", appliesUntil: "13:00", validFrom: "2027-06-13", validTo: "2027-06-13" }),
      rate({ name: "Per head", type: "per_head", validFrom: "2027-06-13", validTo: "2027-06-13" }),
      rate({ name: "Venue-wide", spaceId: null, validFrom: "2027-06-13", validTo: "2027-06-13" }),
    ];
    expect(standingRates([everyday, ...others])).toHaveLength(5);
  });
});

describe("suggestion keys", () => {
  it("name the rate, the date and the kind", () => {
    const key = pricingAdviceKey("AAAAAAAA-1111-4111-8111-111111111111", "2027-06-13", "raise");
    expect(key).toBe("aaaaaaaa-1111-4111-8111-111111111111:2027-06-13:raise");
    expect(PricingAdviceKeySchema.safeParse(key).success).toBe(true);
  });

  it("refuse anything else as a dismissal", () => {
    expect(PricingAdviceDismissalSchema.safeParse({ key: "drop table" }).success).toBe(false);
    expect(PricingAdviceDismissalSchema.safeParse({ key: `${ROOM}:2027-06-13:raise`, extra: 1 }).success).toBe(false);
    expect(PricingAdviceDismissalSchema.safeParse({ key: `${ROOM}:2027-06-13:raise` }).success).toBe(true);
  });

  it("count days the same way on both sides of the year", () => {
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(dayNumber("2027-06-13")).toBe((dayNumber("2027-06-12") ?? 0) + 1);
    expect(dayNumber("13/06/2027")).toBeNull();
  });
});
