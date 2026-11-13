import { describe, expect, it } from "vitest";
import type { HallkeeperSheetV2, ManifestRowV2 } from "../hallkeeper-v2.js";
import type { EventInstructions } from "../hallkeeper-instructions.js";
import {
  careTables,
  formatTableLabels,
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
      name: "Parquet Dance Floor Panel", qty: 30, chairs: null, accessory: false, notes: [],
      where: [{ zone: "Perimeter", qty: 16 }, { zone: "East wall", qty: 10 }, { zone: "Centre", qty: 4 }],
      labels: [],
    }]);
    expect(steps[0]?.deadline).toEqual({ at: bst(10), reason: "Band at 10:15", late: false, otherDay: false });
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

  it("counts chairs in all when some merged tables have none", () => {
    const mixed = sheetSetupSteps(sheet({ phases: [{ phase: "furniture", zones: [
      { zone: "Centre", rows: [row({ name: "6ft Round Table with 10 chairs", qty: 3 })] },
      { zone: "Perimeter", rows: [row({ name: "6ft Round Table", qty: 2 })] },
    ] }] }));
    expect(mixed[0]?.items[0]).toMatchObject({ name: "6ft Round Table", qty: 5, chairs: { total: 30, each: null } });
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

  it("reads only the planner's own words, never the counts the sheet adds", () => {
    const base = careSheet("", "", ["1", "4"]);
    const access = base.instructions?.accessibility;
    if (access === undefined || access === null) throw new Error("the care sheet records access needs");
    // "1 wheelchair space" and "4 large-print programmes" are the sheet's own lines.
    const counted = { ...base, instructions: { ...EMPTY_INSTRUCTIONS, ...base.instructions, accessibility: { ...access, largePrintProgrammes: 4 } } };
    expect(careTables(counted).size).toBe(0);
  });
});
