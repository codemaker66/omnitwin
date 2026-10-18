import { describe, expect, it } from "vitest";
import type { HallkeeperSheetV2, ManifestRowV2 } from "../hallkeeper-v2.js";
import type { EventInstructions } from "../hallkeeper-instructions.js";
import {
  accessNeeds,
  allergyFacts,
  otherMeals,
  sheetNoteMarkers,
  sheetRunningOrder,
  sheetSetupSteps,
  sheetStoreList,
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
    timing: { eventStart: bst(14, 30), setupBy: bst(13, 30), bufferMinutes: 60 },
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
      "Service door opens", "Structure done", "Team briefing", "Room ready", "Technical done", "Event starts", "Service door locks",
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
    expect(day.find((line) => line.title === "Service door locks")?.nextDay).toBe(true);
    expect(day.find((line) => line.title === "Service door opens")?.nextDay).toBe(false);
  });

  it("names the briefing's procedures", () => {
    expect(day.find((line) => line.title === "Team briefing")?.detail).toBe("Evacuation, invacuation, lockdown and communication");
  });

  it("has nothing to say without times or instructions", () => {
    expect(sheetRunningOrder(sheet({ timing: null }))).toEqual([]);
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
      name: "Parquet Dance Floor Panel", qty: 30, chairs: null, accessory: false, notes: [],
      where: [{ zone: "Perimeter", qty: 16 }, { zone: "East wall", qty: 10 }, { zone: "Centre", qty: 4 }],
    }]);
    expect(steps[0]?.deadline).toEqual({ at: bst(10), reason: "Band at 10:15", late: false });
  });

  it("reads chairs out of the generator's names", () => {
    const furniture = steps[1]?.items ?? [];
    expect(furniture[0]).toMatchObject({ name: "6ft Round Table", qty: 11, chairs: { total: 110, each: 10 } });
    expect(furniture[1]).toMatchObject({ name: "Trestle Table (White Cloth)", qty: 3, chairs: { total: 10, each: null } });
  });

  it("prints a note once, where it first belongs", () => {
    expect(steps[1]?.items[0]?.notes).toEqual(["Table 5: peanut allergy", "Table 3: wheelchair"]);
    expect(steps[2]?.items[0]?.notes).toEqual([]);
  });

  it("labels steps in sentence case", () => {
    expect(steps.map((step) => step.label)).toEqual(["Structure", "Furniture", "Final touches"]);
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
