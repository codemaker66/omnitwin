import { describe, expect, it } from "vitest";
import { AccessibilityRequirementsSchema, DietarySummarySchema, PhaseDeadlineSchema } from "@omnitwin/types";
import { accessNeeds, allergyFacts, deadlineWhen, formatSheetTimes, nextPhaseDeadline, telHref, venueDay, venueZoneLabel, zoneNote } from "../sheet-facts.js";

const LONDON = "Europe/London";

describe("the venue's clock in words", () => {
  it("names a zone the way a reader says it, never by its IANA name", () => {
    expect(venueZoneLabel(LONDON)).toBe("UK time");
    expect(venueZoneLabel("America/New_York")).toBe("Eastern time");
    expect(venueZoneLabel("Not/AZone")).toBe("Not/AZone");
  });

  it("names the zone only for a reader whose device keeps another clock", () => {
    expect(zoneNote(LONDON, LONDON)).toBeNull();
    expect(zoneNote(LONDON, "America/New_York")).toBe("UK time");
    expect(zoneNote(LONDON, undefined)).toBe("UK time");
  });

  it("reads the calendar day on the venue's clock, not the instant's UTC date", () => {
    // 23:30 UTC on 2 October is 00:30 on the 3rd in a British summer.
    expect(venueDay(Date.parse("2026-10-02T23:30:00.000Z"), LONDON)).toBe("2026-10-03");
    expect(venueDay(Date.parse("2026-12-02T23:30:00.000Z"), LONDON)).toBe("2026-12-02");
  });
});

describe("the printed sheet's times", () => {
  it("prints the hour the room must be ready beside the start, on the venue's clock", () => {
    expect(formatSheetTimes({ eventStart: "2026-10-03T17:30:00.000Z", setupBy: "2026-10-03T15:00:00.000Z", bufferMinutes: 150 }, LONDON))
      .toBe("Ready by 16:00 · Starts 18:30 · Sat, 3 Oct 2026");
    // December keeps the same wall clock; the offset is the venue's, not UTC's.
    expect(formatSheetTimes({ eventStart: "2026-12-12T18:30:00.000Z", setupBy: "2026-12-12T16:00:00.000Z", bufferMinutes: 150 }, LONDON))
      .toBe("Ready by 16:00 · Starts 18:30 · Sat, 12 Dec 2026");
  });

  it("says why when no ready-by hour is set", () => {
    expect(formatSheetTimes({ eventStart: "2026-10-03T17:30:00.000Z", setupBy: null, bufferMinutes: null }, LONDON))
      .toBe("Ready by: not set, as no changeover time is recorded for this room · Starts 18:30 · Sat, 3 Oct 2026");
  });
});

describe("the planner's next deadline", () => {
  const deadline = (phase: string, iso: string, reason = ""): ReturnType<typeof PhaseDeadlineSchema.parse> =>
    PhaseDeadlineSchema.parse({ phase, deadline: iso, reason });
  const furniture = deadline("furniture", "2026-10-03T13:30:00.000Z", "Florist arrives");
  const dress = deadline("dress", "2026-10-03T14:30:00.000Z");
  const structure = deadline("structure", "2026-10-03T11:00:00.000Z");

  it("is the earliest deadline still ahead, whatever order the planner set them in", () => {
    expect(nextPhaseDeadline([dress, furniture, structure], Date.parse("2026-10-03T08:00:00.000Z"))).toBe(structure);
    expect(nextPhaseDeadline([dress, furniture, structure], Date.parse("2026-10-03T12:00:00.000Z"))).toBe(furniture);
  });

  it("moves on once a deadline passes, and is none once all have", () => {
    expect(nextPhaseDeadline([dress, furniture], Date.parse("2026-10-03T13:30:00.000Z"))).toBe(dress);
    expect(nextPhaseDeadline([dress, furniture], Date.parse("2026-10-03T15:00:00.000Z"))).toBeNull();
    expect(nextPhaseDeadline([], 0)).toBeNull();
  });

  it("gives its time on the venue's clock, with the day only when it is not the event's", () => {
    expect(deadlineWhen(furniture.deadline, LONDON, "2026-10-03")).toBe("14:30");
    expect(deadlineWhen("2026-10-02T15:00:00.000Z", LONDON, "2026-10-03")).toBe("Fri 2 Oct, 16:00");
  });
});

describe("a guest's access needs", () => {
  const access = (fields: Record<string, unknown>): ReturnType<typeof AccessibilityRequirementsSchema.parse> =>
    AccessibilityRequirementsSchema.parse(fields);

  it("reads each need as a short phrase, what must be in place first", () => {
    expect(accessNeeds(access({
      hearingLoopRequired: true, hearingLoopZone: "Centre", wheelchairSpaces: 4, signLanguageInterpreter: true,
      stepFreeRouteRequired: true, largePrintProgrammes: 30, notes: "  Guide dog at table 3  ",
    }))).toEqual([
      "Hearing loop in Centre",
      "4 wheelchair spaces",
      "Sign-language interpreter attending",
      "Step-free route to seating",
      "30 large-print programmes",
      "Guide dog at table 3",
    ]);
  });

  it("counts one in the singular and says when a loop's zone is missing", () => {
    expect(accessNeeds(access({ hearingLoopRequired: true, wheelchairSpaces: 1, largePrintProgrammes: 1 })))
      .toEqual(["Hearing loop, zone not set", "1 wheelchair space", "1 large-print programme"]);
  });

  it("claims nothing when the planner recorded nothing", () => {
    expect(accessNeeds(null)).toEqual([]);
    expect(accessNeeds(access({}))).toEqual([]);
  });
});

describe("the allergies the planner recorded", () => {
  const dietary = (fields: Record<string, unknown>): ReturnType<typeof DietarySummarySchema.parse> => DietarySummarySchema.parse(fields);

  it("counts the allergen meals and keeps the planner's own words", () => {
    expect(allergyFacts(dietary({ nutFree: 3, glutenFree: 2, vegetarian: 12, otherAllergies: " Table 4: sesame. " })))
      .toEqual({ counts: ["3 nut-free", "2 gluten-free"], noun: "meals", notes: "Table 4: sesame." });
    expect(allergyFacts(dietary({ glutenFree: 1 }))).toEqual({ counts: ["1 gluten-free"], noun: "meal", notes: null });
    expect(allergyFacts(dietary({ otherAllergies: "Shellfish, top table" })))
      .toEqual({ counts: [], noun: "meals", notes: "Shellfish, top table" });
  });

  it("is none when only diets were recorded, or nothing at all: diets stay with the brief", () => {
    expect(allergyFacts(dietary({ vegetarian: 12, vegan: 3, halal: 2, kosher: 1 }))).toBeNull();
    expect(allergyFacts(null)).toBeNull();
  });
});

describe("a number to call", () => {
  it("keeps the digits and a leading plus, and drops the trunk digit written as (0)", () => {
    expect(telHref("0141 552 2418")).toBe("tel:01415522418");
    expect(telHref(" +44 (0)141-552-2418 ")).toBe("tel:+441415522418");
    expect(telHref("+44 141 552 2418")).toBe("tel:+441415522418");
  });
});
