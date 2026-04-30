import { describe, it, expect } from "vitest";
import {
  extractEventSheet,
  type ExtractionInput,
} from "../../services/event-sheet-extractor.js";
import type { AccessoryMap, ManifestObjectV2 } from "../../services/manifest-generator-v2.js";
import type { RoomDimensions } from "../../services/spatial-classifier-v2.js";
import type {
  AccessibilityRequirements,
  ConfigurationMetadata,
  DietarySummary,
  DoorSchedule,
  EventInstructions,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Shared fixtures — Trades Hall Grand Hall dimensions + synthetic UUIDs
// ---------------------------------------------------------------------------

const ROOM: RoomDimensions = { widthM: 21, lengthM: 10.5 };

const EMPTY_ACCESSORIES: AccessoryMap = new Map();

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const UUID_D = "44444444-4444-4444-8444-444444444444";
const UUID_E = "55555555-5555-4555-8555-555555555555";

function makePlacement(
  id: string,
  assetName: string,
  assetCategory: string,
  x: number,
  z: number,
  overrides: Partial<ManifestObjectV2> = {},
): ManifestObjectV2 {
  return {
    id,
    assetName,
    assetCategory,
    positionX: x,
    positionY: 0,
    positionZ: z,
    rotationY: 0,
    chairCount: 0,
    groupId: null,
    notes: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<ExtractionInput> = {}): ExtractionInput {
  return {
    placements: [],
    accessoryMap: EMPTY_ACCESSORIES,
    metadata: null,
    room: ROOM,
    ...overrides,
  };
}

function fullAccessibility(overrides: Partial<AccessibilityRequirements> = {}): AccessibilityRequirements {
  return {
    hearingLoopRequired: false,
    hearingLoopZone: null,
    wheelchairSpaces: 0,
    stepFreeRouteRequired: false,
    signLanguageInterpreter: false,
    largePrintProgrammes: 0,
    notes: "",
    ...overrides,
  };
}

function fullDietary(overrides: Partial<DietarySummary> = {}): DietarySummary {
  return {
    vegetarian: 0,
    vegan: 0,
    glutenFree: 0,
    nutFree: 0,
    halal: 0,
    kosher: 0,
    otherAllergies: "",
    ...overrides,
  };
}

function metadataWith(instructions: Partial<EventInstructions>): ConfigurationMetadata {
  const base: EventInstructions = {
    specialInstructions: "",
    dayOfContact: null,
    phaseDeadlines: [],
    accessNotes: "",
    accessibility: null,
    dietary: null,
    doorSchedule: null,
  };
  return { instructions: { ...base, ...instructions } };
}

// ---------------------------------------------------------------------------
// Output shape smoke test
// ---------------------------------------------------------------------------

describe("extractEventSheet — output shape", () => {
  it("returns every expected top-level key", () => {
    const out = extractEventSheet(baseInput());
    expect(Object.keys(out).sort()).toEqual([
      "accessibilityCallouts",
      "dietary",
      "doorSchedule",
      "implicitRequirements",
      "manifest",
      "sourceHash",
    ]);
  });

  it("returns an empty manifest + empty collections on empty input", () => {
    const out = extractEventSheet(baseInput());
    expect(out.manifest.phases).toEqual([]);
    expect(out.manifest.totals.totalRows).toBe(0);
    expect(out.manifest.totals.totalItems).toBe(0);
    expect(out.implicitRequirements).toEqual([]);
    expect(out.accessibilityCallouts).toEqual([]);
    expect(out.dietary).toBeNull();
    expect(out.doorSchedule).toBeNull();
  });

  it("produces a 64-char hex sourceHash even on empty input", () => {
    const out = extractEventSheet(baseInput());
    expect(out.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// sourceHash — determinism and sensitivity
// ---------------------------------------------------------------------------

describe("extractEventSheet — sourceHash determinism", () => {
  it("is deterministic — same input → same hash", () => {
    const input = baseInput({
      placements: [
        makePlacement(UUID_A, "Laser Projector", "av", 0, 0),
        makePlacement(UUID_B, "Lectern", "lectern", 2, 1),
      ],
    });
    const h1 = extractEventSheet(input).sourceHash;
    const h2 = extractEventSheet(input).sourceHash;
    expect(h1).toBe(h2);
  });

  it("is order-independent — shuffling placements preserves the hash", () => {
    const ordered = baseInput({
      placements: [
        makePlacement(UUID_A, "Laser Projector", "av", 0, 0),
        makePlacement(UUID_B, "Lectern", "lectern", 2, 1),
        makePlacement(UUID_C, "6ft Round Table", "table", -3, 2),
      ],
    });
    const shuffled = baseInput({
      placements: [
        makePlacement(UUID_C, "6ft Round Table", "table", -3, 2),
        makePlacement(UUID_A, "Laser Projector", "av", 0, 0),
        makePlacement(UUID_B, "Lectern", "lectern", 2, 1),
      ],
    });
    expect(extractEventSheet(ordered).sourceHash).toBe(
      extractEventSheet(shuffled).sourceHash,
    );
  });

  it("rounds positions to 3 decimals — sub-millimetre edits don't change the hash", () => {
    const a = baseInput({
      placements: [makePlacement(UUID_A, "Laser Projector", "av", 1.0000001, 2)],
    });
    const b = baseInput({
      placements: [makePlacement(UUID_A, "Laser Projector", "av", 1.0000002, 2)],
    });
    expect(extractEventSheet(a).sourceHash).toBe(extractEventSheet(b).sourceHash);
  });

  it("rounds rotations to 5 decimals — sub-microradian edits don't change the hash", () => {
    const a = baseInput({
      placements: [makePlacement(UUID_A, "Lectern", "lectern", 0, 0, { rotationY: 0.000001 })],
    });
    const b = baseInput({
      placements: [makePlacement(UUID_A, "Lectern", "lectern", 0, 0, { rotationY: 0.000002 })],
    });
    expect(extractEventSheet(a).sourceHash).toBe(extractEventSheet(b).sourceHash);
  });

  it("trims placement notes — whitespace-only edits don't change the hash", () => {
    const a = baseInput({
      placements: [makePlacement(UUID_A, "Lectern", "lectern", 0, 0, { notes: "VIP" })],
    });
    const b = baseInput({
      placements: [makePlacement(UUID_A, "Lectern", "lectern", 0, 0, { notes: "  VIP  " })],
    });
    expect(extractEventSheet(a).sourceHash).toBe(extractEventSheet(b).sourceHash);
  });
});

describe("extractEventSheet — sourceHash sensitivity", () => {
  it("changes when a placement is added", () => {
    const one = baseInput({
      placements: [makePlacement(UUID_A, "Lectern", "lectern", 0, 0)],
    });
    const two = baseInput({
      placements: [
        makePlacement(UUID_A, "Lectern", "lectern", 0, 0),
        makePlacement(UUID_B, "Laser Projector", "av", 1, 1),
      ],
    });
    expect(extractEventSheet(one).sourceHash).not.toBe(extractEventSheet(two).sourceHash);
  });

  it("changes when a placement moves > 1mm", () => {
    const a = baseInput({
      placements: [makePlacement(UUID_A, "Laser Projector", "av", 1.000, 0)],
    });
    const b = baseInput({
      placements: [makePlacement(UUID_A, "Laser Projector", "av", 1.002, 0)],
    });
    expect(extractEventSheet(a).sourceHash).not.toBe(extractEventSheet(b).sourceHash);
  });

  it("changes when a placement rotates > 0.00001 rad", () => {
    const a = baseInput({
      placements: [makePlacement(UUID_A, "Lectern", "lectern", 0, 0, { rotationY: 0.0001 })],
    });
    const b = baseInput({
      placements: [makePlacement(UUID_A, "Lectern", "lectern", 0, 0, { rotationY: 0.0002 })],
    });
    expect(extractEventSheet(a).sourceHash).not.toBe(extractEventSheet(b).sourceHash);
  });

  it("changes when placement notes differ", () => {
    const a = baseInput({
      placements: [makePlacement(UUID_A, "Lectern", "lectern", 0, 0, { notes: "VIP" })],
    });
    const b = baseInput({
      placements: [makePlacement(UUID_A, "Lectern", "lectern", 0, 0, { notes: "Press" })],
    });
    expect(extractEventSheet(a).sourceHash).not.toBe(extractEventSheet(b).sourceHash);
  });

  it("changes when metadata.instructions.accessibility flags flip", () => {
    const a = baseInput({ metadata: null });
    const b = baseInput({
      metadata: metadataWith({
        accessibility: fullAccessibility({ hearingLoopRequired: true, hearingLoopZone: "Centre" }),
      }),
    });
    expect(extractEventSheet(a).sourceHash).not.toBe(extractEventSheet(b).sourceHash);
  });

  it("changes when room dimensions differ", () => {
    const small = baseInput({ room: { widthM: 10, lengthM: 10 } });
    const big = baseInput({ room: { widthM: 21, lengthM: 10.5 } });
    expect(extractEventSheet(small).sourceHash).not.toBe(extractEventSheet(big).sourceHash);
  });
});

// ---------------------------------------------------------------------------
// Implicit requirements — equipment-tag extraction
// ---------------------------------------------------------------------------

describe("extractEventSheet — implicitRequirements", () => {
  it("returns empty for placements with no equipment tags (chairs/tables/decor)", () => {
    const out = extractEventSheet(baseInput({
      placements: [
        makePlacement(UUID_A, "6ft Round Table", "table", 0, 0),
        makePlacement(UUID_B, "Banquet Chair", "chair", 1, 0),
        makePlacement(UUID_C, "Black Table Cloth", "decor", 2, 0),
      ],
    }));
    expect(out.implicitRequirements).toEqual([]);
  });

  it("emits power-outlet + av-cable-path for a projector", () => {
    const out = extractEventSheet(baseInput({
      placements: [makePlacement(UUID_A, "Laser Projector", "av", 0, 0)],
    }));
    const tags = out.implicitRequirements.map((r) => r.tag);
    expect(tags).toContain("power-outlet");
    expect(tags).toContain("av-cable-path");
  });

  it("emits power + av-cable + data-network for a laptop", () => {
    const out = extractEventSheet(baseInput({
      placements: [makePlacement(UUID_A, "Laptop", "av", 0, 0)],
    }));
    const tags = new Set(out.implicitRequirements.map((r) => r.tag));
    expect(tags).toContain("power-outlet");
    expect(tags).toContain("av-cable-path");
    expect(tags).toContain("data-network");
  });

  it("emits overhead-rig + dimmable-lighting + blackout for a projector screen", () => {
    const out = extractEventSheet(baseInput({
      placements: [makePlacement(UUID_A, "Projector Screen", "av", 0, 0)],
    }));
    const tags = new Set(out.implicitRequirements.map((r) => r.tag));
    expect(tags).toContain("overhead-rig");
    expect(tags).toContain("dimmable-lighting");
    expect(tags).toContain("blackout");
  });

  it("emits dimmable-lighting for a stage platform", () => {
    const out = extractEventSheet(baseInput({
      placements: [makePlacement(UUID_A, "Platform", "stage", 0, 0)],
    }));
    expect(out.implicitRequirements.map((r) => r.tag)).toContain("dimmable-lighting");
  });

  it("emits water-supply for a lectern", () => {
    const out = extractEventSheet(baseInput({
      placements: [makePlacement(UUID_A, "Lectern", "lectern", 0, 0)],
    }));
    expect(out.implicitRequirements.map((r) => r.tag)).toContain("water-supply");
  });

  it("aggregates a tag across multiple placements with a count", () => {
    const out = extractEventSheet(baseInput({
      placements: [
        makePlacement(UUID_A, "Laser Projector", "av", 0, 0),
        makePlacement(UUID_B, "Laser Projector", "av", 2, 0),
        makePlacement(UUID_C, "Laptop", "av", 4, 0),
      ],
    }));
    const power = out.implicitRequirements.find((r) => r.tag === "power-outlet");
    expect(power).toBeDefined();
    expect(power?.count).toBe(3);
  });

  it("orders tags in the canonical EQUIPMENT_TAGS order", () => {
    const out = extractEventSheet(baseInput({
      placements: [
        makePlacement(UUID_A, "Laptop", "av", 0, 0),
        makePlacement(UUID_B, "Projector Screen", "av", 2, 0),
      ],
    }));
    const tags = out.implicitRequirements.map((r) => r.tag);
    const canonicalOrder = [
      "power-outlet", "av-cable-path", "water-supply",
      "overhead-rig", "data-network", "dimmable-lighting", "blackout",
    ];
    const indexed = tags.map((t) => canonicalOrder.indexOf(t));
    for (let i = 1; i < indexed.length; i++) {
      expect(indexed[i]).toBeGreaterThan(indexed[i - 1]!);
    }
  });

  it("populates each requirement's sources with assetName + zone", () => {
    const out = extractEventSheet(baseInput({
      placements: [
        makePlacement(UUID_A, "Laser Projector", "av", 0, 0),
      ],
    }));
    const power = out.implicitRequirements.find((r) => r.tag === "power-outlet");
    expect(power?.sources).toHaveLength(1);
    expect(power?.sources[0]?.assetName).toBe("Laser Projector");
    expect(power?.sources[0]?.zone).toBe("Centre");
  });

  it("silently skips placements whose asset name isn't in CANONICAL_ASSETS", () => {
    const out = extractEventSheet(baseInput({
      placements: [
        makePlacement(UUID_A, "Flux Capacitor", "av", 0, 0),
        makePlacement(UUID_B, "Laser Projector", "av", 1, 0),
      ],
    }));
    const power = out.implicitRequirements.find((r) => r.tag === "power-outlet");
    expect(power?.count).toBe(1);
  });

  it("sorts sources deterministically by assetName then zone", () => {
    const out = extractEventSheet(baseInput({
      placements: [
        makePlacement(UUID_A, "Laser Projector", "av", 0, 0),
        makePlacement(UUID_B, "Laptop", "av", 0, 0),
        makePlacement(UUID_C, "Laser Projector", "av", -10, 0),
      ],
    }));
    const power = out.implicitRequirements.find((r) => r.tag === "power-outlet");
    expect(power).toBeDefined();
    const names = power?.sources.map((s) => s.assetName) ?? [];
    // Laptop (single placement) comes before the two Laser Projectors
    // because "Laptop" < "Laser Projector" alphabetically.
    expect(names[0]).toBe("Laptop");
  });
});

// ---------------------------------------------------------------------------
// Accessibility callouts
// ---------------------------------------------------------------------------

describe("extractEventSheet — accessibility callouts", () => {
  it("returns empty when metadata is null", () => {
    expect(extractEventSheet(baseInput()).accessibilityCallouts).toEqual([]);
  });

  it("returns empty when accessibility block is absent", () => {
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({}),
    }));
    expect(out.accessibilityCallouts).toEqual([]);
  });

  it("returns empty when accessibility block is all-default", () => {
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({ accessibility: fullAccessibility() }),
    }));
    expect(out.accessibilityCallouts).toEqual([]);
  });

  it("emits a critical callout for a hearing loop with a zone", () => {
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({
        accessibility: fullAccessibility({
          hearingLoopRequired: true,
          hearingLoopZone: "Centre",
        }),
      }),
    }));
    expect(out.accessibilityCallouts).toHaveLength(1);
    expect(out.accessibilityCallouts[0]?.severity).toBe("critical");
    expect(out.accessibilityCallouts[0]?.label).toBe("Hearing loop");
    expect(out.accessibilityCallouts[0]?.detail).toContain("Centre");
  });

  it("emits a critical callout with 'planner action required' when zone not set", () => {
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({
        accessibility: fullAccessibility({
          hearingLoopRequired: true,
          hearingLoopZone: null,
        }),
      }),
    }));
    expect(out.accessibilityCallouts[0]?.detail).toContain("planner action required");
  });

  it("emits a critical callout for wheelchair spaces > 0", () => {
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({
        accessibility: fullAccessibility({ wheelchairSpaces: 3 }),
      }),
    }));
    expect(out.accessibilityCallouts).toHaveLength(1);
    expect(out.accessibilityCallouts[0]?.severity).toBe("critical");
    expect(out.accessibilityCallouts[0]?.detail).toContain("3");
  });

  it("emits a critical callout for sign-language interpreter", () => {
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({
        accessibility: fullAccessibility({ signLanguageInterpreter: true }),
      }),
    }));
    expect(out.accessibilityCallouts[0]?.severity).toBe("critical");
  });

  it("emits a warning callout for step-free route", () => {
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({
        accessibility: fullAccessibility({ stepFreeRouteRequired: true }),
      }),
    }));
    expect(out.accessibilityCallouts[0]?.severity).toBe("warning");
  });

  it("emits an info callout for large-print programmes", () => {
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({
        accessibility: fullAccessibility({ largePrintProgrammes: 20 }),
      }),
    }));
    expect(out.accessibilityCallouts[0]?.severity).toBe("info");
    expect(out.accessibilityCallouts[0]?.detail).toContain("20");
  });

  it("emits an info callout for non-empty notes", () => {
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({
        accessibility: fullAccessibility({ notes: "BSL interpreter stage-left" }),
      }),
    }));
    expect(out.accessibilityCallouts[0]?.severity).toBe("info");
    expect(out.accessibilityCallouts[0]?.detail).toBe("BSL interpreter stage-left");
  });

  it("sorts callouts critical → warning → info", () => {
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({
        accessibility: fullAccessibility({
          hearingLoopRequired: true,
          hearingLoopZone: "Centre",
          stepFreeRouteRequired: true,
          largePrintProgrammes: 5,
          notes: "Interpreter stage left",
        }),
      }),
    }));
    const severities = out.accessibilityCallouts.map((c) => c.severity);
    const firstWarningIdx = severities.indexOf("warning");
    const firstInfoIdx = severities.indexOf("info");
    for (let i = 0; i < firstWarningIdx; i++) {
      expect(severities[i]).toBe("critical");
    }
    for (let i = firstWarningIdx; i < firstInfoIdx; i++) {
      expect(severities[i]).toBe("warning");
    }
  });

  it("groups multiple criticals together when all three are set", () => {
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({
        accessibility: fullAccessibility({
          hearingLoopRequired: true,
          hearingLoopZone: "North wall",
          wheelchairSpaces: 2,
          signLanguageInterpreter: true,
        }),
      }),
    }));
    expect(out.accessibilityCallouts).toHaveLength(3);
    for (const c of out.accessibilityCallouts) {
      expect(c.severity).toBe("critical");
    }
  });

  it("ignores whitespace-only notes", () => {
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({
        accessibility: fullAccessibility({ notes: "   \t\n  " }),
      }),
    }));
    expect(out.accessibilityCallouts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Dietary
// ---------------------------------------------------------------------------

describe("extractEventSheet — dietary", () => {
  it("returns null when metadata is null", () => {
    expect(extractEventSheet(baseInput()).dietary).toBeNull();
  });

  it("returns null when dietary is all-zero", () => {
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({ dietary: fullDietary() }),
    }));
    expect(out.dietary).toBeNull();
  });

  it("passes through non-empty dietary", () => {
    const diet = fullDietary({ vegetarian: 12, vegan: 5, otherAllergies: "sesame × 1" });
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({ dietary: diet }),
    }));
    expect(out.dietary).toEqual(diet);
  });

  it("returns dietary when only otherAllergies is set", () => {
    const diet = fullDietary({ otherAllergies: "celiac" });
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({ dietary: diet }),
    }));
    expect(out.dietary).not.toBeNull();
    expect(out.dietary?.otherAllergies).toBe("celiac");
  });
});

// ---------------------------------------------------------------------------
// Door schedule
// ---------------------------------------------------------------------------

describe("extractEventSheet — doorSchedule", () => {
  it("returns null when metadata is null", () => {
    expect(extractEventSheet(baseInput()).doorSchedule).toBeNull();
  });

  it("returns null when doorSchedule has no entries", () => {
    const schedule: DoorSchedule = { entries: [] };
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({ doorSchedule: schedule }),
    }));
    expect(out.doorSchedule).toBeNull();
  });

  it("sorts events per door chronologically by ISO datetime", () => {
    const schedule: DoorSchedule = {
      entries: [{
        label: "Front door",
        events: [
          { at: "2026-06-15T21:00:00.000Z", kind: "lock", note: "overnight" },
          { at: "2026-06-15T15:00:00.000Z", kind: "open", note: "early" },
          { at: "2026-06-15T18:00:00.000Z", kind: "lock", note: "during event" },
        ],
      }],
    };
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({ doorSchedule: schedule }),
    }));
    const times = out.doorSchedule?.entries[0]?.events.map((e) => e.at) ?? [];
    expect(times).toEqual([
      "2026-06-15T15:00:00.000Z",
      "2026-06-15T18:00:00.000Z",
      "2026-06-15T21:00:00.000Z",
    ]);
  });

  it("preserves door-entry order as authored by the planner", () => {
    const schedule: DoorSchedule = {
      entries: [
        { label: "Main door", events: [] },
        { label: "Service door", events: [] },
      ],
    };
    const out = extractEventSheet(baseInput({
      metadata: metadataWith({ doorSchedule: schedule }),
    }));
    expect(out.doorSchedule?.entries[0]?.label).toBe("Main door");
    expect(out.doorSchedule?.entries[1]?.label).toBe("Service door");
  });
});

// ---------------------------------------------------------------------------
// Manifest composition — delegates to generateManifestV2
// ---------------------------------------------------------------------------

describe("extractEventSheet — manifest composition", () => {
  it("populates the manifest via generateManifestV2", () => {
    const out = extractEventSheet(baseInput({
      placements: [
        makePlacement(UUID_A, "6ft Round Table", "table", 0, 0),
        makePlacement(UUID_B, "6ft Round Table", "table", 5, 0),
      ],
    }));
    expect(out.manifest.totals.totalItems).toBe(2);
    expect(out.manifest.totals.totalRows).toBeGreaterThanOrEqual(1);
  });

  it("treats a chair with a groupId as belonging to its parent row", () => {
    const out = extractEventSheet(baseInput({
      placements: [
        makePlacement(UUID_A, "6ft Round Table", "table", 0, 0, { groupId: "g1" }),
        makePlacement(UUID_B, "Banquet Chair", "chair", 1, 0, { groupId: "g1" }),
        makePlacement(UUID_C, "Banquet Chair", "chair", -1, 0, { groupId: "g1" }),
      ],
    }));
    const allRows = out.manifest.phases.flatMap((p) => p.zones.flatMap((z) => z.rows));
    const tableRow = allRows.find((r) => r.name.includes("6ft Round Table"));
    expect(tableRow?.name).toContain("2 chairs");
  });

  it("passes through an ungrouped chair as its own row", () => {
    const out = extractEventSheet(baseInput({
      placements: [
        makePlacement(UUID_A, "Banquet Chair", "chair", 0, 0, { groupId: null }),
      ],
    }));
    const allRows = out.manifest.phases.flatMap((p) => p.zones.flatMap((z) => z.rows));
    expect(allRows.some((r) => r.name === "Banquet Chair")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full composition — all extraction dimensions at once
// ---------------------------------------------------------------------------

describe("extractEventSheet — full composition", () => {
  it("composes manifest, tags, accessibility, dietary, and doors together", () => {
    const metadata: ConfigurationMetadata = metadataWith({
      accessibility: fullAccessibility({
        hearingLoopRequired: true,
        hearingLoopZone: "Centre",
        wheelchairSpaces: 2,
      }),
      dietary: fullDietary({ vegetarian: 8, vegan: 3 }),
      doorSchedule: {
        entries: [{
          label: "Front door",
          events: [
            { at: "2026-06-15T16:30:00.000Z", kind: "open", note: "" },
            { at: "2026-06-15T22:00:00.000Z", kind: "lock", note: "" },
          ],
        }],
      },
    });
    const out = extractEventSheet(baseInput({
      placements: [
        makePlacement(UUID_A, "Laser Projector", "av", 0, 0),
        makePlacement(UUID_B, "Projector Screen", "av", 0, 3),
        makePlacement(UUID_C, "Lectern", "lectern", 1, 0),
        makePlacement(UUID_D, "6ft Round Table", "table", 5, 0, { groupId: "t1" }),
        makePlacement(UUID_E, "Banquet Chair", "chair", 6, 0, { groupId: "t1" }),
      ],
      metadata,
    }));

    expect(out.manifest.totals.totalItems).toBeGreaterThan(0);

    const tagSet = new Set(out.implicitRequirements.map((r) => r.tag));
    expect(tagSet).toContain("power-outlet");
    expect(tagSet).toContain("av-cable-path");
    expect(tagSet).toContain("overhead-rig");
    expect(tagSet).toContain("water-supply");

    expect(out.accessibilityCallouts).toHaveLength(2);
    for (const c of out.accessibilityCallouts) {
      expect(c.severity).toBe("critical");
    }

    expect(out.dietary?.vegetarian).toBe(8);

    const events = out.doorSchedule?.entries[0]?.events ?? [];
    expect(events).toHaveLength(2);
    expect(events[0]?.kind).toBe("open");
    expect(events[1]?.kind).toBe("lock");

    expect(out.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
