import { describe, expect, it } from "vitest";
import {
  changeoverSplit,
  type EventInstructions,
  type HallkeeperFloorPlan,
  type HallkeeperSheetV2,
  type ManifestRowV2,
  type SetupPhase,
  type Zone,
} from "@omnitwin/types";
import { MAX_PAIRED_PIECES, changeoverBetween } from "../lib/changeover.js";
import { generateManifestV2, type AccessoryMap, type ManifestObjectV2 } from "../services/manifest-generator-v2.js";

// ---------------------------------------------------------------------------
// What moves at a changeover: the room goes from the layout one booking
// leaves to the layout the next booking needs. Each case is what a crew
// would otherwise work out by laying two sheets side by side.
// ---------------------------------------------------------------------------

const FROM = { configId: "00000000-0000-4000-8000-0000000000c1" } as const;
const TO = { configId: "00000000-0000-4000-8000-0000000000c2" } as const;
const ROUND = "00000000-0000-4000-8000-0000000000a1";
const CHAIR = "00000000-0000-4000-8000-0000000000a2";
const LECTERN = "00000000-0000-4000-8000-0000000000a3";

const EMPTY_INSTRUCTIONS: EventInstructions = {
  specialInstructions: "", dayOfContact: null, phaseDeadlines: [], accessNotes: "",
  accessibility: null, dietary: null, doorSchedule: null,
};

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${idCounter.toString(16).padStart(12, "0")}`;
}

interface RowSpec {
  readonly phase?: SetupPhase;
  readonly zone?: Zone;
  readonly name: string;
  readonly category?: string;
  readonly qty: number;
  readonly isAccessory?: boolean;
}

type Piece = HallkeeperFloorPlan["objects"][number];

function round(x: number, z: number, label?: string): Piece {
  return {
    objectId: nextId(), assetDefinitionId: ROUND, name: "6ft Round Table", category: "table",
    x, z, rotationY: 0, scale: 1, widthM: 1.83, depthM: 1.83, collisionType: "cylinder",
    ...(label === undefined ? {} : { label }),
  };
}

function chair(x: number, z: number): Piece {
  return {
    objectId: nextId(), assetDefinitionId: CHAIR, name: "Banquet chair", category: "chair",
    x, z, rotationY: 0, scale: 1, widthM: 0.45, depthM: 0.45, collisionType: "box",
  };
}

function sheet(spec: { readonly name?: string; readonly guests?: number; readonly rows: readonly RowSpec[]; readonly plan?: readonly Piece[] | null }): HallkeeperSheetV2 {
  const phases = new Map<SetupPhase, Map<Zone, ManifestRowV2[]>>();
  for (const row of spec.rows) {
    const phase = row.phase ?? "furniture";
    const zone = row.zone ?? "Centre";
    const zones = phases.get(phase) ?? new Map<Zone, ManifestRowV2[]>();
    const list = zones.get(zone) ?? [];
    list.push({
      key: `${phase}|${zone}|${row.name}|0`, name: row.name, category: row.category ?? "table", qty: row.qty,
      afterDepth: 0, isAccessory: row.isAccessory ?? false, notes: "", positions: [],
    });
    zones.set(zone, list);
    phases.set(phase, zones);
  }
  return {
    config: { id: FROM.configId, name: spec.name ?? "Anderson wedding", guestCount: spec.guests ?? 180, layoutStyle: "dinner-rounds" },
    venue: { name: "Trades Hall Glasgow", address: "85 Glassford St", logoUrl: null, timezone: "Europe/London" },
    space: { name: "Grand Hall", widthM: 21, lengthM: 10.5, heightM: 7 },
    timing: null,
    instructions: EMPTY_INSTRUCTIONS,
    phases: [...phases].map(([phase, zones]) => ({ phase, zones: [...zones].map(([zone, rows]) => ({ zone, rows })) })),
    totals: { entries: [], totalRows: spec.rows.length, totalItems: spec.rows.reduce((sum, row) => sum + row.qty, 0) },
    diagramUrl: null,
    ...(spec.plan === undefined ? {} : {
      floorPlan: spec.plan === null ? null : {
        coordinateSpace: "real_m_v1" as const,
        outline: [{ x: -10.5, z: -5.25 }, { x: 10.5, z: -5.25 }, { x: 10.5, z: 5.25 }, { x: -10.5, z: 5.25 }],
        objects: [...spec.plan],
      },
    }),
    webViewUrl: "http://localhost:5173/hallkeeper/cfg",
    generatedAt: "2026-11-14T10:00:00.000Z",
    approval: null,
  };
}

describe("changeoverBetween: the items", () => {
  it("leaves everything in place when the next booking uses the same layout", () => {
    const rows = [{ name: "6ft Round Table with 10 chairs", qty: 18 }, { name: "White cloth", category: "linen", qty: 18, phase: "dress" as const, isAccessory: true }];
    const changeover = changeoverBetween(FROM, TO, sheet({ rows }), sheet({ rows }));
    expect(changeover.items.map((item) => [item.name, item.before, item.after, item.zones])).toEqual([
      ["6ft Round Table", 18, 18, []],
      ["Chairs", 180, 180, []],
      ["White cloth", 18, 18, []],
    ]);
  });

  it("splits a smaller next booking into what stays and what goes back to store", () => {
    const changeover = changeoverBetween(FROM, TO,
      sheet({ rows: [{ name: "Round", qty: 18 }] }),
      sheet({ rows: [{ name: "Round", qty: 12 }] }));
    const [item] = changeover.items;
    // Sheets without plans give counts, never parts of the room.
    expect(item).toMatchObject({ before: 18, after: 12, zones: [] });
    expect(changeover.zonesCompared).toBe(false);
    expect(changeoverSplit(item ?? { before: 0, after: 0 })).toEqual({ stays: 12, toStore: 6, fromStore: 0 });
  });

  it("brings out what the next booking needs and strikes what it does not", () => {
    const changeover = changeoverBetween(FROM, TO,
      sheet({ rows: [{ name: "Dance floor", category: "stage", qty: 1, phase: "structure" }, { name: "Round", qty: 18 }] }),
      sheet({ rows: [{ name: "Lectern", category: "av", qty: 1, phase: "technical", zone: "North wall" }, { name: "Banquet chair", category: "chair", qty: 200 }] }));
    expect(changeover.items.map((item) => [item.name, item.before, item.after])).toEqual([
      ["Dance floor", 1, 0],
      ["Banquet chair", 0, 200],
      ["Round", 18, 0],
      ["Lectern", 0, 1],
    ]);
    expect(changeoverSplit({ before: 0, after: 200 })).toEqual({ stays: 0, toStore: 0, fromStore: 200 });
  });

  it("names the layouts and their guests", () => {
    const changeover = changeoverBetween(FROM, TO, sheet({ name: "Wedding", guests: 180, rows: [] }), sheet({ name: "Conference", guests: 200, rows: [] }));
    expect([changeover.from, changeover.to]).toEqual([
      { configId: FROM.configId, name: "Wedding", guests: 180, hasPlan: false },
      { configId: TO.configId, name: "Conference", guests: 200, hasPlan: false },
    ]);
    const planned = changeoverBetween(FROM, TO, sheet({ rows: [], plan: null }), sheet({ rows: [], plan: [round(0, 0)] }));
    expect([planned.from.hasPlan, planned.to.hasPlan]).toEqual([false, true]);
  });
});

// Layouts as the planner saves them: each round grouped with its chairs,
// which the sheet's generator folds into the table's row ("6ft Round Table
// with 10 chairs"), and the plan that keeps every piece.
const ROOM = { widthM: 21, lengthM: 10.5 } as const;
const LINEN: AccessoryMap = new Map([["6ft Round Table", [
  { name: "Black Round Table Linen", category: "decor", quantityPerParent: 1, phase: "dress" as const, afterDepth: 0 },
]]]);

interface Saved { readonly objects: ManifestObjectV2[]; readonly plan: Piece[] }

function place(saved: Saved, piece: Piece, groupId: string | null): void {
  saved.plan.push(piece);
  saved.objects.push({
    id: piece.objectId, assetName: piece.name, assetCategory: piece.category,
    positionX: piece.x, positionY: 0, positionZ: piece.z, rotationY: piece.rotationY, chairCount: 0, groupId,
  });
}

function rounds(tables: number, chairsEach: number): Saved {
  const saved: Saved = { objects: [], plan: [] };
  for (let t = 0; t < tables; t += 1) {
    const x = -7.5 + (t % 6) * 3;
    const z = -3 + Math.floor(t / 6) * 3;
    const groupId = nextId();
    place(saved, round(x, z), groupId);
    for (let c = 0; c < chairsEach; c += 1) {
      const angle = (2 * Math.PI * c) / chairsEach;
      place(saved, { ...chair(x + Math.cos(angle) * 1.2, z + Math.sin(angle) * 1.2), rotationY: angle }, groupId);
    }
  }
  return saved;
}

function theatre(chairs: number): Saved {
  const saved: Saved = { objects: [], plan: [] };
  for (let i = 0; i < chairs; i += 1) place(saved, chair(-9 + (i % 20) * 0.9, -4 + Math.floor(i / 20) * 0.9), null);
  return saved;
}

/** The sheet the floor reads for a saved layout; `withPlan: false` is one frozen before plans were kept. */
function generated(saved: Saved, withPlan = true): HallkeeperSheetV2 {
  const manifest = generateManifestV2(saved.objects, ROOM, LINEN);
  return { ...sheet({ rows: [], plan: withPlan ? saved.plan : null }), phases: manifest.phases, totals: manifest.totals };
}

function counts(changeover: ReturnType<typeof changeoverBetween>): [string, number, number][] {
  return changeover.items.map((item) => [item.name, item.before, item.after]);
}

describe("changeoverBetween: chairs set at tables", () => {
  it("keeps every table when 10-tops become 8-tops on the same spots, and sends the spare chairs to store", () => {
    const before = generated(rounds(18, 10));
    const after = generated(rounds(18, 8));
    // The sheet's own rows share no name: the chairs are folded into the tables.
    const rowNames = (saved: HallkeeperSheetV2): string[] => saved.phases.flatMap((phase) => phase.zones.flatMap((zone) => zone.rows.map((row) => row.name)));
    expect(new Set(rowNames(before))).toEqual(new Set(["6ft Round Table with 10 chairs", "Black Round Table Linen"]));
    expect(new Set(rowNames(after))).toEqual(new Set(["6ft Round Table with 8 chairs", "Black Round Table Linen"]));
    const changeover = changeoverBetween(FROM, TO, before, after);
    expect(counts(changeover)).toEqual([
      ["6ft Round Table", 18, 18],
      ["Banquet chair", 180, 144],
      ["Black Round Table Linen", 18, 18],
    ]);
    expect(changeover.plan?.toStore).toEqual([{ name: "Banquet chair", category: "chair", count: 36 }]);
    expect(changeover.plan?.fromStore).toEqual([]);
    const paired = (changeover.plan?.staysPut ?? 0) + (changeover.plan?.moved ?? []).reduce((sum, group) => sum + group.count, 0);
    expect(paired).toBe(18 + 144);
  });

  it("strikes the tables for a theatre and brings only the chairs it lacks", () => {
    const changeover = changeoverBetween(FROM, TO, generated(rounds(18, 10)), generated(theatre(200)));
    expect(counts(changeover)).toEqual([
      ["6ft Round Table", 18, 0],
      ["Banquet chair", 180, 200],
      ["Black Round Table Linen", 18, 0],
    ]);
    expect(changeover.plan?.toStore).toEqual([{ name: "6ft Round Table", category: "table", count: 18 }]);
    expect(changeover.plan?.fromStore).toEqual([{ name: "Banquet chair", category: "chair", count: 20 }]);
  });

  it("splits a planless sheet's tables from their chairs, and then compares chairs as chairs", () => {
    const changeover = changeoverBetween(FROM, TO, generated(rounds(18, 10), false), generated(theatre(200)));
    expect(counts(changeover)).toEqual([
      ["6ft Round Table", 18, 0],
      ["Chairs", 180, 200],
      ["Black Round Table Linen", 18, 0],
    ]);
    expect(changeover.plan).toBeNull();
  });

  it("counts a planned sheet's chairs where each one stands", () => {
    const changeover = changeoverBetween(FROM, TO, generated(theatre(0)), generated(rounds(1, 10)));
    const chairs = changeover.items.find((item) => item.name === "Banquet chair");
    expect(chairs?.zones.reduce((sum, zone) => sum + zone.after, 0)).toBe(10);
  });
});

describe("changeoverBetween: the plan", () => {
  it("keeps a table that stands where the next layout needs one, whatever either event calls it", () => {
    const stays = round(0, 0, "Table 1");
    const goes = round(-8, 4, "Table 2");
    const next = [{ ...round(0, 0, "Table 7") }];
    const changeover = changeoverBetween(FROM, TO, sheet({ rows: [], plan: [stays, goes] }), sheet({ rows: [], plan: next }));
    expect(changeover.plan).toMatchObject({
      staysPut: 1,
      moved: [],
      fromStore: [],
      toStore: [{ name: "6ft Round Table", category: "table", count: 1 }],
      toStoreFootprints: [{ x: -8, z: 4 }],
    });
  });

  it("moves the tables that are needed somewhere else, nearest first, and counts the chairs with them", () => {
    const before = [round(0, 0), chair(-1, 0), chair(1, 0), round(5, 0)];
    const after = [round(0, 2), chair(-1, 2), chair(1, 2), round(5, 0)];
    const changeover = changeoverBetween(FROM, TO, sheet({ rows: [], plan: before }), sheet({ rows: [], plan: after }));
    expect(changeover.plan?.staysPut).toBe(1);
    expect(changeover.plan?.moved).toEqual([
      { name: "Banquet chair", category: "chair", count: 2 },
      { name: "6ft Round Table", category: "table", count: 1 },
    ]);
    expect(new Set(changeover.plan?.movedIds)).toEqual(new Set([after[0]?.objectId, after[1]?.objectId, after[2]?.objectId]));
  });

  it("brings from store only when the next layout needs more of a kind", () => {
    const changeover = changeoverBetween(FROM, TO,
      sheet({ rows: [], plan: [round(0, 0)] }),
      sheet({ rows: [], plan: [round(0, 0), round(6, 3), { ...round(-6, 3), assetDefinitionId: LECTERN, name: "Lectern", category: "av", collisionType: "box", widthM: 0.6, depthM: 0.5 }] }));
    expect(changeover.plan).toMatchObject({
      staysPut: 1,
      moved: [],
      fromStore: [{ name: "6ft Round Table", category: "table", count: 1 }, { name: "Lectern", category: "av", count: 1 }],
      toStore: [],
    });
  });

  it("has no plan answer when either layout was saved without one", () => {
    expect(changeoverBetween(FROM, TO, sheet({ rows: [], plan: null }), sheet({ rows: [], plan: [round(0, 0)] })).plan).toBeNull();
  });

  it("answers a hall of a thousand chairs quickly", () => {
    const before: Piece[] = [];
    for (let i = 0; i < 1000; i += 1) before.push(chair(-10 + (i % 40) * 0.5, -5 + Math.floor(i / 40) * 0.4));
    const after = before.map((piece) => ({ ...chair(piece.x + 0.37, piece.z + 0.13) }));
    const started = performance.now();
    const changeover = changeoverBetween(FROM, TO, sheet({ rows: [], plan: before }), sheet({ rows: [], plan: after }));
    expect(performance.now() - started).toBeLessThan(1500);
    expect(changeover.plan?.fromStore).toEqual([]);
    expect(changeover.plan?.toStore).toEqual([]);
  });

  it("knows a piece the catalogue renamed between the two layouts as one item, by the next layout's name", () => {
    const before = rounds(2, 10).plan;
    // The chairs' entry was renamed after the earlier layout was approved; two of them are no longer needed.
    const after = before
      .filter((piece, index) => !(piece.category === "chair" && index >= 20))
      .map((piece) => ({ ...piece, objectId: nextId(), ...(piece.category === "chair" ? { name: "Banquet Chair (gold)" } : {}) }));
    const changeover = changeoverBetween(FROM, TO, sheet({ rows: [], plan: before }), sheet({ rows: [], plan: after }));
    expect(counts(changeover)).toEqual([["6ft Round Table", 2, 2], ["Banquet Chair (gold)", 20, 18]]);
    expect(changeover.plan).toMatchObject({
      staysPut: 20,
      moved: [],
      fromStore: [],
      toStore: [{ name: "Banquet Chair (gold)", category: "chair", count: 2 }],
    });
  });

  it("keeps a trestle or a stage deck turned half round where it stands, and a square deck a quarter, but not a chair or a lectern", () => {
    const piece = (assetDefinitionId: string, name: string, category: string, widthM: number, depthM: number, x: number): Piece => ({
      objectId: nextId(), assetDefinitionId, name, category, x, z: 0, rotationY: 0, scale: 1, widthM, depthM, collisionType: "box",
    });
    const before = [
      piece("00000000-0000-4000-8000-0000000000b1", "6ft Trestle Table", "table", 1.83, 0.76, -6),
      piece("00000000-0000-4000-8000-0000000000b2", "Platform", "stage", 2.44, 1.22, -3),
      piece("00000000-0000-4000-8000-0000000000b3", "Parquet Dance Floor Panel", "stage", 0.91, 0.91, 0),
      piece(LECTERN, "Lectern", "lectern", 0.6, 0.5, 3),
      { ...chair(6, 0) },
    ];
    const turnedBy = [Math.PI, -Math.PI, Math.PI / 2, Math.PI, Math.PI];
    const after = before.map((placed, index) => ({ ...placed, objectId: nextId(), rotationY: turnedBy[index] ?? 0 }));
    const changeover = changeoverBetween(FROM, TO, sheet({ rows: [], plan: before }), sheet({ rows: [], plan: after }));
    expect(changeover.plan?.staysPut).toBe(3);
    expect(changeover.plan?.moved).toEqual([
      { name: "Banquet chair", category: "chair", count: 1 },
      { name: "Lectern", category: "lectern", count: 1 },
    ]);
    // A long deck turned a quarter does not stand where it stood.
    const quarter = changeoverBetween(FROM, TO,
      sheet({ rows: [], plan: [before[1] as Piece] }),
      sheet({ rows: [], plan: [{ ...(before[1] as Piece), objectId: nextId(), rotationY: Math.PI / 2 }] }));
    expect(quarter.plan?.moved).toEqual([{ name: "Platform", category: "stage", count: 1 }]);
  });
});

/** The same sheet, frozen while the room measured otherwise. */
function measured(frozen: HallkeeperSheetV2, widthM: number, lengthM: number): HallkeeperSheetV2 {
  return { ...frozen, space: { ...frozen.space, widthM, lengthM } };
}

function zoneChanges(changeover: ReturnType<typeof changeoverBetween>): unknown[] {
  return changeover.items.flatMap((item) => item.zones.map((zone) => ({ name: item.name, ...zone })));
}

describe("changeoverBetween: which parts of the room change", () => {
  it("finds no part changing between a planless and a planned copy of one rounds layout", () => {
    // Each round's chairs stand around it, some across a zone's edge from
    // their table: a sheet frozen without a plan lists them at the table.
    const saved = rounds(18, 10);
    const changeover = changeoverBetween(FROM, TO, generated(saved, false), generated(saved));
    expect(counts(changeover)).toEqual([
      ["6ft Round Table", 18, 18],
      ["Chairs", 180, 180],
      ["Black Round Table Linen", 18, 18],
    ]);
    expect(zoneChanges(changeover)).toEqual([]);
    expect(changeover.zonesCompared).toBe(false);
  });

  it("places both layouts in the next layout's room size, so a hall measured again since approval changes no part", () => {
    // A row of chairs 3.05 m north of the middle: in the North wall band of
    // a hall 10 m long, in the Perimeter band of one 10.59 m long.
    const saved: Saved = { objects: [], plan: [] };
    for (let i = 0; i < 12; i += 1) place(saved, chair(-5.5 + i, -3.05), null);
    const approvedEarlier = measured(generated(saved), 21, 10);
    const current = measured(generated(saved), 21.14, 10.59);
    const changeover = changeoverBetween(FROM, TO, approvedEarlier, current);
    expect(changeover.zonesCompared).toBe(true);
    expect(zoneChanges(changeover)).toEqual([]);
    expect(changeover.plan?.staysPut).toBe(12);
    // A piece brought from store is placed in the next layout's own parts of the room.
    const lectern: Piece = { ...chair(0, -3.05), assetDefinitionId: LECTERN, name: "Lectern", category: "lectern" };
    const more = changeoverBetween(FROM, TO, approvedEarlier, { ...current, floorPlan: current.floorPlan === null || current.floorPlan === undefined ? null : { ...current.floorPlan, objects: [...current.floorPlan.objects, lectern] } });
    expect(zoneChanges(more)).toEqual([{ name: "Lectern", zone: "Perimeter", before: 0, after: 1 }]);
  });

  it("gives dressing no parts of the room: each booking clears its own and lays the next's", () => {
    const changeover = changeoverBetween(FROM, TO, generated(rounds(6, 10)), generated(rounds(12, 10)));
    const linen = changeover.items.find((item) => item.isAccessory);
    expect(linen).toMatchObject({ name: "Black Round Table Linen", before: 6, after: 12, zones: [] });
  });
});

describe("changeoverBetween: bounded work", () => {
  const row = (count: number, x0: number): Piece[] =>
    Array.from({ length: count }, (_, i) => chair(x0 + (i % 40) * 0.05, -5 + Math.floor(i / 40) * 0.2));

  it("pairs no pieces beyond the limit, and still counts them and their parts of the room", () => {
    const before = row(MAX_PAIRED_PIECES + 1, -10);
    const changeover = changeoverBetween(FROM, TO, sheet({ rows: [], plan: before }), sheet({ rows: [], plan: before.slice(0, 10) }));
    expect(changeover.plan).toBeNull();
    expect(changeover.tooManyPieces).toBe(true);
    expect(counts(changeover)).toEqual([["Banquet chair", MAX_PAIRED_PIECES + 1, 10]]);
    expect(changeover.zonesCompared).toBe(true);
  });

  it("carries a few hundred chairs across the hall pair by pair, and refuses to weigh thousands that way", () => {
    // Every chair packed at the west end is needed at the east end, beyond
    // any neighbour the grid searches.
    const westToEast = changeoverBetween(FROM, TO, sheet({ rows: [], plan: row(500, -10) }), sheet({ rows: [], plan: row(500, 8) }));
    expect(westToEast.plan).toMatchObject({ staysPut: 0, moved: [{ name: "Banquet chair", count: 500 }], fromStore: [], toStore: [] });
    const started = performance.now();
    const crowded = changeoverBetween(FROM, TO, sheet({ rows: [], plan: row(MAX_PAIRED_PIECES, -10) }), sheet({ rows: [], plan: row(MAX_PAIRED_PIECES, 8) }));
    expect(performance.now() - started).toBeLessThan(1500);
    expect([crowded.plan, crowded.tooManyPieces]).toEqual([null, true]);
  });
});
