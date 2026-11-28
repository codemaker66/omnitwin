import { describe, expect, it } from "vitest";
import type { HallkeeperSheetV2, ManifestRowV2, Timing } from "../hallkeeper-v2.js";
import type { EventInstructions } from "../hallkeeper-instructions.js";
import { crowdedTradesHallDay } from "../crowded-day.js";
import {
  careTables,
  formatTableLabels,
  accessNeeds,
  NO_TIME_TO_SET,
  allergyFacts,
  otherMeals,
  readyByWords,
  sheetNoteMarkers,
  sheetRunningOrder,
  sheetSetupSteps,
  sheetStoreList,
  setupFromWords,
  sheetClock,
  sheetIntervals,
  sheetTimes,
  venueZoneLabel,
} from "../sheet-brief.js";

// What the paper sheet derives from a hallkeeper sheet: the day in order,
// what to bring from the store, the setup steps and which plan marker a note
// carries. Screen and paper read these, so they say the same thing.

/** BST on Saturday 24 October 2026. */
const bst = (hour: number, minute = 0, dayOffset = 0): string =>
  new Date(Date.UTC(2026, 9, 24 + dayOffset, hour - 1, minute)).toISOString();

const EMPTY_INSTRUCTIONS: EventInstructions = {
  specialInstructions: "", dayOfContact: null, phaseDeadlines: [], accessNotes: "",
  accessibility: null, dietary: null, doorSchedule: null,
};

function row(partial: Partial<ManifestRowV2> & Pick<ManifestRowV2, "name" | "qty">): ManifestRowV2 {
  return { key: `${partial.name}|${String(partial.afterDepth ?? 0)}`, category: "table", afterDepth: 0, isAccessory: false, notes: "", positions: [], ...partial };
}

function sheet(partial: Partial<HallkeeperSheetV2> = {}): HallkeeperSheetV2 {
  return {
    config: { id: "6d1f8a52-3c1b-4f6e-9b1a-0a4c2b7e9d10", name: "Wedding", guestCount: 120, layoutStyle: "dinner-rounds" },
    venue: { name: "Trades Hall Glasgow", address: "85 Glassford Street", logoUrl: null, timezone: "Europe/London" },
    space: { name: "Grand Hall", widthM: 21, lengthM: 10.5, heightM: 7 },
    // setupBy is when the setup window opens (the field's name is historical).
    timing: { eventStart: bst(14, 30), setupBy: bst(8), bufferMinutes: 390 },
    instructions: null,
    phases: [],
    totals: { entries: [], totalRows: 0, totalItems: 0 },
    diagramUrl: null,
    floorPlan: null,
    webViewUrl: "https://venviewer.com/hallkeeper/x",
    generatedAt: bst(7, 42),
    approval: null,
    ...partial,
  };
}

const plannedObject = (id: number, name: string, category: string, x: number, z: number, extra: { label?: string; note?: string } = {}) => ({
  objectId: `00000000-0000-4000-8000-${id.toString(16).padStart(12, "0")}`,
  assetDefinitionId: "22222222-2222-4222-8222-222222222222",
  name, category, x, z, rotationY: 0, scale: 1, widthM: 1, depthM: 1, collisionType: "box" as const, ...extra,
});

describe("sheetRunningOrder", () => {
  const day = sheetRunningOrder(sheet({
    instructions: {
      ...EMPTY_INSTRUCTIONS,
      phaseDeadlines: [
        { phase: "structure", deadline: bst(10), reason: "Band loads in at 10:15" },
        { phase: "technical", deadline: bst(13, 45), reason: "" },
        { phase: "final", deadline: bst(13, 30), reason: "Florist done" },
      ],
      doorSchedule: { entries: [{ label: "Service door", events: [
        { at: bst(9), kind: "open", note: "Suppliers" },
        { at: bst(0, 30, 1), kind: "lock", note: "" },
      ] }] },
      protectedPremises: { briefingAt: bst(11, 30) },
    },
  }));

  it("puts every time of the day in order", () => {
    expect(day.map((line) => line.title)).toEqual([
      "Setup starts", "Service door opens", "Structure done", "Team briefing", "Room ready", "Technical done", "Guests in", "Service door locks",
    ]);
  });

  it("folds a final-touches deadline equal to the ready-by time into Room ready", () => {
    const ready = day.find((line) => line.title === "Room ready");
    expect(ready).toMatchObject({ emphasis: true, detail: "Florist done", late: false });
    expect(day.some((line) => line.title === "Final touches done")).toBe(false);
  });

  it("flags a phase deadline later than the ready-by time", () => {
    expect(day.find((line) => line.title === "Technical done")).toMatchObject({ late: true, detail: null });
    expect(day.find((line) => line.title === "Structure done")).toMatchObject({ late: false, detail: "Band loads in at 10:15" });
  });

  it("marks a time on the day after the event", () => {
    expect(day.find((line) => line.title === "Service door locks")?.otherDay).toBe(true);
    expect(day.find((line) => line.title === "Service door opens")?.otherDay).toBe(false);
  });

  it("marks a time on the day before the event too", () => {
    const before = sheetRunningOrder(sheet({ instructions: { ...EMPTY_INSTRUCTIONS, phaseDeadlines: [{ phase: "structure", deadline: bst(20, 0, -1), reason: "" }] } }));
    expect(before[0]).toMatchObject({ title: "Structure done", otherDay: true });
  });

  it("names the briefing's procedures", () => {
    expect(day.find((line) => line.title === "Team briefing")?.detail).toBe("Evacuation, invacuation, lockdown and communication");
  });

  it("has nothing to say without times or instructions", () => {
    expect(sheetRunningOrder(sheet({ timing: null }))).toEqual([]);
  });
});

// ------------------------------------------------- setup from, ready by ----
// Blake, 18 November 2026: "Setup from + Ready by". The sheet's timing.setupBy
// is when the setup window OPENS (the earliest room phase before the booking,
// or the booking start less the room's changeover time), and the booking's
// start is when guests come in, as the Day Board and the Diary read them.
// Ready by is the planner's typed final-touches time, else when guests come in.

/** GMT on Saturday 14 November 2026, the crowded day's default date. */
const gmt = (hour: number, minute = 0): string => new Date(Date.UTC(2026, 10, 14, hour, minute)).toISOString();

/** The crowded day's Grand Hall breakfast, timed as the sheet's data layer times it: the booking's
 *  start, and its Setup phase, which opens before the booking (07:00 for 08:00 doors). */
function crowdedBreakfastTiming(): Timing {
  const day = crowdedTradesHallDay();
  const booking = day.calendar.entries.find((entry) => entry.entryType === "booking" && entry.title === "Merchants' Breakfast Briefing");
  if (booking?.entryType !== "booking") throw new Error("the crowded day has a Grand Hall breakfast");
  const setup = day.calendar.entries.find((entry) => entry.entryType === "phase" && entry.eventId === booking.eventId && entry.spaceId === booking.spaceId);
  if (setup?.entryType !== "phase") throw new Error("the breakfast has a Setup phase in its room");
  return { eventStart: booking.startsAt, setupBy: setup.startsAt, bufferMinutes: 60 };
}

const final = (deadline: string, reason = ""): EventInstructions => ({ ...EMPTY_INSTRUCTIONS, phaseDeadlines: [{ phase: "final", deadline, reason }] });

describe("sheetTimes: one rule for every surface", () => {
  it("reads the crowded day's breakfast as setup from 07:00 and ready by 08:00, when guests come in", () => {
    const timing = crowdedBreakfastTiming();
    expect(timing).toEqual({ eventStart: gmt(8), setupBy: gmt(7), bufferMinutes: 60 });
    expect(sheetTimes({ timing, instructions: null })).toEqual({
      setupFrom: gmt(7), readyBy: gmt(8), guestsIn: gmt(8), readyFromPlanner: false, readyBeforeGuestsMinutes: 0, setupMinutes: 60, noTimeToSet: false,
    });
  });

  it("takes the planner's typed final-touches time as Ready by", () => {
    expect(sheetTimes({ timing: crowdedBreakfastTiming(), instructions: final(gmt(7, 45), "Speakers' table dressed") })).toEqual({
      setupFrom: gmt(7), readyBy: gmt(7, 45), guestsIn: gmt(8), readyFromPlanner: true, readyBeforeGuestsMinutes: 15, setupMinutes: 45, noTimeToSet: false,
    });
  });

  it("keeps a planner's final time later than guests come in, and says how much later", () => {
    const times = sheetTimes({ timing: crowdedBreakfastTiming(), instructions: final(gmt(8, 15)) });
    expect(times).toMatchObject({ readyBy: gmt(8, 15), guestsIn: gmt(8), readyFromPlanner: true, readyBeforeGuestsMinutes: -15 });
  });

  it("is ready when guests come in, with no setup time, when no phase or changeover time opens the window", () => {
    expect(sheetTimes({ timing: { eventStart: gmt(8), setupBy: null, bufferMinutes: null }, instructions: null })).toEqual({
      setupFrom: null, readyBy: gmt(8), guestsIn: gmt(8), readyFromPlanner: false, readyBeforeGuestsMinutes: 0, setupMinutes: null, noTimeToSet: false,
    });
  });

  it("knows no time without a booking, except a final time the planner typed", () => {
    expect(sheetTimes({ timing: null, instructions: null })).toEqual({
      setupFrom: null, readyBy: null, guestsIn: null, readyFromPlanner: false, readyBeforeGuestsMinutes: null, setupMinutes: null, noTimeToSet: false,
    });
    expect(sheetTimes({ timing: null, instructions: final(gmt(7, 45)) })).toEqual({
      setupFrom: null, readyBy: gmt(7, 45), guestsIn: null, readyFromPlanner: true, readyBeforeGuestsMinutes: null, setupMinutes: null, noTimeToSet: false,
    });
  });

  it("ignores the planner's other phases when finding Ready by", () => {
    const instructions: EventInstructions = { ...EMPTY_INSTRUCTIONS, phaseDeadlines: [{ phase: "technical", deadline: gmt(7, 50), reason: "" }] };
    expect(sheetTimes({ timing: crowdedBreakfastTiming(), instructions })).toMatchObject({ readyBy: gmt(8), readyFromPlanner: false });
  });

  it("words Ready by against guests coming in", () => {
    const at = (instructions: EventInstructions | null): string | null => readyByWords(sheetTimes({ timing: crowdedBreakfastTiming(), instructions }));
    expect(at(null)).toBe("when guests come in");
    expect(at(final(gmt(7, 45)))).toBe("15 min before guests come in");
    expect(at(final(gmt(8, 15)))).toBe("15 min after guests come in");
    expect(at(final(gmt(5, 30)))).toBe("2 h 30 min before guests come in");
    expect(at(final(gmt(6)))).toBe("2 h before guests come in");
    expect(readyByWords(sheetTimes({ timing: null, instructions: final(gmt(7, 45)) }))).toBeNull();
  });
});

describe("setupFromWords: the setup window in words", () => {
  it("gives the window's length, and says plainly when it leaves no time to set the room", () => {
    const at = (instructions: EventInstructions | null): string | null => setupFromWords(sheetTimes({ timing: crowdedBreakfastTiming(), instructions }));
    expect(at(null)).toBe("60 min to set the room");
    expect(at(final(gmt(7, 45)))).toBe("45 min to set the room");
    // A planner's final time at or before the window opens leaves no time: a
    // statement of fact in brick, never words a crew could take as an instruction.
    expect(at(final(gmt(7)))).toBe("No time to set the room");
    expect(at(final(gmt(6, 45)))).toBe("No time to set the room");
    expect(setupFromWords(sheetTimes({ timing: { eventStart: gmt(8), setupBy: null, bufferMinutes: null }, instructions: null }))).toBeNull();
  });
});

describe("sheetRunningOrder: setup starts, then the room is ready", () => {
  const breakfast = (instructions: EventInstructions | null): HallkeeperSheetV2 => sheet({ timing: crowdedBreakfastTiming(), instructions });
  const timed = (lines: ReturnType<typeof sheetRunningOrder>): string[] => lines.map((line) => `${line.at} ${line.title}`);

  it("prints the breakfast's setup at 07:00 and the room ready as guests come in at 08:00, never ready at 07:00", () => {
    const day = sheetRunningOrder(breakfast(null));
    expect(timed(day)).toEqual([`${gmt(7)} Setup starts`, `${gmt(8)} Room ready, guests in`]);
    expect(day[0]).toMatchObject({ emphasis: false, late: false });
    expect(day[1]).toMatchObject({ emphasis: true, late: false, afterGuests: false });
  });

  it("does not call a deadline before guests come in late, though it is after setup starts", () => {
    const day = sheetRunningOrder(breakfast({ ...EMPTY_INSTRUCTIONS, phaseDeadlines: [{ phase: "furniture", deadline: gmt(7, 30), reason: "" }] }));
    expect(day.find((line) => line.title === "Furniture done")).toMatchObject({ late: false });
  });

  it("puts the room ready at the planner's final time, and calls a deadline after it late", () => {
    const day = sheetRunningOrder(breakfast({ ...EMPTY_INSTRUCTIONS, phaseDeadlines: [
      { phase: "furniture", deadline: gmt(7, 30), reason: "" },
      { phase: "technical", deadline: gmt(7, 50), reason: "" },
      { phase: "final", deadline: gmt(7, 45), reason: "Speakers' table dressed" },
    ] }));
    expect(timed(day)).toEqual([
      `${gmt(7)} Setup starts`, `${gmt(7, 30)} Furniture done`, `${gmt(7, 45)} Room ready`, `${gmt(7, 50)} Technical done`, `${gmt(8)} Guests in`,
    ]);
    expect(day.find((line) => line.title === "Room ready")).toMatchObject({ detail: "Speakers' table dressed", emphasis: true, late: false });
    expect(day.find((line) => line.title === "Furniture done")?.late).toBe(false);
    expect(day.find((line) => line.title === "Technical done")?.late).toBe(true);
  });

  it("shows a planner's final time after guests come in where it falls, marked late against them", () => {
    const day = sheetRunningOrder(breakfast(final(gmt(8, 15))));
    expect(timed(day)).toEqual([`${gmt(7)} Setup starts`, `${gmt(8)} Guests in`, `${gmt(8, 15)} Room ready`]);
    expect(day[2]).toMatchObject({ late: true, afterGuests: true, emphasis: true });
  });

  it("is ready as guests come in, with no setup line, when no changeover time is recorded", () => {
    const day = sheetRunningOrder(sheet({ timing: { eventStart: gmt(8), setupBy: null, bufferMinutes: null } }));
    expect(timed(day)).toEqual([`${gmt(8)} Room ready, guests in`]);
  });
});

describe("sheetSetupSteps: late against Ready by", () => {
  const steps = (instructions: EventInstructions): ReturnType<typeof sheetSetupSteps> => sheetSetupSteps(sheet({
    timing: crowdedBreakfastTiming(),
    instructions,
    phases: [
      { phase: "furniture", zones: [{ zone: "Centre", rows: [row({ name: "6ft Round Table", qty: 12 })] }] },
      { phase: "technical", zones: [{ zone: "North wall", rows: [row({ name: "Lectern", category: "lectern", qty: 1 })] }] },
    ],
  }));

  it("does not mark a step due between setup starting and guests coming in late", () => {
    expect(steps({ ...EMPTY_INSTRUCTIONS, phaseDeadlines: [{ phase: "furniture", deadline: gmt(7, 30), reason: "" }] })[0]?.deadline?.late).toBe(false);
  });

  it("marks a step due after the planner's final time late", () => {
    const due = steps({ ...EMPTY_INSTRUCTIONS, phaseDeadlines: [
      { phase: "furniture", deadline: gmt(7, 30), reason: "" },
      { phase: "technical", deadline: gmt(7, 50), reason: "" },
      { phase: "final", deadline: gmt(7, 45), reason: "" },
    ] });
    expect(due.map((step) => step.deadline?.late)).toEqual([false, true]);
  });
});

// ------------------------------------------------- #454 review, round 1 ----
// One rule on every surface: the release lead's round-1 findings on #454.

describe("sheetClock: a time led by its weekday off the guests' day (#454 YB3)", () => {
  it("prints the clock alone on the guests' day, and leads with the weekday on another", () => {
    // Setup the evening before: Friday 16:00 for Saturday's 08:00 doors.
    expect(sheetClock(new Date(Date.UTC(2026, 10, 13, 16)).toISOString(), gmt(8), "Europe/London")).toBe("Fri 16:00");
    expect(sheetClock(gmt(7), gmt(8), "Europe/London")).toBe("07:00");
    expect(sheetClock(new Date(Date.UTC(2026, 10, 15, 0, 10)).toISOString(), gmt(8), "Europe/London")).toBe("Sun 00:10");
    // No booking gives the guests' day: the clock alone.
    expect(sheetClock(gmt(7), null, "Europe/London")).toBe("07:00");
  });

  it("reads the venue's day, not the instant's UTC date", () => {
    // 23:30 UTC on Friday 2 October is 00:30 on Saturday the 3rd in a British summer.
    expect(sheetClock("2026-10-02T23:30:00.000Z", "2026-10-03T17:30:00.000Z", "Europe/London")).toBe("00:30");
    expect(sheetClock("2026-10-02T22:30:00.000Z", "2026-10-03T17:30:00.000Z", "Europe/London")).toBe("Fri 23:30");
  });
});

describe("No time to set the room: one condition, one wording (#454 YA5)", () => {
  const at = (deadline: string): ReturnType<typeof sheetTimes> => sheetTimes({ timing: crowdedBreakfastTiming(), instructions: final(deadline) });

  it("holds when setup opens at or after Ready by, and is said as a fact", () => {
    expect(NO_TIME_TO_SET).toBe("No time to set the room");
    expect(at(gmt(7))).toMatchObject({ setupMinutes: 0, noTimeToSet: true });
    expect(at(gmt(6, 45))).toMatchObject({ setupMinutes: -15, noTimeToSet: true });
    expect(at(gmt(7, 45))).toMatchObject({ setupMinutes: 45, noTimeToSet: false });
    expect(setupFromWords(at(gmt(6, 45)))).toBe(NO_TIME_TO_SET);
    // No setup start, no window to judge.
    expect(sheetTimes({ timing: { eventStart: gmt(8), setupBy: null, bufferMinutes: null }, instructions: final(gmt(6, 45)) }).noTimeToSet).toBe(false);
  });

  it("reads the same condition from the three instants the Day Board's summary carries", () => {
    expect(sheetIntervals({ setupFrom: gmt(7), readyBy: gmt(6, 45), guestsIn: gmt(8) })).toEqual({ readyBeforeGuestsMinutes: 75, setupMinutes: -15, noTimeToSet: true });
    expect(sheetIntervals({ setupFrom: gmt(7), readyBy: gmt(8), guestsIn: gmt(8) })).toEqual({ readyBeforeGuestsMinutes: 0, setupMinutes: 60, noTimeToSet: false });
    expect(sheetIntervals({ setupFrom: null, readyBy: gmt(8, 15), guestsIn: gmt(8) })).toEqual({ readyBeforeGuestsMinutes: -15, setupMinutes: null, noTimeToSet: false });
    expect(sheetIntervals({ setupFrom: gmt(7), readyBy: null, guestsIn: null })).toEqual({ readyBeforeGuestsMinutes: null, setupMinutes: null, noTimeToSet: false });
  });

  it("flags the day's Room ready when it falls at or before Setup starts, and nothing else", () => {
    const timed = (lines: ReturnType<typeof sheetRunningOrder>): string[] => lines.map((line) => `${line.at} ${line.title}`);
    const early = sheetRunningOrder(sheet({ timing: crowdedBreakfastTiming(), instructions: final(gmt(6, 45)) }));
    expect(timed(early)).toEqual([`${gmt(6, 45)} Room ready`, `${gmt(7)} Setup starts`, `${gmt(8)} Guests in`]);
    expect(early[0]).toMatchObject({ emphasis: true, noTimeToSet: true, late: false });
    expect(early.slice(1).map((line) => line.noTimeToSet)).toEqual([false, false]);
    const same = sheetRunningOrder(sheet({ timing: crowdedBreakfastTiming(), instructions: final(gmt(7)) }));
    expect(timed(same)).toEqual([`${gmt(7)} Setup starts`, `${gmt(7)} Room ready`, `${gmt(8)} Guests in`]);
    expect(same[1]?.noTimeToSet).toBe(true);
    expect(sheetRunningOrder(sheet({ timing: crowdedBreakfastTiming(), instructions: final(gmt(7, 45)) })).some((line) => line.noTimeToSet)).toBe(false);
  });
});

describe("minutes as the clock prints them, and the earliest final time (#454 YA10)", () => {
  const at = (h: number, m: number, s: number): string => new Date(Date.UTC(2026, 10, 14, h, m, s)).toISOString();

  it("counts minutes between instants floored to the minute, as the clock prints them", () => {
    // 07:00:30 prints 07:00, as setup opens: no time to set the room, never "1 min".
    expect(sheetTimes({ timing: crowdedBreakfastTiming(), instructions: final(at(7, 0, 30)) })).toMatchObject({ setupMinutes: 0, noTimeToSet: true, readyBeforeGuestsMinutes: 60 });
    // 08:00:40 prints 08:00, as guests come in: one moment, never "1 min after".
    expect(sheetTimes({ timing: crowdedBreakfastTiming(), instructions: final(at(8, 0, 40)) }).readyBeforeGuestsMinutes).toBe(0);
    const day = sheetRunningOrder(sheet({ timing: crowdedBreakfastTiming(), instructions: final(at(8, 0, 40)) }));
    expect(day.map((line) => line.title)).toEqual(["Setup starts", "Room ready, guests in"]);
    expect(day[1]).toMatchObject({ late: false, afterGuests: false });
  });

  it("does not call a deadline late that prints as the ready-by minute", () => {
    const day = sheetRunningOrder(sheet({ timing: crowdedBreakfastTiming(), instructions: { ...EMPTY_INSTRUCTIONS, phaseDeadlines: [{ phase: "technical", deadline: at(8, 0, 30), reason: "" }] } }));
    expect(day.find((line) => line.title === "Technical done")).toMatchObject({ late: false, afterGuests: false });
  });

  it("takes the earliest final-touches time as Ready by, whatever order the planner listed them in", () => {
    const instructions: EventInstructions = { ...EMPTY_INSTRUCTIONS, phaseDeadlines: [
      { phase: "final", deadline: gmt(7, 50), reason: "Candles lit" },
      { phase: "final", deadline: gmt(7, 40), reason: "Speakers' table dressed" },
    ] };
    const breakfast = sheet({ timing: crowdedBreakfastTiming(), instructions, phases: [{ phase: "final", zones: [{ zone: "Centre", rows: [row({ name: "Candle", category: "decor", qty: 10 })] }] }] });
    expect(sheetTimes(breakfast)).toMatchObject({ readyBy: gmt(7, 40), readyBeforeGuestsMinutes: 20 });
    const day = sheetRunningOrder(breakfast);
    expect(day.map((line) => `${line.at} ${line.title}`)).toEqual([`${gmt(7)} Setup starts`, `${gmt(7, 40)} Room ready`, `${gmt(7, 50)} Final touches done`, `${gmt(8)} Guests in`]);
    expect(day[1]?.detail).toBe("Speakers' table dressed");
    expect(day[2]).toMatchObject({ late: true, afterGuests: false, detail: "Candles lit" });
    expect(sheetSetupSteps(breakfast)[0]?.deadline).toMatchObject({ at: gmt(7, 40), late: false });
  });
});

describe("an unreadable deadline is skipped everywhere, as sheetTimes skips it (#454 YA11)", () => {
  const instructions = { ...EMPTY_INSTRUCTIONS, phaseDeadlines: [
    { phase: "final", deadline: "garbage", reason: "" },
    { phase: "technical", deadline: gmt(7, 50), reason: "" },
  ] } as EventInstructions;
  const breakfast = sheet({ timing: crowdedBreakfastTiming(), instructions, phases: [
    { phase: "technical", zones: [{ zone: "North wall", rows: [row({ name: "Lectern", category: "lectern", qty: 1 })] }] },
    { phase: "final", zones: [{ zone: "Centre", rows: [row({ name: "Candle", category: "decor", qty: 10 })] }] },
  ] });

  it("prints the day without it, rather than failing the sheet", () => {
    expect(sheetRunningOrder(breakfast).map((line) => `${line.at} ${line.title}`)).toEqual([`${gmt(7)} Setup starts`, `${gmt(7, 50)} Technical done`, `${gmt(8)} Room ready, guests in`]);
  });

  it("leaves its step without a deadline", () => {
    expect(sheetSetupSteps(breakfast).map((step) => step.deadline?.at ?? null)).toEqual([gmt(7, 50), null]);
  });
});

describe("a deadline after the doors, before a late Ready by, reads as after guests come in (#454 YB6)", () => {
  const breakfast = (technical: string): HallkeeperSheetV2 => sheet({
    timing: crowdedBreakfastTiming(),
    instructions: { ...EMPTY_INSTRUCTIONS, phaseDeadlines: [{ phase: "final", deadline: gmt(8, 15), reason: "" }, { phase: "technical", deadline: technical, reason: "" }] },
    phases: [{ phase: "technical", zones: [{ zone: "North wall", rows: [row({ name: "Lectern", category: "lectern", qty: 1 })] }] }],
  });

  it("marks it in the day and on its step", () => {
    expect(sheetRunningOrder(breakfast(gmt(8, 10))).find((line) => line.title === "Technical done")).toMatchObject({ late: true, afterGuests: true });
    expect(sheetSetupSteps(breakfast(gmt(8, 10)))[0]?.deadline).toMatchObject({ late: true, afterGuests: true });
  });

  it("keeps a deadline after that Ready by late against it, and one before the doors on time", () => {
    expect(sheetRunningOrder(breakfast(gmt(8, 20))).find((line) => line.title === "Technical done")).toMatchObject({ late: true, afterGuests: false });
    expect(sheetSetupSteps(breakfast(gmt(8, 20)))[0]?.deadline).toMatchObject({ late: true, afterGuests: false });
    expect(sheetRunningOrder(breakfast(gmt(7, 50))).find((line) => line.title === "Technical done")).toMatchObject({ late: false, afterGuests: false });
    expect(sheetSetupSteps(breakfast(gmt(7, 50)))[0]?.deadline).toMatchObject({ late: false, afterGuests: false });
  });
});

describe("sheetStoreList", () => {
  it("counts placed pieces from the frozen plan and implied linen from the rows", () => {
    const chairs = Array.from({ length: 120 }, (_, i) => plannedObject(100 + i, "Chiavari Wedding Chair", "chair", 0, 0));
    const tables = Array.from({ length: 11 }, (_, i) => plannedObject(10 + i, "6ft Round Table", "table", 0, 0));
    const store = sheetStoreList(sheet({
      floorPlan: { coordinateSpace: "real_m_v1", outline: [{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }], objects: [...tables, ...chairs, plannedObject(1, "Folding Room Divider", "other", 0, 0)] },
      phases: [{ phase: "dress", zones: [{ zone: "Centre", rows: [row({ name: "Black Round Table Linen", category: "decor", qty: 11, isAccessory: true })] }] }],
    }));
    expect(store.map((group) => group.title)).toEqual(["Tables", "Chairs", "Linen and dressing", "Bar, service and other"]);
    expect(store[1]?.items).toEqual([{ name: "Chiavari Wedding Chair", qty: 120 }]);
    expect(store[2]?.items).toEqual([{ name: "Black Round Table Linen", qty: 11 }]);
    expect(store[3]?.items).toEqual([{ name: "Folding Room Divider", qty: 1 }]);
  });

  it("falls back to the manifest totals when a sheet was frozen without a plan", () => {
    const store = sheetStoreList(sheet({ totals: { entries: [{ name: "Lectern", category: "lectern", qty: 1 }], totalRows: 1, totalItems: 1 } }));
    expect(store).toEqual([{ title: "Sound and vision", items: [{ name: "Lectern", qty: 1 }] }]);
  });

  it("still brings the chairs set at tables when a sheet was frozen without a plan", () => {
    const store = sheetStoreList(sheet({ totals: { entries: [
      { name: "6ft Round Table with 10 chairs", category: "table", qty: 11 },
      { name: "Trestle Table with 4 chairs", category: "table", qty: 3 },
      { name: "Chiavari Wedding Chair", category: "chair", qty: 6 },
    ], totalRows: 3, totalItems: 20 } }));
    expect(store).toEqual([
      { title: "Tables", items: [{ name: "6ft Round Table", qty: 11 }, { name: "Trestle Table", qty: 3 }] },
      { title: "Chairs", items: [{ name: "Chairs for the tables", qty: 122 }, { name: "Chiavari Wedding Chair", qty: 6 }] },
    ]);
  });

  // Before T-672 the generator gave every piece in a group the group's whole chair count.
  it("splits only a table's row, so a piece grouped at a table does not count the group's chairs again", () => {
    const store = sheetStoreList(sheet({ totals: { entries: [
      { name: "6ft Round Table with 10 chairs", category: "table", qty: 1 },
      { name: "Table Centrepiece with 10 chairs", category: "decor", qty: 1 },
    ], totalRows: 2, totalItems: 2 } }));
    expect(store).toEqual([
      { title: "Tables", items: [{ name: "6ft Round Table", qty: 1 }] },
      { title: "Chairs", items: [{ name: "Chairs for the tables", qty: 10 }] },
      { title: "Linen and dressing", items: [{ name: "Table Centrepiece with 10 chairs", qty: 1 }] },
    ]);
  });

  it("counts an old copy's grouped tables' chairs once per table, as its setup list does: the copy cannot say whose they were", () => {
    const store = sheetStoreList(sheet({ totals: { entries: [{ name: "Trestle Table with 10 chairs", category: "table", qty: 2 }], totalRows: 1, totalItems: 2 } }));
    expect(store).toEqual([
      { title: "Tables", items: [{ name: "Trestle Table", qty: 2 }] },
      { title: "Chairs", items: [{ name: "Chairs for the tables", qty: 20 }] },
    ]);
  });
});

describe("sheetSetupSteps", () => {
  const steps = sheetSetupSteps(sheet({
    phases: [
      { phase: "structure", zones: [
        { zone: "East wall", rows: [row({ name: "Parquet Dance Floor Panel", category: "stage", qty: 10 })] },
        { zone: "Perimeter", rows: [row({ name: "Parquet Dance Floor Panel", category: "stage", qty: 16 })] },
        { zone: "Centre", rows: [row({ name: "Parquet Dance Floor Panel", category: "stage", qty: 4 })] },
      ] },
      { phase: "furniture", zones: [
        { zone: "Centre", rows: [row({ name: "6ft Round Table with 10 chairs", qty: 6, notes: "Table 5: peanut allergy · Table 3: wheelchair" })] },
        { zone: "South wall", rows: [row({ name: "6ft Round Table with 10 chairs", qty: 5 })] },
        { zone: "North wall", rows: [
          row({ name: "Trestle Table (White Cloth) with 3 chairs", qty: 2 }),
          row({ name: "Trestle Table (White Cloth) with 4 chairs", qty: 1 }),
        ] },
      ] },
      { phase: "final", zones: [
        { zone: "Centre", rows: [row({ name: "Black Round Table Linen", category: "decor", qty: 6, isAccessory: true, notes: "Table 5: peanut allergy" })] },
      ] },
    ],
    instructions: { ...EMPTY_INSTRUCTIONS, phaseDeadlines: [{ phase: "structure", deadline: bst(10), reason: "Band at 10:15" }] },
  }));

  it("merges one item across zones, busiest zone first", () => {
    expect(steps[0]?.items).toEqual([{
      name: "Parquet Dance Floor Panel", qty: 30, chairs: null, seats: null, accessory: false, notes: [],
      where: [{ zone: "Perimeter", qty: 16 }, { zone: "East wall", qty: 10 }, { zone: "Centre", qty: 4 }],
      labels: [],
    }]);
    expect(steps[0]?.deadline).toEqual({ at: bst(10), reason: "Band at 10:15", late: false, afterGuests: false, otherDay: false });
  });

  it("reads the chairs at the tables out of the generator's names, onto a line of their own after the tables", () => {
    const furniture = steps[1]?.items ?? [];
    expect(furniture.map((item) => [item.name, item.qty])).toEqual([["6ft Round Table", 11], ["Trestle Table (White Cloth)", 3], ["Chairs for the tables", 120]]);
    // The tables keep their own chairs too, for a setup short enough to print them on the tables' lines.
    expect(furniture.slice(0, 2).map((item) => [item.chairs, item.seats])).toEqual([[{ total: 110, each: 10 }, null], [{ total: 10, each: null }, null]]);
    // No plan here, so the tables are named by their own lines, with their count, and the chairs by what they are for.
    expect(furniture[2]).toMatchObject({
      chairs: null,
      seats: [{ qty: 110, each: 10, tables: "11\u00A0× 6ft Round Table" }, { qty: 10, each: null, tables: "3\u00A0× Trestle Table (White Cloth)" }],
      where: [], labels: [], notes: [], accessory: false,
    });
  });

  it("prints a note once, where it first belongs", () => {
    expect(steps[1]?.items[0]?.notes).toEqual(["Table 5: peanut allergy", "Table 3: wheelchair"]);
    expect(steps[2]?.items[0]?.notes).toEqual([]);
  });

  it("counts chairs in all when some merged tables have none", () => {
    const mixed = sheetSetupSteps(sheet({ phases: [{ phase: "furniture", zones: [
      { zone: "Centre", rows: [row({ name: "6ft Round Table with 10 chairs", qty: 3 })] },
      { zone: "Perimeter", rows: [row({ name: "6ft Round Table", qty: 2 })] },
    ] }] }));
    expect(mixed[0]?.items[0]).toMatchObject({ name: "6ft Round Table", qty: 5, chairs: { total: 30, each: null }, seats: null });
    expect(mixed[0]?.items[1]).toMatchObject({ name: "Chairs for the tables", qty: 30, seats: [{ qty: 30, each: null, tables: "5\u00A0× 6ft Round Table" }] });
  });

  it("dates a phase deadline on another day than the event's", () => {
    const early = sheetSetupSteps(sheet({
      phases: [{ phase: "structure", zones: [{ zone: "Centre", rows: [row({ name: "Platform", qty: 2 })] }] }],
      instructions: { ...EMPTY_INSTRUCTIONS, phaseDeadlines: [{ phase: "structure", deadline: bst(20, 0, -1), reason: "" }] },
    }));
    expect(early[0]?.deadline).toMatchObject({ otherDay: true });
    expect(steps[0]?.deadline?.otherDay).toBe(false);
  });

  it("labels steps in sentence case", () => {
    expect(steps.map((step) => step.label)).toEqual(["Structure", "Furniture", "Final touches"]);
  });
});

describe("sheetSetupSteps: the chairs set at the tables, on a line of their own", () => {
  // The wedding's shape: eleven numbered rounds of ten; a top table of three trestles end to end seating 3, 4 and
  // 3, the middle one named; a cake table; and six chairs in a row of their own that seat no table.
  const labels = Array.from({ length: 11 }, (_, n) => `Table ${String(n + 1)}`);
  const rounds = labels.map((label, n) => plannedObject(1 + n, "6ft Round Table", "table", n, 0, { label }));
  const trestles = [20, 21, 22].map((id, n) => plannedObject(id, "Trestle Table (White Cloth)", "table", n, -4, n === 1 ? { label: "Top table" } : {}));
  type Planned = ReturnType<typeof plannedObject>;
  const chairs = (model: string, from: number, count: number, notes: Readonly<Record<number, string>> = {}): Planned[] =>
    Array.from({ length: count }, (_, n) => plannedObject(from + n, model, "chair", n * 0.5, 1, notes[n] === undefined ? {} : { note: notes[n] }));
  const inRow = chairs("Chiavari Wedding Chair", 900, 6);
  const at = (objects: readonly Planned[]) => objects.map(({ objectId, x, z }) => ({ objectId, x, z, rotationY: 0 }));
  const setUp = (seated: readonly Planned[]) => sheetSetupSteps(sheet({
    floorPlan: { coordinateSpace: "real_m_v1", outline: [{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }], objects: [...rounds, ...trestles, ...seated, ...inRow] },
    phases: [
      { phase: "furniture", zones: [
        { zone: "Centre", rows: [row({ name: "6ft Round Table with 10 chairs", qty: 11, labels, positions: at(rounds) })] },
        { zone: "North wall", rows: [
          row({ name: "Trestle Table (White Cloth) with 3 chairs", qty: 2, positions: at(trestles.filter((_, n) => n !== 1)) }),
          row({ name: "Trestle Table (White Cloth) with 4 chairs", qty: 1, labels: ["Top table"], positions: at(trestles.slice(1, 2)) }),
          row({ name: "Cake Cutting Table", qty: 1 }),
        ] },
        { zone: "Perimeter", rows: [row({ name: "Chiavari Wedding Chair", category: "chair", qty: 6, positions: at(inRow) })] },
      ] },
      // A sash on every seated chair: an accessory row may list the chairs it dresses, which stay seated.
      { phase: "dress", zones: [{ zone: "Centre", rows: [row({ name: "Ivory Chair Sash", category: "decor", qty: 120, isAccessory: true, positions: at(seated) })] }] },
    ],
  }));

  it("follows the tables with how many chairs go to which tables, named as their lines name them", () => {
    const [furniture] = setUp(chairs("Chiavari Wedding Chair", 100, 120));
    expect(furniture?.items.map((item) => [item.name, item.qty])).toEqual([
      ["6ft Round Table", 11], ["Trestle Table (White Cloth)", 3], ["Chiavari Wedding Chair", 120], ["Cake Cutting Table", 1], ["Chiavari Wedding Chair", 6],
    ]);
    expect(furniture?.items[2]?.seats).toEqual([{ qty: 110, each: 10, tables: "Tables 1–11" }, { qty: 10, each: null, tables: "Top table" }]);
    expect(furniture?.items.filter((item) => item.seats !== null)).toHaveLength(1);
  });

  it("names the chairs by their model only when the plan seats one model, as many as the tables' lines count", () => {
    const [mixed] = setUp([...chairs("Chiavari Wedding Chair", 100, 110), ...chairs("Banquet Chair", 300, 10)]);
    expect(mixed?.items[2]).toMatchObject({ name: "Chairs for the tables", qty: 120 });
    const [short] = setUp(chairs("Chiavari Wedding Chair", 100, 118));
    expect(short?.items[2]).toMatchObject({ name: "Chairs for the tables", qty: 120 });
  });

  it("sets the tables that seat chairs first, then their chairs, then the step's other pieces in their order", () => {
    // The generator's zone order can put a cake table and a lectern between the rounds and the top table.
    const [furniture] = sheetSetupSteps(sheet({ phases: [{ phase: "furniture", zones: [
      { zone: "Centre", rows: [row({ name: "6ft Round Table with 10 chairs", qty: 11 })] },
      { zone: "North wall", rows: [
        row({ name: "Cake Cutting Table", qty: 1 }),
        row({ name: "Lectern", category: "lectern", qty: 1 }),
        row({ name: "Trestle Table (White Cloth) with 3 chairs", qty: 3 }),
      ] },
    ] }] }));
    expect(furniture?.items.map((item) => item.name)).toEqual(["6ft Round Table", "Trestle Table (White Cloth)", "Chairs for the tables", "Cake Cutting Table", "Lectern"]);
  });

  it("seats chairs only on a table's line, so a piece an old copy grouped at a table adds none", () => {
    const [furniture] = sheetSetupSteps(sheet({ phases: [{ phase: "furniture", zones: [{ zone: "Centre", rows: [
      row({ name: "6ft Round Table with 10 chairs", qty: 1 }),
      row({ name: "Table Centrepiece with 10 chairs", category: "decor", qty: 1 }),
    ] }] }] }));
    expect(furniture?.items.map((item) => [item.name, item.qty])).toEqual([["6ft Round Table", 1], ["Chairs for the tables", 10], ["Table Centrepiece with 10 chairs", 1]]);
  });

  it("carries the seated chairs' notes on that line, each once", () => {
    const notes = { 3: "Seat 4 at table 5: peanut allergy", 40: "Seat 1 at table 9: coeliac", 41: "Seat 4 at table 5: peanut allergy" };
    const [furniture] = setUp(chairs("Chiavari Wedding Chair", 100, 120, notes));
    expect(furniture?.items[2]?.notes).toEqual(["Seat 4 at table 5: peanut allergy", "Seat 1 at table 9: coeliac"]);
    expect(furniture?.items.flatMap((item) => item.notes)).toEqual(["Seat 4 at table 5: peanut allergy", "Seat 1 at table 9: coeliac"]);
  });
});

// #443's review (18 Nov 2026): a seat entry names only tables its line counts (HG2), and gives the count at each
// table only where its place holds more than one table that seats it (HG3).
describe("sheetSetupSteps: where the chairs go names every table it counts", () => {
  /** A planned piece, a round table's footprint a circle. */
  type Planned = Omit<ReturnType<typeof plannedObject>, "collisionType"> & { readonly collisionType: "box" | "cylinder" };
  const at = (objects: readonly Planned[]) => objects.map(({ objectId, x, z }) => ({ objectId, x, z, rotationY: 0 }));
  const round = (id: number, x: number, label?: string): Planned =>
    ({ ...plannedObject(id, "6ft Round Table", "table", x, 0, label === undefined ? {} : { label }), widthM: 1.83, depthM: 1.83, collisionType: "cylinder" as const });
  const trestle = (id: number, x: number, label?: string): Planned =>
    ({ ...plannedObject(id, "Trestle Table (White Cloth)", "table", x, -4, label === undefined ? {} : { label }), widthM: 1.83, depthM: 0.76 });
  const outline = [{ x: -5, z: -6 }, { x: 40, z: -6 }, { x: 40, z: 6 }, { x: -5, z: 6 }];
  /** One step's seat entries: the tables' rows as the generator writes them, their pieces on the plan (or no plan). */
  const seatsOf = (pieces: readonly Planned[] | null, rows: readonly ManifestRowV2[]) =>
    sheetSetupSteps(sheet({
      floorPlan: pieces === null ? null : { coordinateSpace: "real_m_v1", outline, objects: [...pieces] },
      phases: [{ phase: "furniture", zones: [{ zone: "Centre", rows: [...rows] }] }],
    }))[0]?.items.find((item) => item.seats !== null)?.seats;
  /** Eleven rounds of ten, three metres apart, the planner having named the numbers given. */
  const elevenRounds = (named: readonly number[]) => {
    const pieces = Array.from({ length: 11 }, (_, n) => round(1 + n, n * 3, named.includes(n + 1) ? `Table ${String(n + 1)}` : undefined));
    const labels = pieces.flatMap((piece) => (piece.label === undefined ? [] : [piece.label]));
    return seatsOf(pieces, [row({ name: "6ft Round Table with 10 chairs", qty: 11, positions: at(pieces), ...(labels.length > 0 ? { labels } : {}) })]);
  };

  it("names the tables by their line, with its count, when the planner named one of eleven, five of eleven or none", () => {
    for (const named of [[5], [1, 2, 3, 4, 5], []]) {
      expect(elevenRounds(named), `named: ${named.join(", ")}`).toEqual([{ qty: 110, each: 10, tables: "11\u00A0× 6ft Round Table" }]);
    }
    expect(elevenRounds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toEqual([{ qty: 110, each: 10, tables: "Tables 1–11" }]);
  });

  it("lets a name cover the trestles standing end to end with the named one, as a top table, and no others", () => {
    const rows = (pieces: readonly Planned[]) => [
      row({ name: "Trestle Table (White Cloth) with 3 chairs", qty: 2, positions: at([pieces[0], pieces[2]].filter((piece): piece is Planned => piece !== undefined)) }),
      row({ name: "Trestle Table (White Cloth) with 4 chairs", qty: 1, labels: ["Top table"], positions: at(pieces.slice(1, 2)) }),
    ];
    const endToEnd = [trestle(20, -1.85), trestle(21, 0, "Top table"), trestle(22, 1.85)];
    expect(seatsOf(endToEnd, rows(endToEnd))).toEqual([{ qty: 10, each: null, tables: "Top table" }]);
    // The same three trestles set apart: the name covers its own trestle only, so the line counts them.
    const apart = [trestle(20, -6), trestle(21, 0, "Top table"), trestle(22, 6)];
    expect(seatsOf(apart, rows(apart))).toEqual([{ qty: 10, each: null, tables: "3\u00A0× Trestle Table (White Cloth)" }]);
  });

  // #443's second review, ruling (1): the seat note's own rule, in metres (not the plan's, which works on the page).
  /** A trestle standing where given, turned `rotationY` from across the room, named when `label` is given. */
  const trestleAt = (id: number, x: number, z: number, label?: string, rotationY = 0): Planned => ({ ...trestle(id, x, label), z, rotationY });
  /** Seat entries for trestles that seat four each, their names gathered as the generator gathers a row's. */
  const fourEach = (pieces: readonly Planned[]) => seatsOf(pieces, [row({
    name: "Trestle Table (White Cloth) with 4 chairs", qty: pieces.length, positions: at(pieces),
    labels: [...new Set(pieces.flatMap((piece) => (piece.label === undefined ? [] : [piece.label])))],
  })]);
  const coveredByName = (qty: number, name = "Top table") => [{ qty: qty * 4, each: null, tables: name }];
  const countForm = (qty: number) => [{ qty: qty * 4, each: 4, tables: `${String(qty)}\u00A0× Trestle Table (White Cloth)` }];

  it("joins two trestles at a gap of up to 0.15 m and sides up to 0.05 m out, both inclusive, wherever they stand (ruling 1)", () => {
    // A named trestle and an unnamed one east of it, each 1.83 m long, `gap` apart, the second `out` further south.
    const pair = (x: number, z: number, gap: number, out: number) => fourEach([trestleAt(30, x, z, "Top table"), trestleAt(31, x + 1.83 + gap, z + out)]);
    for (const [x, z] of [[0, 0], [3.7, 2.3], [-5.55, -4.2], [12.95, 1.1]] as const) {
      const where = `at x ${String(x)}, z ${String(z)}`;
      expect(pair(x, z, 0.14, 0), `0.14 m apart ${where}`).toEqual(coveredByName(2));
      expect(pair(x, z, 0.15, 0), `0.15 m apart ${where}`).toEqual(coveredByName(2));
      expect(pair(x, z, 0.16, 0), `0.16 m apart ${where}`).toEqual(countForm(2));
      expect(pair(x, z, 0.02, 0.04), `0.04 m out ${where}`).toEqual(coveredByName(2));
      expect(pair(x, z, 0.02, 0.05), `0.05 m out ${where}`).toEqual(coveredByName(2));
      expect(pair(x, z, 0.02, 0.06), `0.06 m out ${where}`).toEqual(countForm(2));
    }
  });

  it("joins only along the pieces' own long sides: a top table turned down the room, never rows set back to back nor trestles side by side (ruling 1)", () => {
    // A top table of three trestles turned a quarter round, end to end down the room, the middle one named.
    const downTheRoom = [-1.85, 0, 1.85].map((z, n) => trestleAt(40 + n, 0, z, n === 1 ? "Top table" : undefined, Math.PI / 2));
    expect(fourEach(downTheRoom)).toEqual(coveredByName(3));
    // A boardroom's solid block: two rows of three set back to back, the chair's trestle named. The name covers its own row only.
    const block = [-0.38, 0.38].flatMap((z, side) => [-1.83, 0, 1.83].map((x, n) => trestleAt(50 + side * 3 + n, x, z, side === 0 && n === 1 ? "Chair" : undefined)));
    expect(fourEach(block)).toEqual(countForm(6));
    // The same rows 0.84 m apart, as the board meeting sets them: the same.
    expect(fourEach(block.map((piece) => ({ ...piece, z: piece.z < 0 ? -0.8 : 0.8 })))).toEqual(countForm(6));
    // Two trestles turned 45 degrees side by side, the boxes they take on the floor in line and 0.05 m apart: not end to end.
    const reach = (1.83 / 2 + 0.76 / 2) * Math.SQRT1_2 * 2;
    expect(fourEach([trestleAt(63, 0, 0, "Top table", Math.PI / 4), trestleAt(64, reach + 0.05, 0, undefined, Math.PI / 4)])).toEqual(countForm(2));
    // Square tables join either way: three end to end down the room, the middle one named.
    const squares = [-1.2, 0, 1.2].map((z, n) => ({ ...trestleAt(70 + n, 0, z, n === 1 ? "Top table" : undefined), name: "Square Table", widthM: 1.2, depthM: 1.2 }));
    expect(seatsOf(squares, [row({ name: "Square Table with 4 chairs", qty: 3, labels: ["Top table"], positions: at(squares) })])).toEqual(coveredByName(3));
  });

  it("measures a join in each piece's own frame, so a top table on the slant keeps its name and a chevron's tables side by side never join (ruling 1)", () => {
    /** Three trestles end to end along their own long sides, 0.02 m apart, turned `degrees`, the middle one named. */
    const slanted = (degrees: number) => {
      const turn = degrees * Math.PI / 180;
      // Each 1.85 m further along its width's way, as the plan turns a piece: (cos, -sin).
      return [-1, 0, 1].map((k, n) => trestleAt(100 + n, k * 1.85 * Math.cos(turn), -k * 1.85 * Math.sin(turn), n === 1 ? "Top table" : undefined, turn));
    };
    for (const degrees of [2, 30, 45, 60, 135]) expect(fourEach(slanted(degrees)), `a top table turned ${String(degrees)} degrees`).toEqual(coveredByName(3));
    // A chevron: two trestles turned alike side by side across the room, the boxes they take on the floor in line and 0.05 m apart.
    for (const degrees of [30, 40]) {
      const turn = degrees * Math.PI / 180;
      const reach = (1.83 / 2) * Math.cos(turn) + (0.76 / 2) * Math.sin(turn);
      expect(fourEach([trestleAt(110, 0, 0, "Top table", turn), trestleAt(111, 2 * reach + 0.05, 0, undefined, turn)]), `a chevron at ${String(degrees)} degrees`)
        .toEqual(countForm(2));
    }
  });

  it("names the tables only when each name covers one run of pieces, so a name typed on two tables apart takes the line's count (HI5)", () => {
    // Eleven rounds, the seventh typed "Table 5" again: ten names for eleven tables.
    const pieces = Array.from({ length: 11 }, (_, n) => round(80 + n, n * 3, `Table ${String(n === 6 ? 5 : n + 1)}`));
    const labels = [...new Set(pieces.flatMap((piece) => (piece.label === undefined ? [] : [piece.label])))];
    expect(seatsOf(pieces, [row({ name: "6ft Round Table with 10 chairs", qty: 11, labels, positions: at(pieces) })]))
      .toEqual([{ qty: 110, each: 10, tables: "11\u00A0× 6ft Round Table" }]);
    // One name typed on every trestle of a top table set end to end is one run: it names them.
    expect(fourEach([-1.85, 0, 1.85].map((x, n) => trestleAt(90 + n, x, -4, "Top table")))).toEqual(coveredByName(3));
    // The same name on two top tables set apart is two runs: the line counts them.
    expect(fourEach([trestleAt(93, 0, -4, "Top table"), trestleAt(94, 1.85, -4), trestleAt(95, 8, -4, "Top table"), trestleAt(96, 9.85, -4)])).toEqual(countForm(4));
  });

  it("gives the count at each table only where the place holds more than one table, each seating it", () => {
    // One table: its chairs are all at it, so "each" says nothing more.
    const top = round(1, 0, "Top table");
    expect(seatsOf([top], [row({ name: "6ft Round Table with 10 chairs", qty: 1, labels: ["Top table"], positions: at([top]) })]))
      .toEqual([{ qty: 10, each: null, tables: "Top table" }]);
    expect(seatsOf(null, [row({ name: "6ft Round Table with 10 chairs", qty: 1 })])).toEqual([{ qty: 10, each: null, tables: "6ft Round Table" }]);
    // One table of three trestles that seat four each: four at each trestle is not four at the table.
    const trestles = [trestle(20, -1.85), trestle(21, 0, "Top table"), trestle(22, 1.85)];
    expect(seatsOf(trestles, [row({ name: "Trestle Table (White Cloth) with 4 chairs", qty: 3, labels: ["Top table"], positions: at(trestles) })]))
      .toEqual([{ qty: 12, each: null, tables: "Top table" }]);
    // Three tables, each its own piece, with no Table 13 between them.
    const gapped = [round(12, 0, "Table 12"), round(14, 3, "Table 14"), round(15, 6, "Table 15")];
    expect(seatsOf(gapped, [row({ name: "6ft Round Table with 8 chairs", qty: 3, labels: ["Table 12", "Table 14", "Table 15"], positions: at(gapped) })]))
      .toEqual([{ qty: 24, each: 8, tables: "Tables 12, 14–15" }]);
  });

  it("without a plan, names the tables only when each piece has a name of its own", () => {
    expect(seatsOf(null, [row({ name: "6ft Round Table with 8 chairs", qty: 3, labels: ["Table 12", "Table 14", "Table 15"] })]))
      .toEqual([{ qty: 24, each: 8, tables: "Tables 12, 14–15" }]);
    expect(seatsOf(null, [row({ name: "6ft Round Table with 10 chairs", qty: 11, labels: ["Table 5"] })]))
      .toEqual([{ qty: 110, each: 10, tables: "11\u00A0× 6ft Round Table" }]);
  });
});

// #443's review (HG7): the chairs line claims its chairs' notes only in the form that prints it.
describe("sheetSetupSteps without the chairs line, for a setup under the brief", () => {
  type Planned = ReturnType<typeof plannedObject>;
  const at = (objects: readonly Planned[]) => objects.map(({ objectId, x, z }) => ({ objectId, x, z, rotationY: 0 }));
  const NOTE = "Seat 3: wheelchair user, aisle side";
  const rounds = [plannedObject(1, "6ft Round Table", "table", 0, 0), plannedObject(2, "6ft Round Table", "table", 4, 0)];
  const seated = Array.from({ length: 20 }, (_, n) => plannedObject(100 + n, "Chiavari Wedding Chair", "chair", n * 0.4, 1.5, n === 2 ? { note: NOTE } : {}));
  // An older frozen copy: a sash on every chair, the generator having copied the noted chair's words onto the sash's row.
  const noted = sheet({
    floorPlan: { coordinateSpace: "real_m_v1", outline: [{ x: -5, z: -5 }, { x: 10, z: -5 }, { x: 10, z: 5 }], objects: [...rounds, ...seated] },
    phases: [
      { phase: "furniture", zones: [{ zone: "Centre", rows: [row({ name: "6ft Round Table with 10 chairs", qty: 2, positions: at(rounds) })] }] },
      { phase: "dress", zones: [{ zone: "Centre", rows: [row({ name: "Gold Chair Sash", category: "decor", qty: 20, isAccessory: true, notes: NOTE })] }] },
    ],
  });

  it("keeps each table's chairs on its line, with no chairs line, and leaves the chairs' notes to the lines that print", () => {
    const [furniture, dress] = sheetSetupSteps(noted, { chairsLine: false });
    expect(furniture?.items.map((item) => [item.name, item.qty, item.chairs, item.seats])).toEqual([["6ft Round Table", 2, { total: 20, each: 10 }, null]]);
    expect(dress?.items.map((item) => [item.name, item.notes])).toEqual([["Gold Chair Sash", [NOTE]]]);
  });

  it("puts the chairs' notes on the chairs line where the setup has its own page", () => {
    const [furniture, dress] = sheetSetupSteps(noted);
    expect(furniture?.items.map((item) => [item.name, item.notes])).toEqual([["6ft Round Table", []], ["Chiavari Wedding Chair", [NOTE]]]);
    expect(dress?.items.map((item) => [item.name, item.notes])).toEqual([["Gold Chair Sash", []]]);
  });
});

describe("sheetNoteMarkers", () => {
  it("numbers noted pieces in reading order: top row first, then left to right", () => {
    const markers = sheetNoteMarkers(sheet({ floorPlan: {
      coordinateSpace: "real_m_v1", outline: [{ x: -5, z: -5 }, { x: 5, z: -5 }, { x: 5, z: 5 }],
      objects: [
        plannedObject(1, "Bar", "other", 4, 3, { note: "Cash bar from 21:00" }),
        plannedObject(2, "6ft Round Table", "table", 2, -2.1, { label: "Table 3", note: "Wheelchair" }),
        plannedObject(3, "6ft Round Table", "table", -3, -1.9, { label: "Table 1", note: "Peanut allergy" }),
        plannedObject(4, "6ft Round Table", "table", 0, 0, { label: "Table 2" }),
      ],
    } }));
    expect([...markers.entries()]).toEqual([["Peanut allergy", 1], ["Wheelchair", 2], ["Cash bar from 21:00", 3]]);
  });

  it("is empty without a plan", () => {
    expect(sheetNoteMarkers(sheet()).size).toBe(0);
  });

  it("keeps a note whole when the planner wrote the separator into it, so its marker still matches", () => {
    const whole = "Bride and groom centre · florist brings the arrangement at 11:30";
    const noted = sheet({
      floorPlan: {
        coordinateSpace: "real_m_v1", outline: [{ x: -5, z: -5 }, { x: 5, z: -5 }, { x: 5, z: 5 }],
        objects: [
          plannedObject(1, "Trestle Table", "table", 0, -3, { note: whole }),
          plannedObject(2, "Cake Table", "table", 2, 0, { note: "Needs a socket" }),
        ],
      },
      phases: [{ phase: "furniture", zones: [{ zone: "North wall", rows: [
        row({ name: "Trestle Table", qty: 1, notes: `Needs a socket · ${whole} · Bring the spare cloth` }),
      ] }] }],
    });
    const markers = sheetNoteMarkers(noted);
    const notes = sheetSetupSteps(noted)[0]?.items[0]?.notes ?? [];
    expect(notes).toEqual(["Needs a socket", whole, "Bring the spare cloth"]);
    expect(notes.map((note) => markers.get(note) ?? null)).toEqual([2, 1, null]);
  });

  it("reads a row's notes as its own pieces' notes, so two notes never merge into a third piece's note", () => {
    const joined = "Needs a socket · Bring the spare cloth";
    const at = (id: number) => ({ objectId: `00000000-0000-4000-8000-${id.toString(16).padStart(12, "0")}`, x: 0, z: 0, rotationY: 0 });
    const noted = sheet({
      floorPlan: {
        coordinateSpace: "real_m_v1", outline: [{ x: -5, z: -5 }, { x: 5, z: -5 }, { x: 5, z: 5 }],
        objects: [
          plannedObject(1, "Trestle Table", "table", 0, -3, { note: "Needs a socket" }),
          plannedObject(2, "Trestle Table", "table", 2, -3, { note: "Bring the spare cloth" }),
          plannedObject(3, "Cake Table", "table", 4, 0, { note: joined }),
        ],
      },
      phases: [{ phase: "furniture", zones: [{ zone: "North wall", rows: [
        row({ name: "Trestle Table", qty: 2, notes: joined, positions: [at(1), at(2)] }),
        row({ name: "Cake Table", qty: 1, notes: joined, positions: [at(3)] }),
      ] }] }],
    });
    const markers = sheetNoteMarkers(noted);
    const [trestles, cake] = sheetSetupSteps(noted)[0]?.items ?? [];
    expect(trestles?.notes).toEqual(["Needs a socket", "Bring the spare cloth"]);
    expect(cake?.notes).toEqual([joined]);
    expect([...(trestles?.notes ?? []), ...(cake?.notes ?? [])].map((note) => markers.get(note) ?? null)).toEqual([1, 2, 3]);
  });
});

describe("venueZoneLabel", () => {
  it("names the venue's zone in words, never its IANA name", () => {
    expect(venueZoneLabel("Europe/London")).toBe("UK time");
    expect(venueZoneLabel("America/New_York")).toBe("Eastern time");
    expect(venueZoneLabel("Not/AZone")).toBe("Not/AZone");
  });
});

describe("keep in view facts", () => {
  it("words access needs as the screen does", () => {
    expect(accessNeeds({ hearingLoopRequired: true, hearingLoopZone: "Centre", wheelchairSpaces: 1, stepFreeRouteRequired: true, signLanguageInterpreter: false, largePrintProgrammes: 4, notes: " Table 3 " }))
      .toEqual(["Hearing loop in Centre", "1 wheelchair space", "Step-free route to seating", "4 large-print programmes", "Table 3"]);
  });

  it("separates allergy meals from the other special meals", () => {
    const dietary = { vegetarian: 14, vegan: 4, glutenFree: 6, nutFree: 2, halal: 3, kosher: 0, otherAllergies: "Seat 4: peanut" };
    expect(allergyFacts(dietary)).toEqual({ counts: ["2 nut-free", "6 gluten-free"], noun: "meals", notes: "Seat 4: peanut" });
    expect(otherMeals(dietary)).toBe("14 vegetarian · 4 vegan · 3 halal");
    expect(otherMeals({ ...dietary, vegetarian: 0, vegan: 0, halal: 0 })).toBeNull();
    expect(otherMeals(null)).toBeNull();
  });
});

describe("formatTableLabels: the planner's table numbers as a crew reads them", () => {
  it("runs numbered tables together", () => {
    expect(formatTableLabels(["Table 4"])).toBe("Table 4");
    expect(formatTableLabels(["Table 3", "Table 1", "Table 2", "Table 5", "Table 8", "Table 7"])).toBe("Tables 1–3, 5, 7–8");
    expect(formatTableLabels(["Table 2", "Table 2", " Table 1 "])).toBe("Tables 1–2");
  });

  it("lists any other names as they were written", () => {
    expect(formatTableLabels(["Top table"])).toBe("Top table");
    expect(formatTableLabels(["Table 10", "Top table", "Table 2"])).toBe("Table 2, Table 10, Top table");
  });

  it("says nothing when there are no names", () => {
    expect(formatTableLabels([])).toBe("");
    expect(formatTableLabels(["  "])).toBe("");
  });
});

describe("sheetSetupSteps: table numbers", () => {
  it("gathers one item's table numbers from every zone it is set in", () => {
    const steps = sheetSetupSteps(sheet({
      instructions: null,
      phases: [{ phase: "furniture", zones: [
        { zone: "Centre", rows: [row({ name: "6ft Round Table with 10 chairs", qty: 2, labels: ["Table 1", "Table 2"] })] },
        { zone: "South wall", rows: [row({ name: "6ft Round Table with 10 chairs", qty: 1, labels: ["Table 3"] })] },
      ] }],
    }));
    const [item] = steps[0]?.items ?? [];
    expect(item?.labels).toEqual(["Table 1", "Table 2", "Table 3"]);
    expect(formatTableLabels(item?.labels ?? [])).toBe("Tables 1–3");
  });
});

describe("careTables: the tables the care words name, for the plan to ring", () => {
  const tables = ["Table 1", "Table 3", "Table 5", "Table 9", "Table 10", "Top table"];
  const plan = (labels: readonly string[]) => ({
    coordinateSpace: "real_m_v1" as const,
    outline: [{ x: 0, z: 0 }, { x: 21, z: 0 }, { x: 21, z: 10.5 }, { x: 0, z: 10.5 }],
    objects: [
      ...labels.map((label, index) => plannedObject(index + 1, "6ft Round Table", "table", index, 0, { label })),
      plannedObject(99, "Bar", "bar", 20, 10, { label: "Bar" }),
    ],
  });
  const careSheet = (accessNotes: string, otherAllergies: string, labels: readonly string[] = tables) => sheet({
    floorPlan: plan(labels),
    instructions: {
      ...EMPTY_INSTRUCTIONS,
      accessibility: { hearingLoopRequired: false, hearingLoopZone: null, wheelchairSpaces: 1, stepFreeRouteRequired: true, signLanguageInterpreter: false, largePrintProgrammes: 0, notes: accessNotes },
      dietary: { vegetarian: 0, vegan: 0, glutenFree: 0, nutFree: 0, halal: 0, kosher: 0, otherAllergies },
    },
  });

  it("rings each table the access and allergy words name, by its planner label", () => {
    const ringed = careTables(careSheet("Large-print orders of service go on table 3.", "Table 5, seat 4: severe peanut allergy. Table 9: two guests coeliac."));
    expect([...ringed].sort()).toEqual(["Table 3", "Table 5", "Table 9"]);
  });

  it("matches a label only as a whole phrase, so Table 10 does not ring Table 1", () => {
    expect([...careTables(careSheet("", "Table 10: nut allergy at seat 2."))]).toEqual(["Table 10"]);
  });

  it("rings a named table such as the top table, but never a piece that is not a table", () => {
    expect([...careTables(careSheet("Bar staff know the top table has a coeliac guest.", ""))]).toEqual(["Top table"]);
  });

  it("rings nothing without a plan or without care words", () => {
    expect(careTables(sheet({ floorPlan: plan(tables), instructions: EMPTY_INSTRUCTIONS })).size).toBe(0);
    expect(careTables({ ...careSheet("", "Table 5: nut allergy."), floorPlan: null }).size).toBe(0);
  });

  it("counts a bare number or a single letter as a table only after the word table", () => {
    const labels = ["1", "2", "4", "5", "10", "12", "A"];
    expect([...careTables(careSheet("A wheelchair user sits near the door.", "Seat 4 at table 12 is coeliac. 2 guests with nut allergy; cake at 10:30.", labels))]).toEqual(["12"]);
    expect([...careTables(careSheet("", "Tables 4 and 5 are nut-free.", labels))]).toEqual(["4", "5"]);
    expect([...careTables(careSheet("", "Table A: one guest avoids sesame.", labels))]).toEqual(["A"]);
  });

  it("rings every table a run of names gives, written as the sheet writes such runs", () => {
    const labels = ["1", "2", "3", "4", "5", "6", "7", "9", "A", "B"];
    const ringed = (words: string): string[] => [...careTables(careSheet("", words, labels))].sort();
    expect(ringed("Tables 4 and 5 are nut-free.")).toEqual(["4", "5"]);
    expect(ringed("A guest at Tables 4 and 2 avoids sesame.")).toEqual(["2", "4"]);
    expect(ringed("Nut-free at tables 3, 5 and 9.")).toEqual(["3", "5", "9"]);
    expect(ringed("Table 4 & 5: no sesame.")).toEqual(["4", "5"]);
    expect(ringed("Table 4 or 5, whichever is nearer the door.")).toEqual(["4", "5"]);
    // The setup's own lines run tables together this way (formatTableLabels); 8 is not a table here.
    expect(ringed("Tables 1–3, 5, 7–8: gluten-free bread.")).toEqual(["1", "2", "3", "5", "7"]);
    expect(ringed("Tables A and B face the stage, where the loop works.")).toEqual(["A", "B"]);
  });

  it("reads a run the same way for tables labelled as the planner numbers them", () => {
    const labels = ["Table 4", "Table 5", "Table 12", "Top table"];
    expect([...careTables(careSheet("", "Tables 4 and 5 are nut-free.", labels))].sort()).toEqual(["Table 4", "Table 5"]);
    expect([...careTables(careSheet("", "Tables 4, 5 & 12, and the top table: no sesame.", labels))].sort()).toEqual(["Table 12", "Table 4", "Table 5", "Top table"]);
  });

  it("never takes a count or a word after a table for another table", () => {
    const labels = ["2", "4", "6", "A"];
    const ringed = (words: string): string[] => [...careTables(careSheet("", words, labels))].sort();
    expect(ringed("Table 4 and 2 guests at table 6 avoid nuts.")).toEqual(["4", "6"]);
    expect(ringed("Table A and a guest at the bar are vegan.")).toEqual(["A"]);
    expect(ringed("Table 4 and A guest list goes to the bar.")).toEqual(["4"]);
    // After "tables" the run is meant: the guests at tables 4 and 6.
    expect(ringed("Tables 4 and 6 guests are vegan.")).toEqual(["4", "6"]);
  });

  it("never runs on across a comma into a count, a time or a clause of its own", () => {
    const labels = ["1", "2", "3", "4", "5", "7", "10", "12"];
    const ringed = (words: string): string[] => [...careTables(careSheet("", words, labels))].sort();
    // The shorthand planners write for allergies: a table, then how many guests.
    expect(ringed("Table 3, 1 coeliac.")).toEqual(["3"]);
    expect(ringed("Table 12, 2 coeliacs and a nut allergy.")).toEqual(["12"]);
    expect(ringed("Table 7, 1 nut allergy")).toEqual(["7"]);
    expect(ringed("Table 4 and 2 more guests are vegan")).toEqual(["4"]);
    expect(ringed("Table 4, 10:30 cake")).toEqual(["4"]);
    // A run after "tables" still ends where a count begins.
    expect(ringed("Tables 4 and 5, 2 coeliacs")).toEqual(["4", "5"]);
    expect([...careTables(careSheet("", "Table 7, 1 coeliac.", ["Table 1", "Table 7"]))]).toEqual(["Table 7"]);
  });

  it("names a table written hard against its count after a colon, and takes only a clock's minutes for a time", () => {
    const labels = ["1", "2", "3", "4", "5", "10", "12"];
    const ringed = (words: string): string[] => [...careTables(careSheet("", words, labels))].sort();
    // Quick shorthand with no space after the colon: the table, then how many guests.
    expect(ringed("Table 5:2 coeliacs")).toEqual(["5"]);
    expect(ringed("Table 12:3 vegans, table 4:1 nut allergy")).toEqual(["12", "4"]);
    expect(ringed("Tables 4 and 5:2 coeliacs")).toEqual(["4", "5"]);
    // A clock time is still never a table: two-digit minutes after a colon, any digit after a point.
    expect(ringed("Table 4, 10:30 cake")).toEqual(["4"]);
    expect(ringed("Table 4 or 12.30 delivery")).toEqual(["4"]);
    // The same for tables labelled as the planner numbers them.
    const numbered = ["Table 4", "Table 5", "Table 10", "Table 12"];
    expect([...careTables(careSheet("", "Tables 4 and 5:2 coeliacs", numbered))].sort()).toEqual(["Table 4", "Table 5"]);
    expect([...careTables(careSheet("", "Table 4, 10:30 cake", numbered))]).toEqual(["Table 4"]);
  });

  it("never takes a measurement written with a decimal point after 'table' for a table, in either label style (#443 HH1)", () => {
    const bare = ["1", "2", "3", "4", "5", "10", "12"];
    const numbered = ["Table 1", "Table 2", "Table 4", "Table 5", "Table 10", "Table 12"];
    for (const labels of [bare, numbered]) {
      for (const words of ["Seat her at a table 1.2 m from the fire exit", "Move table 2.5 m back"]) {
        expect([...careTables(careSheet(words, "", labels))], `${words} (${labels[0] ?? ""}…)`).toEqual([]);
        expect([...careTables(careSheet("", words, labels))], `${words} (${labels[0] ?? ""}…)`).toEqual([]);
      }
      // A table written hard against its count after a colon still rings.
      expect([...careTables(careSheet("", "Seat her at a table 1.2 m from the fire exit. Table 5:2 coeliacs", labels))]).toEqual([labels === bare ? "5" : "Table 5"]);
    }
  });

  it("never takes a clock time after 'table' for a table, in either label style (#443 HJ2)", () => {
    const bare = ["1", "2", "4", "5", "10", "12"];
    const numbered = ["Table 1", "Table 2", "Table 4", "Table 5", "Table 10", "Table 12"];
    for (const labels of [bare, numbered]) {
      for (const words of ["Cake on the buffet table 2:30pm", "Clear the gift table 1:00 onwards", "Reset table 10:15", "Table 12:30pm toast"]) {
        expect([...careTables(careSheet(words, "", labels))], `${words} (${labels[0] ?? ""}…)`).toEqual([]);
        expect([...careTables(careSheet("", words, labels))], `${words} (${labels[0] ?? ""}…)`).toEqual([]);
      }
      // A table written hard against its count after a colon still rings.
      expect([...careTables(careSheet("", "Cake on the buffet table 2:30pm. Table 5:2 coeliacs", labels))]).toEqual([labels === bare ? "5" : "Table 5"]);
    }
  });

  it("reads a point after a table's number as a decimal only where a digit follows it, in either label style (#443 HJ3)", () => {
    const bare = ["2", "5", "10"];
    const numbered = ["Table 2", "Table 5", "Table 10"];
    for (const labels of [bare, numbered]) {
      const five = labels === bare ? "5" : "Table 5";
      const ringed = (words: string): string[] => [...careTables(careSheet("", words, labels))];
      expect(ringed("Table 5.2 coeliacs"), `${five}: a decimal`).toEqual([]);
      expect(ringed("Coeliacs at the end of Table 5."), `${five}: a sentence's end`).toEqual([five]);
      expect(ringed("Table 5. Two coeliacs"), `${five}: a sentence's end`).toEqual([five]);
    }
  });

  it("reads only the planner's own words, never the counts the sheet adds", () => {
    const base = careSheet("", "", ["1", "4"]);
    const access = base.instructions?.accessibility;
    if (access === undefined || access === null) throw new Error("the care sheet records access needs");
    // "1 wheelchair space" and "4 large-print programmes" are the sheet's own lines.
    const counted = { ...base, instructions: { ...EMPTY_INSTRUCTIONS, ...base.instructions, accessibility: { ...access, largePrintProgrammes: 4 } } };
    expect(careTables(counted).size).toBe(0);
  });
});
