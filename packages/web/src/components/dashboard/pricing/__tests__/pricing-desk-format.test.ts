import { describe, expect, it } from "vitest";
import type { PricingAdvice, PricingAdviceItem } from "@omnitwin/types";
import type { DeskRule } from "../../../../api/pricing-desk.js";
import {
  adviceHeadline,
  basisWords,
  changeLine,
  changeOf,
  consequenceWords,
  datesWords,
  dayWords,
  draftFromAdvice,
  draftOf,
  groupAdvice,
  groupRates,
  lastChangeLine,
  leadWords,
  priceWords,
  rangeWords,
  readDraft,
  recordsWords,
  retireWords,
  settersWords,
  timeTile,
  timeWords,
} from "../pricing-desk-format.js";

const ZONE = "Europe/London";
const HALL = "aaaaaaaa-0000-4000-8000-000000000001";
const SALOON = "aaaaaaaa-0000-4000-8000-000000000002";

function rule(overrides: Partial<DeskRule> = {}): DeskRule {
  return {
    id: "bbbbbbbb-0000-4000-8000-000000000001", venueId: "v1", spaceId: HALL, name: "Grand Hall — Evening",
    type: "flat_rate", amount: "2800.00", currency: "GBP", minHours: null, minGuests: null, tiers: null,
    dayOfWeekModifiers: null, seasonalModifiers: null, appliesFrom: "19:00:00", appliesUntil: "00:30:00",
    isActive: true, validFrom: null, validTo: null, createdAt: "2026-01-05T10:00:00.000Z", updatedAt: "2026-01-05T10:00:00.000Z",
    deletedAt: null, history: [], ...overrides,
  };
}

function item(overrides: Partial<PricingAdviceItem> = {}): PricingAdviceItem {
  return {
    key: "bbbbbbbb-0000-4000-8000-000000000001:2027-06-12:raise", kind: "raise", ruleId: "bbbbbbbb-0000-4000-8000-000000000001",
    ruleName: "Grand Hall — Evening", spaceId: HALL, roomName: "Grand Hall", date: "2027-06-12", dayPart: "Evening, 19:00–00:30",
    per: "booking", currency: "GBP", currentMinor: 280_000, lowMinor: 300_000, highMinor: 335_000, suggestedMinor: 315_000,
    reasons: [], records: 10, leadDays: 238, accept: "add_dated", ...overrides,
  };
}

describe("a rate in the venue's words", () => {
  it("says its price, its time and its dates", () => {
    expect(priceWords(rule())).toBe("£2,800");
    expect(priceWords(rule({ type: "per_head", amount: "45.50", minGuests: 100 }))).toBe("£45.50 a head, at least 100 guests");
    expect(priceWords(rule({ type: "per_hour", amount: "18.00", minHours: 4 }))).toBe("£18 an hour, at least 4 hours");
    expect(priceWords(rule({ type: "tiered" }))).toBe("Tiered by guest numbers");
    expect(timeWords(rule())).toBe("19:00–00:30 (past midnight)");
    expect(timeWords(rule({ appliesFrom: null, appliesUntil: null }))).toBe("Any time");
    expect(timeTile(rule())).toEqual({ from: "19:00", until: "00:30" });
    expect(datesWords(rule())).toBe("Every date");
    expect(datesWords(rule({ validFrom: "2027-06-12", validTo: "2027-06-12" }))).toBe("12 Jun 2027 only");
    expect(datesWords(rule({ validFrom: "2027-06-01", validTo: "2027-06-30" }))).toBe("1 Jun 2027 to 30 Jun 2027");
    expect(datesWords(rule({ validFrom: "2027-01-01" }))).toBe("From 1 Jan 2027");
    expect(dayWords("2027-06-12")).toBe("Sat 12 Jun 2027");
  });

  it("lists rates room by room in the venue's order, then for every room, then rooms that have gone", () => {
    const rooms = [{ id: HALL, name: "Grand Hall" }, { id: SALOON, name: "Saloon" }];
    const groups = groupRates([
      rule({ id: "1", name: "Evening" }),
      rule({ id: "2", name: "Morning", appliesFrom: "09:00:00", appliesUntil: "13:00:00" }),
      rule({ id: "3", spaceId: SALOON, name: "Saloon evening" }),
      rule({ id: "4", spaceId: null, name: "Cloakroom" }),
      rule({ id: "5", spaceId: "gone", name: "Old room" }),
    ], rooms);
    expect(groups.map((group) => [group.heading, group.rules.map((entry) => entry.name)])).toEqual([
      ["Grand Hall", ["Morning", "Evening"]],
      ["Saloon", ["Saloon evening"]],
      ["Every room", ["Cloakroom"]],
      ["Rooms no longer listed", ["Old room"]],
    ]);
  });
});

describe("who changed it and when", () => {
  it("names the person and the venue's time", () => {
    expect(changeLine({ action: "updated", at: "2026-10-17T13:32:00.000Z", by: "Callum Reid", summary: "" }, ZONE))
      .toBe("Changed by Callum Reid, 17 Oct 2026, 14:32");
    expect(changeLine({ action: "deleted", at: "2026-01-17T13:32:00.000Z", by: null, summary: "" }, ZONE))
      .toBe("Retired by someone no longer on the team, 17 Jan 2026, 13:32");
  });

  it("says plainly when a rate was entered before changes were recorded", () => {
    expect(lastChangeLine(rule(), ZONE)).toBe("Entered 5 Jan 2026, 10:00; who entered it was not recorded");
  });

  it("names who can set a price, as the way forward", () => {
    expect(settersWords([])).toBe("an administrator or a manager at the venue");
    expect(settersWords(["Moira Stewart"])).toBe("Moira Stewart");
    expect(settersWords(["Callum Reid", "Ailsa Grant", "Moira Stewart"])).toBe("Callum Reid, Ailsa Grant or Moira Stewart");
  });
});

describe("the form", () => {
  it("reads a draft the way the API will", () => {
    const reading = readDraft({ ...draftOf(rule()), amount: "2950.5" });
    expect(reading).toEqual({
      ok: true,
      body: {
        name: "Grand Hall — Evening", type: "flat_rate", amount: 2950.5, spaceId: HALL, appliesFrom: "19:00", appliesUntil: "00:30",
        validFrom: null, validTo: null, minHours: null, minGuests: null, isActive: true,
      },
    });
  });

  it("says the first problem plainly", () => {
    const draft = draftOf(rule());
    expect(readDraft({ ...draft, name: " " })).toMatchObject({ ok: false, field: "name" });
    expect(readDraft({ ...draft, amount: "2,800" })).toMatchObject({ ok: false, field: "amount", problem: "Enter the price in pounds, as 2800 or 45.50." });
    expect(readDraft({ ...draft, until: "" })).toMatchObject({ ok: false, field: "time", problem: "Enter both times, or neither." });
    expect(readDraft({ ...draft, validFrom: "2027-02-30" })).toMatchObject({ ok: false, field: "dates" });
    expect(readDraft({ ...draft, validFrom: "2027-06-13", validTo: "2027-06-12" })).toMatchObject({ ok: false, field: "dates", problem: "The first date comes on or before the last." });
    expect(readDraft({ ...draft, type: "per_head", minimum: "ten" })).toMatchObject({ ok: false, field: "minimum" });
  });

  it("sends only what changed", () => {
    const original = draftOf(rule());
    const draft = { ...original, amount: "2900", validFrom: "2027-01-01" };
    const reading = readDraft(draft);
    if (!reading.ok) throw new Error(reading.problem);
    expect(changeOf(original, reading.body, draft)).toEqual({ amount: 2900, validFrom: "2027-01-01", validTo: null });
  });
});

describe("what saving does, said before Save", () => {
  it("states the change and what happens to quotes", () => {
    const original = draftOf(rule());
    const reading = readDraft({ ...original, amount: "2900" });
    if (!reading.ok) throw new Error(reading.problem);
    expect(consequenceWords({ mode: "edit", original, body: reading.body, currency: "GBP", others: [] })).toEqual([
      "£2,800 becomes £2,900.",
      "Quotes made from now, and enquiry estimates, use this rate. Quotes already made keep theirs.",
    ]);
  });

  it("says which everyday rate a rate for one date takes the place of", () => {
    const everyday = rule();
    const reading = readDraft({ ...draftOf(everyday), name: "Grand Hall — Evening, 12 Jun 2027", amount: "3150", validFrom: "2027-06-12", validTo: "2027-06-12" });
    if (!reading.ok) throw new Error(reading.problem);
    expect(consequenceWords({ mode: "create", original: null, body: reading.body, currency: "GBP", others: [everyday] })).toEqual([
      "Quotes made from now, and enquiry estimates, can use this rate. Quotes already made are unchanged.",
      "On Sat 12 Jun 2027 it takes the place of “Grand Hall — Evening” (£2,800).",
    ]);
  });

  it("says a paused rate is not offered", () => {
    const reading = readDraft({ ...draftOf(rule()), isActive: false });
    if (!reading.ok) throw new Error(reading.problem);
    expect(consequenceWords({ mode: "edit", original: draftOf(rule()), body: reading.body, currency: "GBP", others: [] }))
      .toEqual(["It stays on the list but is not offered: quotes and estimates do not use it until it is in use again."]);
  });

  it("says what retiring does, and the way back", () => {
    expect(retireWords(rule())).toBe("“Grand Hall — Evening” leaves the price list. Quotes made from now cannot use it; quotes already made keep it. You can bring it back from Retired.");
  });
});

describe("suggestions", () => {
  it("read as a revenue manager would say them", () => {
    expect(adviceHeadline(item())).toBe("Raise to about £3,150");
    expect(adviceHeadline(item({ kind: "lower", suggestedMinor: 250_000 }))).toBe("Lower to about £2,500");
    expect(adviceHeadline(item({ kind: "too_little_history", suggestedMinor: null, lowMinor: null, highMinor: null }))).toBe("Too little history to suggest a change");
    expect(rangeWords(item())).toBe("£3,000–£3,350");
    expect(rangeWords(item({ lowMinor: null }))).toBeNull();
    expect(recordsWords(10)).toBe("Rests on 10 records from the venue's own book.");
    expect(leadWords(238)).toBe("in 8 months");
    expect(leadWords(20)).toBe("in 3 weeks");
    expect(leadWords(1)).toBe("tomorrow");
  });

  it("open a rate for that date, filled in for a person to check and save", () => {
    const opened = draftFromAdvice(item(), rule());
    expect(opened.mode).toBe("create");
    expect(opened.draft).toMatchObject({ name: "Grand Hall — Evening, 12 Jun 2027", amount: "3150", validFrom: "2027-06-12", validTo: "2027-06-12", from: "19:00", until: "00:30", spaceId: HALL });
    const own = draftFromAdvice(item({ accept: "edit" }), rule({ validFrom: "2027-06-12", validTo: "2027-06-12" }));
    expect(own).toMatchObject({ mode: "edit", draft: { amount: "3150", validFrom: "2027-06-12" } });
  });

  it("say what the record holds, and that competitors' prices are not used", () => {
    const advice: PricingAdvice = {
      computedAt: "2026-10-17T12:00:00.000Z", timezone: ZONE, from: "2026-10-18", through: "2028-04-17", recordsBegin: "2025-06-07",
      basis: { bookings: 124, enquiries: 1, acceptedQuoteLines: 9 }, conversion: null, checked: 100, rateHolds: 90,
      tooLittleHistory: 7, dismissed: 0, total: 3, items: [],
    };
    expect(basisWords(advice)).toBe("Worked out from 124 bookings, 1 enquiry and 9 accepted quote lines in the venue's own record, which begins on 7 Jun 2025. Competitors' prices are not used.");
    expect(basisWords({ ...advice, recordsBegin: null })).toContain("no history to suggest from");
  });

  it("group by month, soonest first", () => {
    const groups = groupAdvice([item(), item({ key: "x:2027-06-19:raise", date: "2027-06-19" }), item({ key: "y:2027-07-03:raise", date: "2027-07-03" })]);
    expect(groups.map((group) => [group.heading, group.items.length])).toEqual([["June 2027", 2], ["July 2027", 1]]);
  });
});
