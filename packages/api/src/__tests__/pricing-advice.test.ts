import { describe, expect, it } from "vitest";
import { dayNumber, PricingAdviceSchema } from "@omnitwin/types";
import {
  computePricingAdvice,
  localStamp,
  moneyWords,
  occupiedSlots,
  partsOfWindow,
  roundingStep,
  weekdayOfDay,
  type AdviceBooking,
  type AdviceEnquiry,
  type AdviceInput,
  type AdviceRule,
  type AdviceSale,
} from "../services/pricing-advice.js";

// ---------------------------------------------------------------------------
// The pricing suggestions' maths (services/pricing-advice.ts). Synthetic
// records only: a Grand Hall with an evening rate of £2,800, and a venue
// clock reading 17 October 2026, 13:00 in Glasgow.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-17T12:00:00Z");
const ZONE = "Europe/London";
const HALL = "aaaaaaaa-0000-4000-8000-000000000001";
const SALOON = "aaaaaaaa-0000-4000-8000-000000000002";
const EVENING = "bbbbbbbb-0000-4000-8000-000000000001";
const ANY_TIME = "bbbbbbbb-0000-4000-8000-000000000002";
const DATED = "bbbbbbbb-0000-4000-8000-000000000003";

function rule(overrides: Partial<AdviceRule> = {}): AdviceRule {
  return {
    id: EVENING, name: "Grand Hall — Evening", spaceId: HALL, type: "flat_rate", amountMinor: 280_000, currency: "GBP",
    appliesFrom: "19:00:00", appliesUntil: "00:30:00", validFrom: null, validTo: null, isActive: true, retired: false,
    ...overrides,
  };
}

let serial = 0;
function id(): string {
  serial += 1;
  return `cccccccc-0000-4000-8000-${String(serial).padStart(12, "0")}`;
}

/** An evening booking, 19:00 to 00:30 Glasgow time, on a date. */
function evening(date: string, overrides: Partial<AdviceBooking> = {}): AdviceBooking {
  const summer = Number(date.slice(5, 7)) >= 4 && Number(date.slice(5, 7)) <= 10;
  const offset = summer ? 1 : 0;
  const start = new Date(`${date}T${String(19 - offset).padStart(2, "0")}:00:00Z`);
  return {
    id: id(), spaceId: HALL, kind: "ink", status: "active", jointFlag: false,
    startsAt: start, endsAt: new Date(start.getTime() + 5.5 * 3_600_000),
    createdAt: new Date("2024-06-01T09:00:00Z"), wasHold: false, decidedAt: null, exitedAt: null, enquiryId: null,
    ...overrides,
  };
}

function hold(date: string, overrides: Partial<AdviceBooking> = {}): AdviceBooking {
  return evening(date, { kind: "hold", wasHold: true, createdAt: new Date("2026-10-01T09:00:00Z"), ...overrides });
}

function enquiry(date: string, spaceId: string | null = HALL, createdAt = "2026-10-10T09:00:00Z"): AdviceEnquiry {
  return { id: id(), spaceId, preferredDate: date, createdAt: new Date(createdAt) };
}

function advise(overrides: Partial<AdviceInput> = {}): ReturnType<typeof computePricingAdvice> {
  const advice = computePricingAdvice({
    now: NOW, timeZone: ZONE, horizonDays: 548,
    rooms: [{ id: HALL, name: "Grand Hall" }, { id: SALOON, name: "Saloon" }],
    rules: [rule()], bookings: [], enquiries: [], sales: [], dismissed: new Set(), limit: 500,
    ...overrides,
  });
  // Whatever it says, it says in the shared contract's shape.
  expect(PricingAdviceSchema.safeParse(advice).success).toBe(true);
  return advice;
}

/** Every Saturday evening of June 2025 and June 2026 sold: a hot season. */
const HOT_JUNES = ["2025-06-07", "2025-06-14", "2025-06-21", "2025-06-28", "2026-06-06", "2026-06-13", "2026-06-20", "2026-06-27"]
  .map((date) => evening(date, { createdAt: new Date("2025-01-01T09:00:00Z") }));

describe("day-parts and the venue's clock", () => {
  it("reads the price sheet's slots as day-parts", () => {
    expect(partsOfWindow("19:00", "00:30")).toEqual(["evening"]);
    expect(partsOfWindow("09:00:00", "13:00:00")).toEqual(["morning"]);
    expect(partsOfWindow("14:00", "18:00")).toEqual(["afternoon"]);
    expect(partsOfWindow("09:00", "17:30")).toEqual(["morning", "afternoon"]);
    expect(partsOfWindow(null, null)).toEqual(["morning", "afternoon", "evening"]);
    // The small hours belong to the evening before.
    expect(partsOfWindow("00:00", "02:00")).toEqual(["evening"]);
  });

  it("reads an instant on the venue's own calendar, across the clock change", () => {
    const summer = localStamp(new Date("2027-06-12T18:00:00Z"), ZONE);
    expect(summer).toEqual({ day: dayNumber("2027-06-12"), minute: 19 * 60 });
    const winter = localStamp(new Date("2027-11-16T19:00:00Z"), ZONE);
    expect(winter).toEqual({ day: dayNumber("2027-11-16"), minute: 19 * 60 });
    expect(weekdayOfDay(dayNumber("2027-06-12") ?? 0)).toBe(6);
  });

  it("puts an evening that runs past midnight in its own evening only", () => {
    const day = dayNumber("2027-06-12") ?? 0;
    expect(occupiedSlots({ day, minute: 19 * 60 }, { day: day + 1, minute: 30 })).toEqual([{ day, part: "evening" }]);
    expect(occupiedSlots({ day, minute: 9 * 60 }, { day, minute: 17 * 60 + 30 })).toEqual([
      { day, part: "morning" }, { day, part: "afternoon" },
    ]);
    expect(occupiedSlots({ day, minute: 600 }, { day, minute: 600 })).toEqual([]);
  });

  it("writes figures the way a rate card is written", () => {
    expect(roundingStep(280_000)).toBe(5_000);
    expect(roundingStep(45_000)).toBe(1_000);
    expect(roundingStep(4_500)).toBe(100);
    expect(moneyWords(280_000, "GBP")).toBe("£2,800");
    expect(moneyWords(4_550, "GBP")).toBe("£45.50");
  });
});

describe("an empty book", () => {
  it("suggests nothing and says the record is too thin, rather than guessing", () => {
    const advice = advise();
    expect(advice.items).toEqual([]);
    expect(advice.recordsBegin).toBeNull();
    expect(advice.checked).toBeGreaterThan(500);
    expect(advice.tooLittleHistory).toBe(advice.checked);
    expect(advice.rateHolds).toBe(0);
  });

  it("names a 2nd option as a fact, with no figure, until there is history", () => {
    const advice = advise({
      rules: [rule(), rule({ id: ANY_TIME, name: "Grand Hall — Any time", appliesFrom: null, appliesUntil: null, amountMinor: 400_000 })],
      bookings: [hold("2027-06-12"), hold("2027-06-12")],
    });
    // One line for the room and date, not one for each of its rates.
    expect(advice.items).toHaveLength(1);
    const [item] = advice.items;
    expect(item?.kind).toBe("too_little_history");
    expect(item?.date).toBe("2027-06-12");
    expect(item?.lowMinor).toBeNull();
    expect(item?.suggestedMinor).toBeNull();
    expect(item?.reasons.map((reason) => reason.text)).toContain("A 2nd option is pencilled: two parties want this date.");
  });

  it("names enquiries pressing for a date the same way", () => {
    const advice = advise({ enquiries: [enquiry("2027-03-20"), enquiry("2027-03-20"), enquiry("2027-03-20", SALOON)] });
    expect(advice.items.map((item) => [item.kind, item.date])).toEqual([["too_little_history", "2027-03-20"]]);
    expect(advice.items[0]?.reasons[0]?.text).toBe("3 enquiries ask for this date, 2 of them for the Grand Hall.");
  });

  it("does not count an enquiry that has become a booking twice", () => {
    const asked = enquiry("2027-03-20");
    const advice = advise({
      enquiries: [asked, enquiry("2027-03-20")],
      bookings: [hold("2027-03-20", { enquiryId: asked.id })],
    });
    expect(advice.items).toEqual([]);
  });
});

describe("a hot season with a 2nd option", () => {
  const holds = [hold("2027-06-12"), hold("2027-06-12", { jointFlag: false })];

  it("suggests a higher rate, with its reasons and the records behind it", () => {
    const advice = advise({ bookings: [...HOT_JUNES, ...holds] });
    const item = advice.items.find((entry) => entry.date === "2027-06-12");
    expect(item?.kind).toBe("raise");
    expect(item?.key).toBe(`${EVENING}:2027-06-12:raise`);
    expect(item?.currentMinor).toBe(280_000);
    expect(item?.lowMinor).toBe(300_000);
    expect(item?.highMinor).toBe(335_000);
    expect(item?.suggestedMinor).toBe(315_000);
    expect(item?.records).toBe(10);
    expect(item?.dayPart).toBe("Evening, 19:00–00:30");
    expect(item?.accept).toBe("add_dated");
    expect(item?.reasons).toEqual(expect.arrayContaining([
      { text: "A 2nd option is pencilled: two parties want this date.", direction: "up", records: 2 },
      { text: "Saturday evenings in June: 8 of 8 booked in the venue's record.", direction: "up", records: 8 },
      {
        text: "June 2027: 0.5 evenings in the Grand Hall held or confirmed, against 4 at this point last year (4 by the end).",
        direction: "down", records: 6,
      },
    ]));
    expect(advice.recordsBegin).toBe("2025-06-07");
  });

  it("leaves the other June Saturdays at the current rate: history alone moves less than its own uncertainty", () => {
    const advice = advise({ bookings: [...HOT_JUNES, ...holds] });
    expect(advice.items.filter((item) => item.date === "2027-06-19")).toEqual([]);
    expect(advice.rateHolds).toBeGreaterThan(0);
  });

  it("never suggests a price for a date already confirmed", () => {
    const advice = advise({ bookings: [...HOT_JUNES, evening("2027-06-12"), ...holds] });
    expect(advice.items.filter((item) => item.date === "2027-06-12")).toEqual([]);
  });

  it("drops a suggestion a person dismissed, and counts it", () => {
    const advice = advise({ bookings: [...HOT_JUNES, ...holds], dismissed: new Set([`${EVENING}:2027-06-12:raise`]) });
    expect(advice.items.filter((item) => item.date === "2027-06-12")).toEqual([]);
    expect(advice.dismissed).toBe(1);
  });

  it("offers to edit a rate that is already this date's own, rather than add another", () => {
    const own = rule({ id: DATED, name: "Grand Hall — Evening, 12 Jun 2027", validFrom: "2027-06-12", validTo: "2027-06-12", amountMinor: 280_000 });
    const advice = advise({ rules: [rule(), own], bookings: [...HOT_JUNES, ...holds] });
    const item = advice.items.find((entry) => entry.date === "2027-06-12");
    expect(item?.ruleId).toBe(DATED);
    expect(item?.accept).toBe("edit");
  });

  it("reads holds by the venue's own hold-to-confirmed rate once it has one", () => {
    // Ten decided holds in the last two years: two confirmed, eight let go.
    const decided = Array.from({ length: 10 }, (_, index) => hold(`2025-0${String(1 + (index % 9))}-1${String(index % 9)}`, {
      kind: index < 2 ? "ink" : "hold",
      status: index < 2 ? "active" : "released",
      decidedAt: new Date("2025-12-01T09:00:00Z"),
      exitedAt: index < 2 ? null : new Date("2025-12-01T09:00:00Z"),
      spaceId: SALOON,
    }));
    const advice = advise({ bookings: [...HOT_JUNES, ...holds, ...decided] });
    expect(advice.conversion).toEqual({ confirmed: 2, decided: 10 });
    const item = advice.items.find((entry) => entry.date === "2027-06-12" && entry.spaceId === HALL);
    expect(item?.reasons.map((reason) => reason.text)).toContain(
      "2 in 10 provisional holds here have gone on to be confirmed (10 decided in the last two years).",
    );
  });

  it("adds what clients accepted for it last June", () => {
    const sales: AdviceSale[] = [
      { id: id(), ruleId: EVENING, date: "2026-06-13", unitMinor: 300_000 },
      { id: id(), ruleId: EVENING, date: "2026-06-20", unitMinor: 300_000 },
    ];
    const advice = advise({ bookings: [...HOT_JUNES, ...holds], sales });
    const item = advice.items.find((entry) => entry.date === "2027-06-12");
    expect(item?.reasons).toContainEqual({
      text: "In June last year it sold at £3,000 on average (2 accepted quotes), above the £2,800 asked now.",
      direction: "up", records: 2,
    });
  });
});

describe("a quiet season", () => {
  // Tuesday evenings in November: one sold in two years. The record begins
  // with that booking on 12 November 2024, so 5 November is not counted.
  const quietNovembers = ["2024-11-12", "2024-11-19", "2024-11-26", "2025-11-04", "2025-11-11", "2025-11-18", "2025-11-25"];
  const sold = evening("2024-11-12", { createdAt: new Date("2024-09-01T09:00:00Z") });
  // Six November 2026 evenings were on the book a year ago; two for 2027 now.
  const lastNovember = ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-12", "2026-11-13", "2026-11-14"]
    .map((date) => evening(date, { createdAt: new Date("2025-09-01T09:00:00Z") }));
  const thisNovember = ["2027-11-05", "2027-11-06"].map((date) => evening(date, { createdAt: new Date("2026-09-01T09:00:00Z") }));

  it("suggests a lower rate, within the cap, with its reasons", () => {
    expect(quietNovembers).toHaveLength(7);
    const advice = advise({ bookings: [sold, ...lastNovember, ...thisNovember] });
    const item = advice.items.find((entry) => entry.date === "2027-11-16");
    expect(item?.kind).toBe("lower");
    expect(item?.lowMinor).toBe(235_000);
    expect(item?.highMinor).toBe(270_000);
    expect(item?.suggestedMinor).toBe(250_000);
    expect(item?.reasons).toEqual(expect.arrayContaining([
      { text: "Tuesday evenings in November: 1 of 7 booked in the venue's record.", direction: "down", records: 1 },
      {
        text: "November 2027: 2 evenings in the Grand Hall held or confirmed, against 6 at this point last year (6 by the end).",
        direction: "down", records: 8,
      },
    ]));
    // Never more than a tenth off, before the range's own width.
    for (const entry of advice.items.filter((candidate) => candidate.kind === "lower")) {
      expect(entry.lowMinor ?? 0).toBeGreaterThanOrEqual(Math.floor(280_000 * 0.82));
    }
  });
});

describe("what it reads", () => {
  it("ignores paused and retired rates, a rate for every room, and tiered prices", () => {
    const advice = advise({
      rules: [
        rule({ isActive: false }),
        rule({ id: ANY_TIME, retired: true }),
        rule({ id: DATED, spaceId: null }),
        rule({ id: "bbbbbbbb-0000-4000-8000-000000000009", type: "tiered" }),
      ],
      bookings: [hold("2027-06-12"), hold("2027-06-12")],
    });
    expect(advice.checked).toBe(0);
    expect(advice.items).toEqual([]);
  });

  it("cuts the list to its page and says how many there were", () => {
    const enquiries = ["2027-01-09", "2027-01-16", "2027-01-23"].flatMap((date) => [enquiry(date), enquiry(date)]);
    const advice = advise({ enquiries, limit: 2 });
    expect(advice.total).toBe(3);
    expect(advice.items.map((item) => item.date)).toEqual(["2027-01-09", "2027-01-16"]);
  });

  it("looks only at the days ahead it was asked about", () => {
    const advice = advise({ horizonDays: 30, enquiries: [enquiry("2027-03-20"), enquiry("2027-03-20")] });
    expect(advice.from).toBe("2026-10-18");
    expect(advice.through).toBe("2026-11-16");
    expect(advice.items).toEqual([]);
  });
});
