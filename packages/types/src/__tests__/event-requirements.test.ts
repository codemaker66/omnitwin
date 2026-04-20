import { describe, it, expect } from "vitest";
import {
  AccessibilityRequirementsSchema,
  DietarySummarySchema,
  DoorEventSchema,
  DoorScheduleEntrySchema,
  DoorScheduleSchema,
  EquipmentTagSchema,
  EQUIPMENT_TAGS,
  DOOR_EVENT_TYPES,
  emptyAccessibilityRequirements,
  hasAccessibilityContent,
  hasCriticalAccessibility,
  emptyDietarySummary,
  dietaryTotal,
  hasDietaryContent,
  emptyDoorSchedule,
  hasDoorScheduleContent,
  type AccessibilityRequirements,
  type DietarySummary,
  type DoorSchedule,
} from "../event-requirements.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DATETIME = "2026-06-15T18:00:00.000Z";

// ---------------------------------------------------------------------------
// AccessibilityRequirementsSchema
// ---------------------------------------------------------------------------

describe("AccessibilityRequirementsSchema", () => {
  it("parses an empty object to a fully-defaulted shape", () => {
    const result = AccessibilityRequirementsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        hearingLoopRequired: false,
        hearingLoopZone: null,
        wheelchairSpaces: 0,
        stepFreeRouteRequired: false,
        signLanguageInterpreter: false,
        largePrintProgrammes: 0,
        notes: "",
      });
    }
  });

  it("accepts a fully populated block", () => {
    const full: AccessibilityRequirements = {
      hearingLoopRequired: true,
      hearingLoopZone: "Centre",
      wheelchairSpaces: 3,
      stepFreeRouteRequired: true,
      signLanguageInterpreter: true,
      largePrintProgrammes: 25,
      notes: "BSL interpreter stationed stage-left",
    };
    expect(AccessibilityRequirementsSchema.safeParse(full).success).toBe(true);
  });

  it("accepts all 7 zones for hearingLoopZone", () => {
    const zones = [
      "North wall", "South wall", "East wall", "West wall",
      "Entrance", "Perimeter", "Centre",
    ];
    for (const zone of zones) {
      const result = AccessibilityRequirementsSchema.safeParse({
        hearingLoopRequired: true,
        hearingLoopZone: zone,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an unknown zone for hearingLoopZone", () => {
    expect(AccessibilityRequirementsSchema.safeParse({
      hearingLoopZone: "Balcony",
    }).success).toBe(false);
  });

  it("rejects wheelchairSpaces > 50", () => {
    expect(AccessibilityRequirementsSchema.safeParse({
      wheelchairSpaces: 51,
    }).success).toBe(false);
  });

  it("accepts wheelchairSpaces of exactly 50", () => {
    expect(AccessibilityRequirementsSchema.safeParse({
      wheelchairSpaces: 50,
    }).success).toBe(true);
  });

  it("rejects negative wheelchairSpaces", () => {
    expect(AccessibilityRequirementsSchema.safeParse({
      wheelchairSpaces: -1,
    }).success).toBe(false);
  });

  it("rejects float wheelchairSpaces", () => {
    expect(AccessibilityRequirementsSchema.safeParse({
      wheelchairSpaces: 1.5,
    }).success).toBe(false);
  });

  it("rejects largePrintProgrammes > 500", () => {
    expect(AccessibilityRequirementsSchema.safeParse({
      largePrintProgrammes: 501,
    }).success).toBe(false);
  });

  it("rejects notes exceeding 1000 characters", () => {
    expect(AccessibilityRequirementsSchema.safeParse({
      notes: "A".repeat(1001),
    }).success).toBe(false);
  });

  it("accepts notes of exactly 1000 characters", () => {
    expect(AccessibilityRequirementsSchema.safeParse({
      notes: "A".repeat(1000),
    }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// emptyAccessibilityRequirements
// ---------------------------------------------------------------------------

describe("emptyAccessibilityRequirements", () => {
  it("returns a Zod-valid empty shape", () => {
    const empty = emptyAccessibilityRequirements();
    expect(AccessibilityRequirementsSchema.safeParse(empty).success).toBe(true);
  });

  it("round-trips through parse({}) to the same object", () => {
    const parsed = AccessibilityRequirementsSchema.parse({});
    expect(parsed).toEqual(emptyAccessibilityRequirements());
  });
});

// ---------------------------------------------------------------------------
// hasAccessibilityContent
// ---------------------------------------------------------------------------

describe("hasAccessibilityContent", () => {
  it("returns false for an empty block", () => {
    expect(hasAccessibilityContent(emptyAccessibilityRequirements())).toBe(false);
  });

  it("returns true if hearingLoopRequired is set", () => {
    expect(hasAccessibilityContent({
      ...emptyAccessibilityRequirements(),
      hearingLoopRequired: true,
    })).toBe(true);
  });

  it("returns true if wheelchairSpaces > 0", () => {
    expect(hasAccessibilityContent({
      ...emptyAccessibilityRequirements(),
      wheelchairSpaces: 1,
    })).toBe(true);
  });

  it("returns true if stepFreeRouteRequired is set", () => {
    expect(hasAccessibilityContent({
      ...emptyAccessibilityRequirements(),
      stepFreeRouteRequired: true,
    })).toBe(true);
  });

  it("returns true if signLanguageInterpreter is set", () => {
    expect(hasAccessibilityContent({
      ...emptyAccessibilityRequirements(),
      signLanguageInterpreter: true,
    })).toBe(true);
  });

  it("returns true if largePrintProgrammes > 0", () => {
    expect(hasAccessibilityContent({
      ...emptyAccessibilityRequirements(),
      largePrintProgrammes: 1,
    })).toBe(true);
  });

  it("returns true if notes has content", () => {
    expect(hasAccessibilityContent({
      ...emptyAccessibilityRequirements(),
      notes: "Rear doors for wheelchair access",
    })).toBe(true);
  });

  it("returns false if notes is only whitespace", () => {
    expect(hasAccessibilityContent({
      ...emptyAccessibilityRequirements(),
      notes: "   \n\t  ",
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasCriticalAccessibility
// ---------------------------------------------------------------------------

describe("hasCriticalAccessibility", () => {
  it("returns false for an empty block", () => {
    expect(hasCriticalAccessibility(emptyAccessibilityRequirements())).toBe(false);
  });

  it("returns true if hearingLoopRequired is set", () => {
    expect(hasCriticalAccessibility({
      ...emptyAccessibilityRequirements(),
      hearingLoopRequired: true,
    })).toBe(true);
  });

  it("returns true if wheelchairSpaces > 0", () => {
    expect(hasCriticalAccessibility({
      ...emptyAccessibilityRequirements(),
      wheelchairSpaces: 1,
    })).toBe(true);
  });

  it("returns true if signLanguageInterpreter is set", () => {
    expect(hasCriticalAccessibility({
      ...emptyAccessibilityRequirements(),
      signLanguageInterpreter: true,
    })).toBe(true);
  });

  it("returns false for stepFreeRouteRequired alone (logistical, not critical)", () => {
    expect(hasCriticalAccessibility({
      ...emptyAccessibilityRequirements(),
      stepFreeRouteRequired: true,
    })).toBe(false);
  });

  it("returns false for largePrintProgrammes alone (logistical)", () => {
    expect(hasCriticalAccessibility({
      ...emptyAccessibilityRequirements(),
      largePrintProgrammes: 10,
    })).toBe(false);
  });

  it("returns false for notes alone", () => {
    expect(hasCriticalAccessibility({
      ...emptyAccessibilityRequirements(),
      notes: "nothing urgent",
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DietarySummarySchema
// ---------------------------------------------------------------------------

describe("DietarySummarySchema", () => {
  it("parses empty object to all-zero defaults", () => {
    const result = DietarySummarySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        vegetarian: 0,
        vegan: 0,
        glutenFree: 0,
        nutFree: 0,
        halal: 0,
        kosher: 0,
        otherAllergies: "",
      });
    }
  });

  it("accepts a fully-populated block", () => {
    const full: DietarySummary = {
      vegetarian: 12,
      vegan: 5,
      glutenFree: 3,
      nutFree: 2,
      halal: 8,
      kosher: 1,
      otherAllergies: "One guest: shellfish, severe",
    };
    expect(DietarySummarySchema.safeParse(full).success).toBe(true);
  });

  it("rejects negative diet counts", () => {
    expect(DietarySummarySchema.safeParse({ vegetarian: -1 }).success).toBe(false);
  });

  it("accepts diet counts up to 10000", () => {
    expect(DietarySummarySchema.safeParse({ vegetarian: 10000 }).success).toBe(true);
  });

  it("rejects diet counts exceeding 10000", () => {
    expect(DietarySummarySchema.safeParse({ vegetarian: 10001 }).success).toBe(false);
  });

  it("rejects otherAllergies exceeding 1000 characters", () => {
    expect(DietarySummarySchema.safeParse({
      otherAllergies: "x".repeat(1001),
    }).success).toBe(false);
  });
});

describe("dietaryTotal", () => {
  it("returns 0 for an empty summary", () => {
    expect(dietaryTotal(emptyDietarySummary())).toBe(0);
  });

  it("sums all six diet counts (excludes otherAllergies)", () => {
    expect(dietaryTotal({
      vegetarian: 1,
      vegan: 2,
      glutenFree: 3,
      nutFree: 4,
      halal: 5,
      kosher: 6,
      otherAllergies: "ignored in total",
    })).toBe(21);
  });
});

describe("hasDietaryContent", () => {
  it("returns false for an empty summary", () => {
    expect(hasDietaryContent(emptyDietarySummary())).toBe(false);
  });

  it("returns true when any diet count > 0", () => {
    expect(hasDietaryContent({ ...emptyDietarySummary(), vegan: 1 })).toBe(true);
  });

  it("returns true when otherAllergies has content", () => {
    expect(hasDietaryContent({
      ...emptyDietarySummary(),
      otherAllergies: "sesame intolerance",
    })).toBe(true);
  });

  it("returns false when otherAllergies is only whitespace", () => {
    expect(hasDietaryContent({
      ...emptyDietarySummary(),
      otherAllergies: "   ",
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DoorEventSchema
// ---------------------------------------------------------------------------

describe("DoorEventSchema", () => {
  it("accepts a valid open event", () => {
    expect(DoorEventSchema.safeParse({
      at: DATETIME,
      kind: "open",
    }).success).toBe(true);
  });

  it("accepts a valid lock event with note", () => {
    expect(DoorEventSchema.safeParse({
      at: DATETIME,
      kind: "lock",
      note: "after VIP arrival",
    }).success).toBe(true);
  });

  it("defaults note to empty string when absent", () => {
    const result = DoorEventSchema.safeParse({ at: DATETIME, kind: "open" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.note).toBe("");
  });

  it("rejects non-datetime at", () => {
    expect(DoorEventSchema.safeParse({ at: "15:00", kind: "open" }).success).toBe(false);
  });

  it("rejects unknown kind", () => {
    expect(DoorEventSchema.safeParse({ at: DATETIME, kind: "seal" }).success).toBe(false);
  });

  it("exposes exactly two door-event types", () => {
    expect(DOOR_EVENT_TYPES).toEqual(["open", "lock"]);
  });
});

// ---------------------------------------------------------------------------
// DoorScheduleEntrySchema + DoorScheduleSchema
// ---------------------------------------------------------------------------

describe("DoorScheduleEntrySchema", () => {
  it("accepts a minimal entry", () => {
    expect(DoorScheduleEntrySchema.safeParse({
      label: "Front door",
    }).success).toBe(true);
  });

  it("requires a non-empty label", () => {
    expect(DoorScheduleEntrySchema.safeParse({ label: "" }).success).toBe(false);
  });

  it("trims whitespace from label", () => {
    const result = DoorScheduleEntrySchema.safeParse({ label: "  Side door  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.label).toBe("Side door");
  });

  it("rejects a label exceeding 100 chars", () => {
    expect(DoorScheduleEntrySchema.safeParse({
      label: "a".repeat(101),
    }).success).toBe(false);
  });

  it("rejects more than 10 events per door", () => {
    const events = Array.from({ length: 11 }, () => ({ at: DATETIME, kind: "open" as const }));
    expect(DoorScheduleEntrySchema.safeParse({
      label: "Front",
      events,
    }).success).toBe(false);
  });
});

describe("DoorScheduleSchema", () => {
  it("parses empty object to { entries: [] }", () => {
    const result = DoorScheduleSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ entries: [] });
  });

  it("rejects more than 12 entries", () => {
    const entries = Array.from({ length: 13 }, (_, i) => ({ label: `Door ${String(i + 1)}` }));
    expect(DoorScheduleSchema.safeParse({ entries }).success).toBe(false);
  });
});

describe("hasDoorScheduleContent", () => {
  it("returns false for empty schedule", () => {
    expect(hasDoorScheduleContent(emptyDoorSchedule())).toBe(false);
  });

  it("returns true when any entry exists", () => {
    const s: DoorSchedule = { entries: [{ label: "Front door", events: [] }] };
    expect(hasDoorScheduleContent(s)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EquipmentTagSchema
// ---------------------------------------------------------------------------

describe("EquipmentTagSchema", () => {
  it.each(EQUIPMENT_TAGS)("accepts '%s'", (tag) => {
    expect(EquipmentTagSchema.safeParse(tag).success).toBe(true);
  });

  it("exposes the 7 canonical tags", () => {
    expect(EQUIPMENT_TAGS).toEqual([
      "power-outlet",
      "av-cable-path",
      "water-supply",
      "overhead-rig",
      "data-network",
      "dimmable-lighting",
      "blackout",
    ]);
  });

  it("rejects unknown tags", () => {
    expect(EquipmentTagSchema.safeParse("fire-cable").success).toBe(false);
  });
});
