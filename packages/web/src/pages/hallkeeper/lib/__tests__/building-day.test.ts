import { describe, expect, it } from "vitest";
import type { CalendarPhaseEntry, SupplierArrival } from "@omnitwin/types";
import { buildingDay } from "../building-day.js";
import type { DayBoardLane, DayBoardSlot } from "../day-board-state.js";

// ---------------------------------------------------------------------------
// The building's day: everything that needs the building is a span, and
// spans that touch are one stretch of use. The first stretch the day begins
// opens it; the last one's end, by the small hours after, locks it up; a
// stretch already running as the day begins, or running on past the night,
// is named instead of a time. A night's lock-up stays with the day it began.
// A setup is a phase on the Diary, as deriveDayBoard reads it, and a phase on
// the day whose booking is on another day counts too.
// November is on GMT, so these UTC times are the venue's clock.
// ---------------------------------------------------------------------------

const TZ = "Europe/London";
const ms = (time: string, day = "14"): number => Date.parse(`2026-11-${day}T${time}:00.000Z`);
const SATURDAY = { date: "2026-11-14", dayBoundaryHour: 4, timeZone: TZ };
const GRAND_HALL = "00000000-0000-4000-8000-0000000000a1";

let p = 0;
/** A phase on the Diary, in the Grand Hall unless another room is named. */
function phase(eventId: string, eventName: string, name: string, fromMs: number, toMs: number, spaceId = GRAND_HALL): CalendarPhaseEntry {
  p += 1;
  return {
    entryType: "phase", id: `00000000-0000-4000-8000-${p.toString(16).padStart(12, "a")}`, spaceId, eventId, eventName, name,
    startsAt: new Date(fromMs).toISOString(), endsAt: new Date(toMs).toISOString(), sortOrder: p,
  };
}

/** A slot as deriveDayBoard makes it: a setup before its doors is a phase of its event. */
function slot(bookingId: string, title: string, setup: string, start: string, end: string, clear: string, days: { setup?: string; start?: string; end?: string } = {}, kind: DayBoardSlot["kind"] = "ink"): DayBoardSlot {
  const setupMs = ms(setup, days.setup ?? "14");
  const startMs = ms(start, days.start ?? days.setup ?? "14");
  const eventId = kind === "internal_block" || kind === "prospect" ? null : `event-${bookingId}`;
  const phases: readonly CalendarPhaseEntry[] = eventId !== null && setupMs < startMs ? [phase(eventId, title, "Setup", setupMs, startMs)] : [];
  return {
    bookingId, title, kind, roomId: GRAND_HALL, eventId, setupStartsAtMs: setupMs, startsAtMs: startMs, endsAtMs: ms(end, days.end ?? "14"),
    phases,
    segments: { setupStartsAtMs: setupMs, doorsAtMs: startMs, endsAtMs: ms(end, days.end ?? "14"), clearDownEndsAtMs: ms(clear, days.end ?? "14"), turnaroundMinutes: 60 },
  } as DayBoardSlot;
}

function lanes(...slots: DayBoardSlot[]): DayBoardLane[] {
  return [{ room: { id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }, slots }];
}

let n = 0;
function arrival(bookingId: string, name: string, arrives: string, leaves: string | null, overrides: Partial<SupplierArrival> = {}): SupplierArrival {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`, venueId: "00000000-0000-4000-8000-000000000001", bookingId,
    supplierName: name, category: null, arrivesAt: arrives, leavesBy: leaves, entrance: null, contact: null, note: null,
    arrivedAt: null, arrivedByName: null, leftAt: null, leftByName: null, revision: 1, updatedAt: "2026-11-14T09:00:00.000Z", ...overrides,
  };
}
const iso = (time: string, day = "14"): string => new Date(ms(time, day)).toISOString();

const EXHIBITION = slot("ex", "Glasgow Trades in Print", "09:00", "10:00", "17:00", "17:45", { setup: "12", end: "16" });

describe("buildingDay", () => {
  it("opens for the first setup and locks up after the last clear-down, past midnight", () => {
    const day = buildingDay(lanes(
      slot("breakfast", "Merchants' Breakfast", "07:00", "08:00", "10:00", "11:00"),
      slot("dinner", "Wedding dinner", "16:30", "18:30", "00:30", "01:30", { end: "15" }),
    ), [], SATURDAY);
    expect(day.openBy).toEqual({ atMs: ms("07:00"), why: "Merchants' Breakfast sets up" });
    expect(day.lockUpAfter).toEqual({ atMs: ms("01:30", "15"), why: "Wedding dinner clears" });
    expect([day.heldFrom, day.heldUntil, day.stillIn, day.longHolds]).toEqual([null, null, [], []]);
  });

  it("opens for a supplier due before any setup, whatever booking they come for", () => {
    const day = buildingDay(lanes(slot("dinner", "Wedding dinner", "16:30", "18:30", "23:00", "23:30")), [
      arrival("dinner", "Print Room Couriers", iso("06:30"), iso("07:00")),
      arrival("dinner", "The Kelvin Reelers", iso("20:30"), iso("00:45", "15")),
      // Staging for next Saturday's wedding, delivered today.
      arrival("next-week", "Clyde Staging", iso("06:00"), iso("06:45")),
    ], SATURDAY);
    expect(day.openBy).toEqual({ atMs: ms("06:00"), why: "Clyde Staging due" });
    expect(day.lockUpAfter).toEqual({ atMs: ms("00:45", "15"), why: "The Kelvin Reelers out" });
  });

  it("names whoever is marked in and not out, from before the day too, earliest in first", () => {
    const day = buildingDay(lanes(slot("dinner", "Wedding dinner", "16:30", "18:30", "23:00", "23:30")), [
      arrival("dinner", "In and out", iso("09:00"), null, { arrivedAt: iso("09:02"), arrivedByName: "Jamie", leftAt: iso("10:00"), leftByName: "Jamie" }),
      arrival("dinner", "Florist", iso("11:30"), iso("12:30"), { arrivedAt: iso("11:31"), arrivedByName: "Elaine" }),
      arrival("friday", "Night crew", iso("20:00", "13"), iso("23:00", "13"), { arrivedAt: iso("20:05", "13"), arrivedByName: "Ngozi" }),
    ], SATURDAY);
    expect(day.stillIn.map((item) => item.supplierName)).toEqual(["Night crew", "Florist"]);
  });

  it("leaves a house block out: a room taken out of use opens nothing", () => {
    const day = buildingDay(lanes(
      slot("block", "Out of use: floor repairs", "00:00", "00:00", "23:59", "23:59", {}, "internal_block"),
      slot("lunch", "Christening lunch", "11:00", "12:00", "16:00", "16:45"),
    ), [], SATURDAY);
    expect(day.openBy?.atMs).toBe(ms("11:00"));
    expect(day.lockUpAfter?.atMs).toBe(ms("16:45"));
  });

  it("says a provisional booking is provisional", () => {
    const day = buildingDay(lanes(slot("hold", "Burns supper", "17:00", "19:00", "23:00", "23:30", {}, "hold")), [], SATURDAY);
    expect(day.openBy?.why).toBe("Burns supper sets up (provisional)");
    expect(day.lockUpAfter?.why).toBe("Burns supper clears (provisional)");
  });

  describe("a booking that runs for days", () => {
    it("on its first day, opens for its setup and is named as running on", () => {
      const day = buildingDay(lanes(EXHIBITION, slot("lunch", "Trades lunch", "11:30", "12:00", "14:00", "14:30", { setup: "12", end: "12" })), [],
        { ...SATURDAY, date: "2026-11-12" });
      expect(day.openBy).toEqual({ atMs: ms("09:00", "12"), why: "Glasgow Trades in Print sets up" });
      // The lunch's own lock-up is still said; the exhibition's evening is its own.
      expect(day.lockUpAfter).toEqual({ atMs: ms("14:30", "12"), why: "Trades lunch clears" });
      expect(day.longHolds).toEqual([expect.objectContaining({ title: "Glasgow Trades in Print", startsToday: true, endsToday: false })]);
      expect([day.heldFrom, day.heldUntil]).toEqual([null, null]);
    });

    it("on a day in between, names it and keeps the day's own times, not the exhibition's", () => {
      const withDinner = buildingDay(lanes(EXHIBITION, slot("dinner", "Wedding dinner", "16:30", "18:30", "23:00", "23:30")), [], SATURDAY);
      expect(withDinner.openBy).toEqual({ atMs: ms("16:30"), why: "Wedding dinner sets up" });
      expect(withDinner.lockUpAfter).toEqual({ atMs: ms("23:30"), why: "Wedding dinner clears" });
      expect(withDinner.longHolds).toEqual([expect.objectContaining({ title: "Glasgow Trades in Print", startsToday: false, endsToday: false })]);
      // With nothing else on, there is nothing but the exhibition to say.
      const alone = buildingDay(lanes(EXHIBITION), [], SATURDAY);
      expect([alone.openBy, alone.lockUpAfter, alone.heldFrom, alone.heldUntil]).toEqual([null, null, null, null]);
      expect(alone.longHolds).toHaveLength(1);
    });

    it("on its last day, locks up after it clears, not after an earlier breakfast", () => {
      const day = buildingDay(lanes(EXHIBITION, slot("breakfast", "Breakfast meeting", "07:30", "08:00", "10:00", "10:45", { setup: "16", end: "16" })), [],
        { ...SATURDAY, date: "2026-11-16" });
      expect(day.openBy).toEqual({ atMs: ms("07:30", "16"), why: "Breakfast meeting sets up" });
      expect(day.lockUpAfter).toEqual({ atMs: ms("17:45", "16"), why: "Glasgow Trades in Print clears" });
      expect(day.longHolds).toEqual([expect.objectContaining({ endsToday: true })]);
    });
  });

  describe("a setup through the night", () => {
    // Its doors are the 14th's; its setup began the evening before.
    const built = slot("conf", "Trades conference", "22:00", "09:00", "17:00", "18:00", { setup: "13", start: "14" });

    it("holds the building open from the night before, rather than an evening dinner opening it", () => {
      const day = buildingDay(lanes(built, slot("dinner", "Wedding dinner", "16:30", "18:30", "23:00", "23:30")), [], SATURDAY);
      expect(day.openBy).toBeNull();
      expect(day.heldFrom).toMatchObject({ title: "Trades conference", setsUp: true, days: false });
      expect(day.lockUpAfter).toEqual({ atMs: ms("23:30"), why: "Wedding dinner clears" });
    });

    it("means no lock-up the night before", () => {
      const day = buildingDay(lanes(built, slot("dinner", "Friday dinner", "17:00", "19:00", "23:00", "23:30", { setup: "13", end: "13" })), [],
        { ...SATURDAY, date: "2026-11-13" });
      expect(day.openBy).toEqual({ atMs: ms("17:00", "13"), why: "Friday dinner sets up" });
      expect(day.lockUpAfter).toBeNull();
      expect(day.heldUntil).toMatchObject({ title: "Trades conference", setsUp: true });
    });
  });

  describe("tomorrow's booking, from tonight's phases", () => {
    // The 13th's board: its read holds the phases on the 13th, whatever day
    // their booking is, but not the booking itself, which is the 14th's.
    const FRIDAY = { ...SATURDAY, date: "2026-11-13" };
    const lunch = slot("lunch", "Friday lunch", "11:00", "12:00", "16:30", "17:30", { setup: "13", end: "13" });
    const CONFERENCE = "00000000-0000-4000-8000-0000000000e9";

    it("means no lock-up when tomorrow's setup runs through the night", () => {
      const setup = phase(CONFERENCE, "Trades conference", "Setup", ms("22:00", "13"), ms("09:00", "14"));
      const day = buildingDay(lanes(lunch), [], FRIDAY, [...lunch.phases, setup]);
      expect(day.lockUpAfter).toBeNull();
      expect(day.heldUntil).toMatchObject({ title: "Trades conference setup", setsUp: false, provisional: false });
    });

    it("locks up after tomorrow's setup tonight, not after the day's own last booking", () => {
      const setup = phase(CONFERENCE, "Trades conference", "Setup", ms("18:00", "13"), ms("22:00", "13"));
      const day = buildingDay(lanes(lunch), [], FRIDAY, [setup]);
      expect(day.lockUpAfter).toEqual({ atMs: ms("22:00", "13"), why: "Trades conference setup ends" });
      // On the 14th the setup is over before the day begins: the doors open it.
      const conference = { ...slot("conf", "Trades conference", "09:00", "09:00", "17:00", "18:00"), eventId: CONFERENCE };
      const saturday = buildingDay(lanes(conference), [], SATURDAY, []);
      expect([saturday.openBy, saturday.heldFrom]).toEqual([{ atMs: ms("09:00"), why: "Trades conference begins" }, null]);
    });

    it("leaves the building empty between a setup that ends in the small hours and the morning's doors", () => {
      const setup = phase(CONFERENCE, "Trades conference", "Setup", ms("23:00", "13"), ms("01:00", "14"));
      expect(buildingDay(lanes(lunch), [], FRIDAY, [setup]).lockUpAfter).toEqual({ atMs: ms("01:00", "14"), why: "Trades conference setup ends" });
      // The 14th's read holds that phase too, now beside its booking: it does not hold the building all night.
      const conference = { ...slot("conf", "Trades conference", "09:00", "09:00", "17:00", "18:00"), eventId: CONFERENCE, setupStartsAtMs: ms("23:00", "13"), phases: [setup] };
      const saturday = buildingDay(lanes(conference), [], SATURDAY, [setup]);
      expect(saturday.heldFrom).toBeNull();
      expect(saturday.openBy).toEqual({ atMs: ms("09:00"), why: "Trades conference begins" });
    });

    it("names a phase in a room its event has no booking in under the booking's title, provisional when it is", () => {
      const burns = slot("burns", "Burns supper", "17:00", "19:00", "23:00", "23:30", { setup: "13", end: "13" }, "hold");
      const piping = phase(burns.eventId ?? "", "Burns night", "Piping in", ms("18:00", "13"), ms("18:30", "13"), "00000000-0000-4000-8000-0000000000a2");
      const day = buildingDay(lanes(burns), [], FRIDAY, [...burns.phases, piping]);
      expect(day.openBy).toEqual({ atMs: ms("17:00", "13"), why: "Burns supper sets up (provisional)" });
      const strike = phase(burns.eventId ?? "", "Burns night", "Strike", ms("23:30", "13"), ms("00:30", "14"), "00000000-0000-4000-8000-0000000000a2");
      expect(buildingDay(lanes(burns), [], FRIDAY, [strike]).lockUpAfter).toEqual({ atMs: ms("00:30", "14"), why: "Burns supper strike ends (provisional)" });
      // Its event confirmed in another room: the phase is firm, whatever this booking is.
      expect(buildingDay(lanes(burns), [], FRIDAY, [{ ...strike, eventBooking: "ink" }]).lockUpAfter?.why).toBe("Burns supper strike ends");
    });

    // The review's case (a): Saturday's wedding is only held.
    it("says tomorrow's provisional booking is provisional in every sentence its phases tonight make", () => {
      const WEDDING = "00000000-0000-4000-8000-0000000000eb";
      const held = (from: number, to: number): CalendarPhaseEntry => ({ ...phase(WEDDING, "Campbell–Rao wedding", "Setup", from, to), eventBooking: "hold" });
      const night = buildingDay(lanes(lunch), [], FRIDAY, [...lunch.phases, held(ms("22:00", "13"), ms("09:00", "14"))]);
      expect(night.lockUpAfter).toBeNull();
      expect(night.heldUntil).toMatchObject({ title: "Campbell–Rao wedding setup", setsUp: false, provisional: true });
      const evening = buildingDay(lanes(lunch), [], FRIDAY, [held(ms("18:00", "13"), ms("21:00", "13"))]);
      expect(evening.lockUpAfter).toEqual({ atMs: ms("21:00", "13"), why: "Campbell–Rao wedding setup ends (provisional)" });
      const morning = buildingDay(lanes(lunch), [], FRIDAY, [held(ms("08:00", "13"), ms("10:00", "13"))]);
      expect(morning.openBy).toEqual({ atMs: ms("08:00", "13"), why: "Campbell–Rao wedding setup begins (provisional)" });
      // Running as a day begins (in a room its event has no booking in), it holds the building from before, provisionally.
      const saturday = buildingDay(lanes(), [], SATURDAY, [held(ms("22:00", "13"), ms("09:00", "14"))]);
      expect(saturday.heldFrom).toMatchObject({ title: "Campbell–Rao wedding setup", provisional: true });
    });

    // The review's case (b): an event the board shows nowhere.
    it("leaves out the phases of an event booked nowhere on the Diary: interest only, or a draft with no booking", () => {
      const PROSPECT = "00000000-0000-4000-8000-0000000000ec";
      const unbooked = (from: number, to: number): CalendarPhaseEntry => ({ ...phase(PROSPECT, "Campbell–Rao wedding", "Setup", from, to), eventBooking: null });
      const morning = buildingDay(lanes(lunch), [], FRIDAY, [...lunch.phases, unbooked(ms("08:00", "13"), ms("11:00", "13"))]);
      expect(morning.openBy).toEqual({ atMs: ms("11:00", "13"), why: "Friday lunch sets up" });
      const night = buildingDay(lanes(lunch), [], FRIDAY, [...lunch.phases, unbooked(ms("22:00", "13"), ms("09:00", "14"))]);
      expect([night.heldUntil, night.lockUpAfter]).toEqual([null, { atMs: ms("17:30", "13"), why: "Friday lunch clears" }]);
      // Alone on the day, it opens nothing at all.
      const alone = buildingDay(lanes(), [], FRIDAY, [unbooked(ms("08:00", "13"), ms("11:00", "13"))]);
      expect([alone.openBy, alone.lockUpAfter, alone.heldFrom, alone.heldUntil]).toEqual([null, null, null, null]);
    });

    it("reads a phase from an older server, which does not say how its event is booked, as before", () => {
      const older = phase("00000000-0000-4000-8000-0000000000ed", "Campbell–Rao wedding", "Setup", ms("08:00", "13"), ms("11:00", "13"));
      expect("eventBooking" in older).toBe(false);
      expect(buildingDay(lanes(lunch), [], FRIDAY, [...lunch.phases, older]).openBy).toEqual({ atMs: ms("08:00", "13"), why: "Campbell–Rao wedding setup begins" });
    });
  });

  it("keeps the building for a booking's own phase after it ends, such as its strike", () => {
    const dinner = slot("dinner", "Wedding dinner", "16:30", "18:30", "23:00", "23:30");
    const strike = phase(dinner.eventId ?? "", "Morrison wedding", "AV strike", ms("23:30"), ms("01:00", "15"));
    const day = buildingDay(lanes({ ...dinner, phases: [...dinner.phases, strike] }), [], SATURDAY, [...dinner.phases, strike]);
    expect(day.lockUpAfter).toEqual({ atMs: ms("01:00", "15"), why: "Wedding dinner AV strike ends" });
  });

  describe("the night's lock-up stays with the day it began", () => {
    const wedding = slot("wed", "Wedding dinner", "16:30", "18:30", "00:30", "01:15", { end: "15" });

    it("with a midnight boundary: Saturday locks up at 01:15, and Sunday does not", () => {
      const midnight = { ...SATURDAY, dayBoundaryHour: 0 };
      expect(buildingDay(lanes(wedding), [], midnight).lockUpAfter?.atMs).toBe(ms("01:15", "15"));
      const sunday = buildingDay(lanes(wedding, slot("lunch", "Christening lunch", "11:00", "12:00", "16:00", "16:45", { setup: "15", end: "15" })), [],
        { ...midnight, date: "2026-11-15" });
      expect(sunday.openBy).toEqual({ atMs: ms("11:00", "15"), why: "Christening lunch sets up" });
      expect(sunday.lockUpAfter).toEqual({ atMs: ms("16:45", "15"), why: "Christening lunch clears" });
      expect(sunday.heldFrom).toBeNull();
      // With nothing of its own, Sunday has no lock-up at all, not Saturday's.
      expect(buildingDay(lanes(wedding), [], { ...midnight, date: "2026-11-15" }).lockUpAfter).toBeNull();
    });

    it("with a 04:00 boundary: a ceilidh clearing at 04:30 is Saturday's lock-up, not Sunday's", () => {
      const ceilidh = slot("ceilidh", "Wedding ceilidh", "16:30", "18:30", "03:00", "04:30", { end: "15" });
      expect(buildingDay(lanes(ceilidh), [], SATURDAY).lockUpAfter?.atMs).toBe(ms("04:30", "15"));
      const sunday = buildingDay(lanes(ceilidh), [], { ...SATURDAY, date: "2026-11-15" });
      expect([sunday.openBy, sunday.lockUpAfter, sunday.heldFrom]).toEqual([null, null, null]);
    });
  });

  it("reads the venue's clock in summer", () => {
    // 16:00 to 23:00 BST is 15:00 to 22:00 UTC.
    const at = (iso: string): number => Date.parse(iso);
    const june = {
      ...slot("dinner", "Midsummer dinner", "16:00", "18:00", "22:30", "23:00"),
      setupStartsAtMs: at("2026-06-13T15:00:00.000Z"), startsAtMs: at("2026-06-13T17:00:00.000Z"), endsAtMs: at("2026-06-13T21:30:00.000Z"),
      phases: [phase("event-dinner", "Midsummer dinner", "Setup", at("2026-06-13T15:00:00.000Z"), at("2026-06-13T17:00:00.000Z"))],
      segments: { setupStartsAtMs: at("2026-06-13T15:00:00.000Z"), doorsAtMs: at("2026-06-13T17:00:00.000Z"), endsAtMs: at("2026-06-13T21:30:00.000Z"), clearDownEndsAtMs: at("2026-06-13T22:00:00.000Z"), turnaroundMinutes: 30 },
    };
    const day = buildingDay(lanes(june), [], { ...SATURDAY, date: "2026-06-13" });
    expect(day.openBy?.atMs).toBe(at("2026-06-13T15:00:00.000Z"));
    expect(day.lockUpAfter?.atMs).toBe(at("2026-06-13T22:00:00.000Z"));
  });
});
