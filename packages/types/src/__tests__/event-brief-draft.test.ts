import { describe, expect, it } from "vitest";
import {
  CreateEventBriefDraftInputSchema,
  EVENT_BRIEF_DESCRIPTION_MAX_LENGTH,
  EventBriefDraftSchema,
  EventBriefExtractionError,
  interpretEventBriefExtraction,
  isCalendarDate,
  isClockTime,
  normaliseWords,
  type EventBriefExtraction,
} from "../event-brief-draft.js";
import { EventArchitectBriefSchema } from "../event-architect.js";

const NOW = "2026-10-08T10:00:00.000Z";
const VENUE = "00000000-0000-4000-8000-000000000001";
const SPACE = "00000000-0000-4000-8000-000000000002";

type Fields = EventBriefExtraction["fields"];

const ABSENT = { value: null, source: "absent", words: null, basis: null } as const;

function extraction(fields: Partial<Fields> = {}, rest: Partial<Omit<EventBriefExtraction, "fields">> = {}): EventBriefExtraction {
  return {
    fields: {
      eventName: ABSENT,
      eventType: ABSENT,
      guestCount: ABSENT,
      layoutStyle: ABSENT,
      budgetGbp: ABSENT,
      preferredDate: ABSENT,
      startTime: ABSENT,
      endTime: ABSENT,
      serviceModel: ABSENT,
      planningEmphasis: ABSENT,
      ...fields,
    },
    accessibility: rest.accessibility ?? [],
    unsupported: rest.unsupported ?? [],
  };
}

function read(description: string, value: unknown, contactDetailsRemoved = false) {
  return interpretEventBriefExtraction({ extraction: value, description, contactDetailsRemoved, generatedAt: NOW });
}

describe("event brief draft request", () => {
  it("takes a bounded description with the room it is for", () => {
    expect(CreateEventBriefDraftInputSchema.parse({ venueId: VENUE, spaceId: SPACE, description: "  Dinner for 80  " }).description)
      .toBe("Dinner for 80");
    expect(CreateEventBriefDraftInputSchema.safeParse({ venueId: VENUE, spaceId: SPACE, description: "   " }).success).toBe(false);
    expect(CreateEventBriefDraftInputSchema.safeParse({
      venueId: VENUE, spaceId: SPACE, description: "a".repeat(EVENT_BRIEF_DESCRIPTION_MAX_LENGTH + 1),
    }).success).toBe(false);
    expect(CreateEventBriefDraftInputSchema.safeParse({ venueId: VENUE, spaceId: SPACE, description: "x", context: {} }).success).toBe(false);
  });
});

describe("reading the model's answer into a draft brief", () => {
  it("keeps values read as written, with no assumptions, and marks the draft unchecked and not run", () => {
    const description = "Founders dinner for 80 guests on 2027-03-12 from 19:00 to 23:30, round tables, plated, budget £12,500.";
    const draft = read(description, extraction({
      eventName: { value: "Founders dinner", source: "stated", words: "Founders dinner", basis: null },
      eventType: { value: "dinner", source: "stated", words: "dinner", basis: null },
      guestCount: { value: 80, source: "stated", words: "80 guests", basis: null },
      layoutStyle: { value: "dinner-rounds", source: "stated", words: "round tables", basis: null },
      budgetGbp: { value: 12500, source: "stated", words: "budget £12,500", basis: null },
      preferredDate: { value: "2027-03-12", source: "stated", words: "2027-03-12", basis: null },
      startTime: { value: "19:00", source: "stated", words: "19:00", basis: null },
      endTime: { value: "23:30", source: "stated", words: "23:30", basis: null },
      serviceModel: { value: "plated", source: "stated", words: "plated", basis: null },
    }));
    expect(draft.brief).toEqual({
      eventName: "Founders dinner",
      eventType: "dinner",
      guestCount: 80,
      layoutStyle: "dinner-rounds",
      budgetLimitMinor: 1_250_000,
      preferredDate: "2027-03-12",
      startTime: "19:00",
      endTime: "23:30",
      serviceModel: "plated",
      accessibilityRequirements: [],
      planningPrompt: null,
    });
    expect(draft.assumptions).toEqual([]);
    expect(draft.unsupported).toEqual([]);
    expect(draft).toMatchObject({
      humanReviewRequired: true, provenance: "ai_generated", evidenceStatus: "unverified", runState: "not_run", generatedAt: NOW,
    });
    // Complete, it is a brief the engine accepts as it stands.
    expect(EventArchitectBriefSchema.safeParse(draft.brief).success).toBe(true);
  });

  it("lists every inferred value as an assumption with the planner's words and the reason", () => {
    const description = "A wedding for about 120-ish, my gran uses a wheelchair.";
    const draft = read(description, extraction({
      eventType: { value: "wedding", source: "stated", words: "wedding", basis: null },
      guestCount: { value: 120, source: "inferred", words: "about 120-ish", basis: "Taken as 120 from an approximate figure." },
      layoutStyle: { value: "dinner-rounds", source: "inferred", words: "wedding", basis: "A wedding dinner is usually on round tables." },
      serviceModel: { value: "plated", source: "absent", words: null, basis: null },
    }, {
      accessibility: [
        { requirement: "wheelchair_spaces", source: "inferred", words: "my gran uses a wheelchair", basis: "A guest uses a wheelchair." },
        { requirement: "wheelchair_spaces", source: "inferred", words: "my gran uses a wheelchair", basis: "Duplicate." },
      ],
    }));
    expect(draft.brief.guestCount).toBe(120);
    expect(draft.brief.accessibilityRequirements).toEqual(["wheelchair_spaces"]);
    expect(draft.assumptions).toEqual([
      { field: "guestCount", accessibilityRequirement: null, words: "about 120-ish", basis: "Taken as 120 from an approximate figure." },
      { field: "layoutStyle", accessibilityRequirement: null, words: "wedding", basis: "A wedding dinner is usually on round tables." },
      // A value given as "absent" was still chosen by the model.
      { field: "serviceModel", accessibilityRequirement: null, words: null, basis: "The service was not stated; this value was inferred." },
      { field: "accessibilityRequirements", accessibilityRequirement: "wheelchair_spaces", words: "my gran uses a wheelchair", basis: "A guest uses a wheelchair." },
    ]);
  });

  it("treats a value said to be stated in words the description does not hold as an assumption", () => {
    const draft = read("Dinner for eighty.", extraction({
      guestCount: { value: 80, source: "stated", words: "80 guests", basis: null },
    }));
    expect(draft.brief.guestCount).toBe(80);
    expect(draft.assumptions).toEqual([{
      field: "guestCount", accessibilityRequirement: null, words: "80 guests",
      basis: "Read from the description, but the words could not be found as written.",
    }]);
  });

  it("never clamps: a guest count beyond the engine's bounds is left unset and held back in the planner's words", () => {
    const draft = read("Black tie for 350, round tables.", extraction({
      guestCount: { value: 350, source: "stated", words: "Black tie for 350", basis: null },
      layoutStyle: { value: "dinner-rounds", source: "stated", words: "round tables", basis: null },
    }));
    expect(draft.brief.guestCount).toBeNull();
    expect(draft.unsupported).toEqual([{
      words: "Black tie for 350",
      verbatim: true,
      kind: "beyond_limits",
      explanation: "The Event Architect plans for 1 to 300 guests; this asks for 350.",
      field: "guestCount",
    }]);
    expect(draft.assumptions).toEqual([]);
  });

  it("withdraws a clamped value the model kept beside its own unsupported item", () => {
    const draft = read("Black tie for 350.", extraction({
      guestCount: { value: 300, source: "inferred", words: "350", basis: "Reduced to the maximum." },
    }, {
      unsupported: [{ words: "Black tie for 350", kind: "beyond_limits", explanation: "More guests than the engine plans for.", field: "guestCount" }],
    }));
    expect(draft.brief.guestCount).toBeNull();
    expect(draft.assumptions).toEqual([]);
    expect(draft.unsupported).toHaveLength(1);
    expect(draft.unsupported[0]).toMatchObject({ words: "Black tie for 350", verbatim: true, field: "guestCount" });
  });

  it.each([
    ["zero guests", { guestCount: { value: 0, source: "stated", words: "0 guests", basis: null } }, "guestCount", "beyond_limits"],
    ["a part guest", { guestCount: { value: 120.5, source: "inferred", words: "120.5", basis: null } }, "guestCount", "needs_exact_value"],
    ["a negative budget", { budgetGbp: { value: -5, source: "stated", words: "-5", basis: null } }, "budgetLimitMinor", "beyond_limits"],
    ["a month for a date", { preferredDate: { value: "June 2027", source: "stated", words: "June 2027", basis: null } }, "preferredDate", "needs_exact_value"],
    ["an impossible date", { preferredDate: { value: "2027-02-30", source: "stated", words: "30 February", basis: null } }, "preferredDate", "needs_exact_value"],
    ["a loose time", { startTime: { value: "evening", source: "stated", words: "evening", basis: null } }, "startTime", "needs_exact_value"],
    ["a twelve-hour time", { endTime: { value: "7pm", source: "stated", words: "7pm", basis: null } }, "endTime", "needs_exact_value"],
    ["another layout", { layoutStyle: { value: "other", source: "stated", words: "cabaret style", basis: null } }, "layoutStyle", "layout_style"],
    ["another service", { serviceModel: { value: "other", source: "stated", words: "bowl food", basis: null } }, "serviceModel", "service_style"],
    ["an over-long name", { eventName: { value: "n".repeat(201), source: "inferred", words: null, basis: null } }, "eventName", "beyond_limits"],
  ] as const)("holds back %s instead of keeping it", (_, fields, field, kind) => {
    const draft = read("cabaret style, bowl food, June 2027, 30 February, evening, 7pm, 0 guests, 120.5, -5", extraction(fields));
    expect(draft.brief[field]).toBeNull();
    expect(draft.unsupported).toHaveLength(1);
    expect(draft.unsupported[0]).toMatchObject({ kind, field });
    expect(draft.assumptions).toEqual([]);
  });

  it("keeps every requirement the model could not place, deduplicated, with whether the words were found", () => {
    const description = "Wedding with a top table, a dance floor and a ceilidh band. Ceremony in the Saloon first.";
    const draft = read(description, extraction({}, {
      unsupported: [
        { words: "a top table", kind: "not_modelled", explanation: "The engine does not place a top table.", field: null },
        { words: "a dance floor", kind: "not_modelled", explanation: "The engine does not place a dance floor.", field: null },
        { words: "A dance  floor", kind: "not_modelled", explanation: "Same words again.", field: null },
        { words: "ceilidh band", kind: "not_modelled", explanation: "Bands are not placed.", field: null },
        { words: "a ceremony in another room", kind: "other_room", explanation: "Only the Grand Hall is planned.", field: null },
      ],
    }));
    expect(draft.unsupported.map((item) => [item.words, item.verbatim])).toEqual([
      ["a top table", true],
      ["a dance floor", true],
      ["ceilidh band", true],
      ["a ceremony in another room", false],
    ]);
  });

  it("keeps two of the model's own items about one field, and leaves that field unset", () => {
    const draft = read("Cabaret for the awards, then a boardroom for the board.", extraction({
      layoutStyle: { value: "other", source: "stated", words: "Cabaret", basis: null },
    }, {
      unsupported: [
        { words: "Cabaret for the awards", kind: "layout_style", explanation: "Cabaret is not set out.", field: "layoutStyle" },
        { words: "a boardroom for the board", kind: "layout_style", explanation: "Boardroom is not set out.", field: "layoutStyle" },
      ],
    }));
    expect(draft.brief.layoutStyle).toBeNull();
    expect(draft.unsupported.map((item) => item.words)).toEqual(["Cabaret for the awards", "a boardroom for the board"]);
  });

  it("names a field for context without unsetting it when the item is not about its value", () => {
    const draft = read("A wedding with a ceilidh.", extraction({
      eventType: { value: "wedding", source: "stated", words: "wedding", basis: null },
    }, {
      unsupported: [{ words: "a ceilidh", kind: "not_modelled", explanation: "Dancing space is not placed.", field: "eventType" }],
    }));
    expect(draft.brief.eventType).toBe("wedding");
  });

  it("takes out certainty the venue cannot back from what the model wrote, never from the planner's words", () => {
    const draft = read("Fire approved hall please, about 90", extraction({
      guestCount: { value: 90, source: "inferred", words: "about 90", basis: "The hall is fire approved for 90." },
    }, {
      unsupported: [{ words: "Fire approved hall", kind: "other", explanation: "We cannot say it is certified safe.", field: null }],
    }));
    expect(draft.assumptions[0]?.basis).not.toMatch(/fire approved/iu);
    expect(draft.unsupported[0]?.explanation).not.toMatch(/certified safe/iu);
    expect(draft.unsupported[0]?.words).toBe("Fire approved hall");
  });

  it("refuses an answer that does not match the contract, naming only where", () => {
    let thrown: unknown;
    try {
      read("Dinner", { ...extraction(), extra: "x" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EventBriefExtractionError);
    expect(thrown instanceof EventBriefExtractionError ? thrown.issuePaths : null).toEqual([""]);
    expect(() => read("Dinner", { fields: {}, accessibility: [], unsupported: [] })).toThrow(EventBriefExtractionError);
    const wrongType = extraction();
    expect(() => read("Dinner", { ...wrongType, fields: { ...wrongType.fields, guestCount: { value: "80", source: "stated", words: "80", basis: null } } }))
      .toThrow(/fields\.guestCount\.value/u);
  });

  it("records that contact details were taken out", () => {
    expect(read("Dinner (phone number)", extraction(), true).contactDetailsRemoved).toBe(true);
  });

  it("refuses a draft that keeps a value beside its own unsupported item", () => {
    const draft = read("Black tie for 350", extraction({
      guestCount: { value: 350, source: "stated", words: "Black tie for 350", basis: null },
    }));
    expect(EventBriefDraftSchema.safeParse({ ...draft, brief: { ...draft.brief, guestCount: 300 } }).success).toBe(false);
  });
});

describe("brief value formats", () => {
  it("accepts calendar dates and 24-hour times only", () => {
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2027-02-29")).toBe(false);
    expect(isCalendarDate("12/06/2027")).toBe(false);
    expect(isClockTime("00:00")).toBe(true);
    expect(isClockTime("23:59")).toBe(true);
    expect(isClockTime("24:00")).toBe(false);
    expect(isClockTime("7:30")).toBe(false);
  });

  it("compares words without regard to case, quotes, dashes or spacing", () => {
    expect(normaliseWords("  “About  120–ish.”  ")).toBe("about 120-ish");
  });
});
