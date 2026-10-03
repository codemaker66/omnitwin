import { describe, expect, it } from "vitest";
import type { PricingRule } from "../../../../api/pricing.js";
import type { Space } from "../../../../api/spaces.js";
import { addedWords, priceEntry, priceListView, type PriceListEvent, type PriceListOffer } from "../price-list-format.js";

// ---------------------------------------------------------------------------
// Add from price list (roadmap X1): what each entry costs for the event, the
// line it adds, and how the list is laid out and what it leaves out.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const GRAND_HALL = "00000000-0000-4000-8000-000000000011";
const SALOON = "00000000-0000-4000-8000-000000000012";
const RECEPTION = "00000000-0000-4000-8000-000000000013";

function rule(overrides: Partial<PricingRule> = {}): PricingRule {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-0000000000a1", venueId: VENUE, spaceId: GRAND_HALL,
    name: "Grand Hall — Evening Event (19:00–00:30)", type: "flat_rate", amount: "2400.00", currency: "GBP",
    minHours: null, minGuests: null, tiers: null, dayOfWeekModifiers: null, seasonalModifiers: null,
    isActive: true, validFrom: null, validTo: null, ...overrides,
  };
}

function room(id: string, name: string): Space {
  return { id, venueId: VENUE, name, slug: name.toLowerCase().replace(/ /gu, "-"), widthM: "10", lengthM: "20", heightM: "8", floorPlanOutline: [] };
}

const ROOMS = [room(GRAND_HALL, "Grand Hall"), room(SALOON, "Saloon"), room(RECEPTION, "Reception Room")];
/** Saturday 5 June 2027 in the Grand Hall, for 120. */
const EVENT: PriceListEvent = { spaceId: GRAND_HALL, eventDate: "2027-06-05", guestCount: 120 };
const UNKNOWN: PriceListEvent = { spaceId: null, eventDate: null, guestCount: null };

function offered(result: ReturnType<typeof priceEntry>): PriceListOffer {
  if (!result.offered) throw new Error(`not offered: ${result.why}`);
  return result.offer;
}

describe("an entry, priced for the event", () => {
  it("adds a flat rate once, at its price", () => {
    const offer = offered(priceEntry(rule(), EVENT));
    expect(offer).toMatchObject({ name: "Grand Hall — Evening Event (19:00–00:30)", price: "£2,400", adjustment: null, per: null, asks: null,
      line: { description: "Grand Hall — Evening Event (19:00–00:30)", quantity: "1", pounds: "2400" } });
  });

  it("keeps the pence of a price that has them", () => {
    expect(offered(priceEntry(rule({ amount: "81.25" }), EVENT)).line.pounds).toBe("81.25");
    expect(offered(priceEntry(rule({ amount: "81.25" }), EVENT)).price).toBe("£81.25");
  });

  it("prices a head for the guests, and never fewer than its least", () => {
    const dinner = rule({ name: "Dinner", type: "per_head", amount: "65.00", minGuests: 100 });
    expect(offered(priceEntry(dinner, EVENT))).toMatchObject({ price: "£65 a head, at least 100", per: "head", asks: null, atMinimum: false,
      line: { quantity: "120", pounds: "65" } });
    expect(offered(priceEntry(dinner, { ...EVENT, guestCount: 80 }))).toMatchObject({ atMinimum: true, line: { quantity: "100" } });
    expect(offered(priceEntry(dinner, { ...EVENT, guestCount: 100 })).atMinimum).toBe(false);
  });

  it("asks for the guests when the event has no count, starting from the least", () => {
    const dinner = rule({ name: "Dinner", type: "per_head", amount: "65.00", minGuests: 100 });
    expect(offered(priceEntry(dinner, { ...EVENT, guestCount: null }))).toMatchObject({ asks: "guests", line: { quantity: "100" } });
    expect(offered(priceEntry({ ...dinner, minGuests: null }, { ...EVENT, guestCount: 0 }))).toMatchObject({ asks: "guests", price: "£65 a head", line: { quantity: "" } });
  });

  it("asks for the hours of a price an hour, which a proposal does not hold", () => {
    const staff = rule({ name: "Bar staff", type: "per_hour", amount: "18.00", minHours: 4 });
    expect(offered(priceEntry(staff, EVENT))).toMatchObject({ price: "£18 an hour, at least 4 hours", per: "hour", asks: "hours", line: { quantity: "4" } });
    expect(offered(priceEntry({ ...staff, minHours: 1 }, EVENT)).price).toBe("£18 an hour, at least 1 hour");
    expect(offered(priceEntry({ ...staff, minHours: null }, EVENT))).toMatchObject({ price: "£18 an hour", line: { quantity: "" } });
  });

  it("prices by guest count as the venue's estimate does: the first tier they fit, else the highest", () => {
    const tiered = rule({ name: "Room hire", type: "tiered", amount: "0", tiers: [{ upTo: 200, amount: 1500 }, { upTo: 100, amount: 900 }, { upTo: 150, amount: 1200 }] });
    expect(offered(priceEntry(tiered, EVENT))).toMatchObject({ price: "£1,200 for up to 150 guests", line: { quantity: "1", pounds: "1200" } });
    expect(offered(priceEntry(tiered, { ...EVENT, guestCount: 100 })).price).toBe("£900 for up to 100 guests");
    expect(offered(priceEntry(tiered, { ...EVENT, guestCount: 260 })).price).toBe("£1,500, the price for the most guests (up to 200)");
  });

  it("does not offer a tiered price it cannot place", () => {
    const tiered = rule({ type: "tiered", tiers: [{ upTo: 100, amount: 900 }] });
    expect(priceEntry(tiered, { ...EVENT, guestCount: null })).toEqual({ offered: false, why: "guests" });
    expect(priceEntry({ ...tiered, tiers: [] }, EVENT)).toEqual({ offered: false, why: "no_price" });
    expect(priceEntry({ ...tiered, tiers: null }, EVENT)).toEqual({ offered: false, why: "no_price" });
    expect(priceEntry({ ...tiered, tiers: undefined }, EVENT)).toEqual({ offered: false, why: "unreadable" });
  });

  it("offers nothing in another currency, or with a price it cannot read", () => {
    expect(priceEntry(rule({ currency: "EUR" }), EVENT)).toEqual({ offered: false, why: "currency" });
    expect(priceEntry(rule({ amount: "a lot" }), EVENT)).toEqual({ offered: false, why: "unreadable" });
  });

  it("applies its own day's and month's adjustment on the event's date, and says so", () => {
    const saturday = rule({ dayOfWeekModifiers: { saturday: 1.25, sunday: 1.5 } });
    expect(offered(priceEntry(saturday, EVENT))).toMatchObject({ adjustment: "Saturdays: 25% more, so £3,000", line: { pounds: "3000" } });
    // Friday 4 June 2027: no Friday adjustment.
    expect(offered(priceEntry(saturday, { ...EVENT, eventDate: "2027-06-04" }))).toMatchObject({ adjustment: null, line: { pounds: "2400" } });
    const both = rule({ dayOfWeekModifiers: { saturday: 1.25 }, seasonalModifiers: { june: 0.9, july: 1.1 } });
    expect(offered(priceEntry(both, EVENT))).toMatchObject({ adjustment: "Saturdays: 25% more; June: 10% less, so £2,700", line: { pounds: "2700" } });
  });

  // As the venue's money engine rounds (api services/money.ts): to the penny,
  // a tie to the even penny, so one entry priced here is what its estimate gives.
  it("rounds an adjusted price to the penny as the venue's estimate does, a tie to the even penny", () => {
    expect(offered(priceEntry(rule({ amount: "65.00", seasonalModifiers: { june: 1.125 } }), EVENT)))
      .toMatchObject({ adjustment: "June: 12.5% more, so £73.12", line: { pounds: "73.12" } });
    expect(offered(priceEntry(rule({ amount: "10.10", dayOfWeekModifiers: { saturday: 1.25 } }), EVENT)).line.pounds).toBe("12.62");
    expect(offered(priceEntry(rule({ amount: "10.30", dayOfWeekModifiers: { saturday: 1.25 } }), EVENT)).line.pounds).toBe("12.88");
    expect(offered(priceEntry(rule({ type: "per_head", amount: "65.33", seasonalModifiers: { june: 1.125 } }), EVENT)).line)
      .toMatchObject({ quantity: "120", pounds: "73.50" });
  });

  it("says an adjustment is not applied when there is no date yet", () => {
    const saturday = rule({ dayOfWeekModifiers: { saturday: 1.25 } });
    expect(offered(priceEntry(saturday, { ...EVENT, eventDate: null }))).toMatchObject({
      adjustment: "Some days or months cost more or less; with no date yet, none is applied.", line: { pounds: "2400" } });
    expect(offered(priceEntry(rule({ dayOfWeekModifiers: { saturday: 1 } }), { ...EVENT, eventDate: null })).adjustment).toBeNull();
  });

  it("does not price an entry whose adjustment it cannot read", () => {
    expect(priceEntry(rule({ dayOfWeekModifiers: undefined }), EVENT)).toEqual({ offered: false, why: "unreadable" });
    expect(priceEntry(rule({ seasonalModifiers: undefined }), UNKNOWN)).toEqual({ offered: false, why: "unreadable" });
  });

  it("takes a date in any other form as no date yet", () => {
    const summer = rule({ validFrom: "2027-05-01", validTo: "2027-09-30", dayOfWeekModifiers: { saturday: 1.25 } });
    for (const eventDate of ["5 June 2027", "2027-02-30", "2027-6-5"]) {
      expect(offered(priceEntry(summer, { ...EVENT, eventDate }))).toMatchObject({
        price: "£2,400, 1 May 2027 to 30 September 2027", line: { pounds: "2400" } });
      expect(priceListView([summer], ROOMS, { ...EVENT, eventDate }).leftOut).toEqual([]);
    }
  });

  it("names the days it is priced for when the event has no date", () => {
    const summer = rule({ validFrom: "2027-05-01", validTo: "2027-09-30" });
    expect(offered(priceEntry(summer, UNKNOWN)).price).toBe("£2,400, 1 May 2027 to 30 September 2027");
    expect(offered(priceEntry({ ...summer, validTo: null }, UNKNOWN)).price).toBe("£2,400, from 1 May 2027");
    expect(offered(priceEntry({ ...summer, validFrom: null }, UNKNOWN)).price).toBe("£2,400, until 30 September 2027");
    expect(offered(priceEntry(summer, EVENT)).price).toBe("£2,400");
  });
});

describe("the price list for the event", () => {
  const rules = [
    rule({ id: "a", spaceId: SALOON, name: "Saloon — Evening" }),
    rule({ id: "b", spaceId: null, name: "Exclusive Use of Full Venue", amount: "2500" }),
    rule({ id: "c", name: "Grand Hall — Evening" }),
    rule({ id: "d", spaceId: RECEPTION, name: "Reception Room — Evening", amount: "500" }),
    rule({ id: "e", name: "Grand Hall — Full Day", amount: "1800" }),
  ];

  it("leads with the event's room and the venue-wide prices, then every other room in the venue's order", () => {
    const view = priceListView(rules, ROOMS, EVENT);
    expect(view.first.map((group) => [group.heading, group.offers.map((offer) => offer.name)])).toEqual([
      ["Grand Hall", ["Grand Hall — Evening", "Grand Hall — Full Day"]],
      ["Venue-wide", ["Exclusive Use of Full Venue"]],
    ]);
    expect(view.rooms.map((group) => [group.heading, group.offers.map((offer) => offer.name)])).toEqual([
      ["Saloon", ["Saloon — Evening"]],
      ["Reception Room", ["Reception Room — Evening"]],
    ]);
    expect(view.leftOut).toEqual([]);
  });

  it("shows every room's prices when the event's room is not known", () => {
    const view = priceListView(rules, ROOMS, UNKNOWN);
    expect(view.first.map((group) => group.heading)).toEqual(["Venue-wide"]);
    expect(view.rooms.map((group) => group.heading)).toEqual(["Grand Hall", "Saloon", "Reception Room"]);
  });

  it("keeps a room the venue no longer lists, or rooms not read, together", () => {
    const view = priceListView([...rules, rule({ id: "f", spaceId: "00000000-0000-4000-8000-0000000000ff", name: "Old room" })], ROOMS, EVENT);
    expect(view.rooms.map((group) => group.heading)).toEqual(["Saloon", "Reception Room", "Other rooms"]);
    expect(priceListView(rules, [], EVENT).first.map((group) => group.heading)).toEqual(["This event's room", "Venue-wide"]);
    expect(priceListView(rules, [], EVENT).rooms.map((group) => [group.heading, group.offers.length])).toEqual([["Other rooms", 2]]);
  });

  it("says what it leaves out, and why, rather than dropping it", () => {
    const view = priceListView([
      rule({ id: "g", name: "Summer terrace", validFrom: "2027-07-01" }),
      rule({ id: "h", name: "Winter hire", validTo: "2027-03-31" }),
      rule({ id: "i", name: "Euro hire", currency: "EUR" }),
      rule({ id: "j", name: "Room by numbers", type: "tiered", tiers: [{ upTo: 100, amount: 900 }] }),
      rule({ id: "k", name: "Blank", amount: "" }),
      rule({ id: "l", name: "Garbled", dayOfWeekModifiers: undefined }),
      rule({ id: "m", name: "Switched off", isActive: false }),
    ], ROOMS, { ...EVENT, guestCount: null });
    expect(view.first).toEqual([]);
    expect(view.leftOut).toEqual([
      "Not priced for 5 June 2027: Summer terrace and Winter hire.",
      "Priced by the guest count, which the event does not have yet: Room by numbers.",
      "Priced in another currency, and the quote is in pounds: Euro hire.",
      "Could not be read: Blank and Garbled.",
    ]);
  });
});

describe("what is said as a line is added", () => {
  it("names the price, its unit, the new line, and what the booker is to enter", () => {
    expect(addedWords(offered(priceEntry(rule(), EVENT)), 1)).toBe("Added Grand Hall — Evening Event (19:00–00:30) at £2,400 as line 1.");
    expect(addedWords(offered(priceEntry(rule(), EVENT)), 2)).toBe("Added Grand Hall — Evening Event (19:00–00:30) at £2,400 as line 2.");
    const dinner = rule({ name: "Dinner", type: "per_head", amount: "65.00" });
    expect(addedWords(offered(priceEntry(dinner, EVENT)), 2)).toBe("Added Dinner at £65 a head for 120 guests as line 2.");
    // A minimum above the guests is said as the minimum, not as the guest count.
    expect(addedWords(offered(priceEntry({ ...dinner, minGuests: 150 }, EVENT)), 2)).toBe("Added Dinner at £65 a head for the minimum of 150 as line 2.");
    expect(addedWords(offered(priceEntry(dinner, { ...EVENT, guestCount: null })), 3)).toBe("Added Dinner at £65 a head as line 3. Enter the guests.");
    expect(addedWords(offered(priceEntry(rule({ name: "Bar staff", type: "per_hour", amount: "18.00" }), EVENT)), 4))
      .toBe("Added Bar staff at £18 an hour as line 4. Enter the hours.");
    expect(addedWords(offered(priceEntry(rule({ dayOfWeekModifiers: { saturday: 1.25 } }), EVENT)), 1))
      .toBe("Added Grand Hall — Evening Event (19:00–00:30) at £3,000 as line 1.");
  });
});
