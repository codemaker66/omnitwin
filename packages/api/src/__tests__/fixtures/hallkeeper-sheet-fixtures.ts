import {
  ACCESSORY_RULES,
  CANONICAL_ASSETS,
  type EventInstructions,
  type HallkeeperSheetV2,
} from "@omnitwin/types";
import { generateManifestV2, type AccessoryMap, type ManifestObjectV2 } from "../../services/manifest-generator-v2.js";
import { buildHallkeeperFloorPlan, type FloorPlanAsset } from "../../services/hallkeeper-floor-plan.js";

// ---------------------------------------------------------------------------
// Hallkeeper sheet fixtures built through the real pipeline.
//
// Placements go through generateManifestV2 (rows, zones, phases, implied
// linen) and buildHallkeeperFloorPlan (frozen catalogue footprints), so the
// sheet sees exactly what the assembler would hand it for the same room.
// Names, phone numbers and notes are invented: 07700 900xxx is Ofcom's range
// reserved for drama.
// ---------------------------------------------------------------------------

const GRAND_HALL = { widthM: 21, lengthM: 10.5, heightM: 7 } as const;
const ROBERT_ADAM_ROOM = { widthM: 9.7, lengthM: 5.6, heightM: 2.18 } as const;

let idCounter = 0;
function fixtureId(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${idCounter.toString(16).padStart(12, "0")}`;
}

function asset(name: string): (typeof CANONICAL_ASSETS)[number] {
  const found = CANONICAL_ASSETS.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`No canonical asset named ${name}`);
  return found;
}

interface Placement {
  readonly id: string;
  readonly asset: (typeof CANONICAL_ASSETS)[number];
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  readonly groupId: string | null;
  readonly notes: string | null;
  readonly label: string | null;
}

class Layout {
  readonly placements: Placement[] = [];

  place(name: string, x: number, z: number, opts: { rotationY?: number; groupId?: string | null; notes?: string; label?: string } = {}): string {
    const id = fixtureId();
    this.placements.push({
      id, asset: asset(name), x, z,
      rotationY: opts.rotationY ?? 0,
      groupId: opts.groupId ?? null,
      notes: opts.notes ?? null,
      label: opts.label ?? null,
    });
    return id;
  }

  /** A round table with its chairs facing in, grouped as the planner groups them. */
  round(x: number, z: number, chairs: number, notes?: string, label?: string): void {
    const group = fixtureId();
    this.place("6ft Round Table", x, z, { groupId: group, ...(notes === undefined ? {} : { notes }), ...(label === undefined ? {} : { label }) });
    for (let seat = 0; seat < chairs; seat++) {
      const angle = (seat / chairs) * Math.PI * 2;
      this.place("Chiavari Wedding Chair", x + Math.cos(angle) * 1.22, z + Math.sin(angle) * 1.22, {
        rotationY: -angle - Math.PI / 2, groupId: group,
      });
    }
  }
}

function accessoryMap(): AccessoryMap {
  return new Map(Object.entries(ACCESSORY_RULES));
}

function build(layout: Layout, room: { widthM: number; lengthM: number }): Pick<HallkeeperSheetV2, "phases" | "totals" | "floorPlan"> {
  const objects: ManifestObjectV2[] = layout.placements.map((p) => ({
    id: p.id,
    assetName: p.asset.name,
    assetCategory: p.asset.category,
    positionX: p.x,
    positionY: 0,
    positionZ: p.z,
    rotationY: p.rotationY,
    chairCount: 0,
    groupId: p.groupId,
    notes: p.notes,
    // As the data layer passes them: the planner's table names and the footprints.
    displayLabel: p.label,
    widthM: p.asset.widthM,
    depthM: p.asset.depthM,
    scale: 1,
  }));
  const manifest = generateManifestV2(objects, { widthM: room.widthM, lengthM: room.lengthM }, accessoryMap());
  const assets = new Map<string, FloorPlanAsset>(layout.placements.map((p) => [p.asset.id, {
    id: p.asset.id, name: p.asset.name, category: p.asset.category,
    widthM: String(p.asset.widthM), depthM: String(p.asset.depthM), collisionType: p.asset.collisionType,
  }]));
  const hw = room.widthM / 2;
  const hl = room.lengthM / 2;
  const floorPlan = buildHallkeeperFloorPlan(
    [{ x: -hw, y: -hl }, { x: hw, y: -hl }, { x: hw, y: hl }, { x: -hw, y: hl }],
    layout.placements.map((p) => ({
      id: p.id, assetDefinitionId: p.asset.id,
      positionX: String(p.x), positionZ: String(p.z), rotationY: String(p.rotationY), scale: "1",
      metadata: { ...(p.label === null ? {} : { displayLabel: p.label }), ...(p.notes === null ? {} : { notes: p.notes }) },
    })),
    assets,
  );
  return { phases: manifest.phases, totals: manifest.totals, floorPlan };
}

/** BST on Saturday 24 October 2026 (clocks go back the next morning). */
function bst(hour: number, minute = 0, dayOffset = 0): string {
  return new Date(Date.UTC(2026, 9, 24 + dayOffset, hour - 1, minute)).toISOString();
}

// ---------------------------------------------------------------------------
// 1. A full wedding breakfast in the Grand Hall: 120 guests on rounds, a
//    top table, dance floor, band stage, bar, every instruction block filled.
// ---------------------------------------------------------------------------

function weddingLayout(): Layout {
  const layout = new Layout();
  // Top table along the north wall, seated on one side facing the room.
  const topGroups: [number, number][] = [[-1.85, 3], [0, 4], [1.85, 3]];
  for (const [x, chairs] of topGroups) {
    const group = fixtureId();
    layout.place("Trestle Table (White Cloth)", x, -4.2, {
      groupId: group,
      ...(x === 0 ? { notes: "Bride and groom centre; florist brings the top-table arrangement at 11:30", label: "Top table" } : {}),
    });
    for (let seat = 0; seat < chairs; seat++) {
      layout.place("Chiavari Wedding Chair", x - 0.6 + (1.2 * seat) / Math.max(1, chairs - 1), -4.85, { groupId: group });
    }
  }
  // Eleven rounds of ten: four columns, three rows, one left out by the entrance.
  const columns = [-8.2, -5.0, -1.8, 1.4];
  const rows = [-1.9, 0.9, 3.7];
  let tableNumber = 0;
  for (const z of rows) {
    for (const x of columns) {
      if (x === -8.2 && z === 3.7) continue;
      tableNumber += 1;
      const notes = tableNumber === 3
        ? "Table 3: wheelchair user, leave the aisle-side place without a chair"
        : tableNumber === 5
          ? "Table 5: severe peanut allergy at seat 4, catering has the card"
          : undefined;
      layout.round(x, z, 10, notes, `Table ${String(tableNumber)}`);
    }
  }
  layout.place("White Highchair", -3.7, 1.95, { notes: "Highchair for table 6" });
  // Dance floor, 6 x 5 parquet panels, east of the rounds, in one group as
  // the planner's dance-floor card lays them.
  const floor = fixtureId();
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 5; j++) {
      layout.place("Parquet Dance Floor Panel", 4.6 + i * 0.91, -1.4 + j * 0.91, { groupId: floor });
    }
  }
  // Band stage against the east wall.
  for (const z of [-1.83, 0, 1.83]) {
    layout.place("6ft × 4ft Staging Deck", 9.85, z, { rotationY: Math.PI / 2 });
  }
  layout.place("Mic Stand", 9.4, -0.9);
  layout.place("Mic Stand", 9.4, 0.9);
  // Bar and poseurs on the south wall.
  layout.place("Bar", 4.6, 4.85, { notes: "Cash bar from 21:00" });
  layout.place("Bar", 6.25, 4.85);
  layout.place("Poseur Table", 3.0, 4.2);
  layout.place("Poseur Table", 8.2, 4.2);
  layout.place("Poseur Table", 8.2, 3.0);
  // Cake, speeches and the slideshow.
  layout.place("Cake Cutting Table", 4.4, -4.2, { notes: "Needs a socket within 2 m for the cake lights" });
  layout.place("Lectern", 3.0, -4.4);
  layout.place("Handheld Microphone", 3.0, -4.4);
  layout.place("Projector Screen", -10.1, -0.5, { rotationY: Math.PI / 2 });
  layout.place("Laser Projector", -3.4, -0.5, { notes: "Slideshow during the meal; laptop comes with the best man" });
  return layout;
}

const WEDDING_INSTRUCTIONS: EventInstructions = {
  specialInstructions:
    "Ceremony is in the Saloon at 13:00; guests come through to the Grand Hall at 14:30 for the wedding breakfast.\n" +
    "Petals only on the stairs, no confetti indoors. The bride's grandmother uses a wheelchair: table 3, aisle side, step-free route from the lift.",
  dayOfContact: { name: "Kirsty Mackenzie", role: "Bride's sister", phone: "07700 900412", email: "" },
  phaseDeadlines: [
    { phase: "structure", deadline: bst(10, 0), reason: "Band loads in at 10:15" },
    { phase: "furniture", deadline: bst(11, 0), reason: "" },
    { phase: "dress", deadline: bst(12, 0), reason: "Florist from 11:30" },
    { phase: "technical", deadline: bst(12, 30), reason: "Slideshow check with the best man" },
    { phase: "final", deadline: bst(13, 30), reason: "" },
  ],
  accessNotes:
    "Suppliers use the service door. Vehicles unload for 15 minutes, then move on. Band's van leaves before 12:00.",
  accessibility: {
    hearingLoopRequired: true,
    hearingLoopZone: "Centre",
    wheelchairSpaces: 1,
    stepFreeRouteRequired: true,
    signLanguageInterpreter: false,
    largePrintProgrammes: 4,
    notes: "Large-print orders of service go on table 3.",
  },
  dietary: {
    vegetarian: 14, vegan: 4, glutenFree: 6, nutFree: 2, halal: 3, kosher: 0,
    otherAllergies: "Table 5, seat 4: severe peanut allergy, carries an adrenaline pen. Table 9: two guests coeliac.",
  },
  doorSchedule: {
    entries: [
      {
        label: "Glassford Street main door",
        events: [
          { at: bst(12, 30), kind: "open", note: "Guests arrive for the ceremony" },
          { at: bst(0, 30, 1), kind: "lock", note: "After the last guests leave" },
        ],
      },
      {
        label: "Service door",
        events: [
          { at: bst(9, 0), kind: "open", note: "Suppliers and band load-in" },
          { at: bst(18, 0), kind: "lock", note: "" },
        ],
      },
    ],
  },
  protectedPremises: {
    responsiblePerson: "Venue general manager",
    dutyLead: { name: "Callum Reid", role: "Duty manager" },
    procedures: {
      evacuation: { briefed: true },
      invacuation: { briefed: true },
      lockdown: { briefed: false, note: "Briefing at 11:30 covers it" },
      communication: { briefed: true },
    },
    briefingAt: bst(11, 30),
    doorSupervision: { arranged: true, note: "Two door staff from 18:00" },
  },
};

export function weddingSheet(): HallkeeperSheetV2 {
  return {
    config: { id: "6d1f8a52-3c1b-4f6e-9b1a-0a4c2b7e9d10", name: "Mackenzie–Ross wedding breakfast", guestCount: 120, layoutStyle: "dinner-rounds" },
    venue: { name: "Trades Hall Glasgow", address: "85 Glassford Street, Glasgow G1 1UH", logoUrl: null, timezone: "Europe/London" },
    space: { name: "Grand Hall", ...GRAND_HALL },
    timing: { eventStart: bst(14, 30), setupBy: bst(13, 30), bufferMinutes: 60 },
    instructions: WEDDING_INSTRUCTIONS,
    ...build(weddingLayout(), GRAND_HALL),
    diagramUrl: null,
    webViewUrl: "https://venviewer.com/hallkeeper/6d1f8a52-3c1b-4f6e-9b1a-0a4c2b7e9d10",
    generatedAt: bst(7, 42),
    approval: { version: 3, approvedAt: "2026-10-22T15:12:00.000Z", approverName: "Fiona Grant" },
  };
}

// ---------------------------------------------------------------------------
// 2. A lean board meeting in the Robert Adam Room: one hollow square, a
//    screen, no instructions, a draft. The common weekday sheet.
// ---------------------------------------------------------------------------

function boardLayout(): Layout {
  const layout = new Layout();
  // Six trestles in two facing rows, each table grouped with the chairs on its side.
  const seats: [number, number[]][] = [[-1.83, [-2.4, -1.2]], [0, [0]], [1.83, [1.2, 2.4]]];
  for (const [side, z, chairZ, turn] of [["north", -0.8, -1.55, Math.PI], ["south", 0.8, 1.55, 0]] as const) {
    for (const [x, chairs] of seats) {
      const group = fixtureId();
      layout.place("6ft Trestle Table", x, z, { groupId: group, ...(side === "north" && x === 0 ? { notes: "Chair's place: name card and water jug", label: "Chair" } : {}) });
      for (const cx of chairs) layout.place("Banquet Chair", cx, chairZ, { groupId: group, rotationY: turn });
    }
  }
  layout.place("Projector Screen", 4.4, 0, { rotationY: -Math.PI / 2 });
  layout.place("Laser Projector", -3.6, 0);
  layout.place("Table Microphone", 0, -0.8);
  return layout;
}

export function boardMeetingSheet(): HallkeeperSheetV2 {
  return {
    config: { id: "1b7c2e44-9d0a-4c55-8e3f-5a6b7c8d9e01", name: "Clyde Partners board meeting", guestCount: 10, layoutStyle: "boardroom" },
    venue: { name: "Trades Hall Glasgow", address: "85 Glassford Street, Glasgow G1 1UH", logoUrl: null, timezone: "Europe/London" },
    space: { name: "Robert Adam Room", ...ROBERT_ADAM_ROOM },
    timing: { eventStart: bst(9, 0), setupBy: bst(8, 30), bufferMinutes: 30 },
    instructions: null,
    ...build(boardLayout(), ROBERT_ADAM_ROOM),
    diagramUrl: null,
    webViewUrl: "https://venviewer.com/hallkeeper/1b7c2e44-9d0a-4c55-8e3f-5a6b7c8d9e01",
    generatedAt: bst(7, 5),
    approval: null,
  };
}

// ---------------------------------------------------------------------------
// 3. A draft with nothing in it yet: no booking, no rows, no plan.
// ---------------------------------------------------------------------------

export function emptyDraftSheet(): HallkeeperSheetV2 {
  return {
    config: { id: "3e9a1c70-2b4d-4f81-a6c3-7d8e9f0a1b22", name: "Untitled layout", guestCount: 0, layoutStyle: "custom" },
    venue: { name: "Trades Hall Glasgow", address: "85 Glassford Street, Glasgow G1 1UH", logoUrl: null, timezone: "Europe/London" },
    space: { name: "Saloon", widthM: 12, lengthM: 7, heightM: 5.4 },
    timing: null,
    instructions: null,
    phases: [],
    totals: { entries: [], totalRows: 0, totalItems: 0 },
    diagramUrl: null,
    floorPlan: null,
    webViewUrl: "https://venviewer.com/hallkeeper/3e9a1c70-2b4d-4f81-a6c3-7d8e9f0a1b22",
    generatedAt: bst(7, 5),
    approval: null,
  };
}

// ---------------------------------------------------------------------------
// 4. Every free-text field at its schema maximum, for overflow and paging.
// ---------------------------------------------------------------------------

export function longTextSheet(): HallkeeperSheetV2 {
  const base = weddingSheet();
  const sentence = "Keep the north aisle clear for the photographer between courses and check the candles before service. ";
  const fill = (max: number): string => sentence.repeat(Math.ceil(max / sentence.length)).slice(0, max).trim();
  const instructions = base.instructions ?? WEDDING_INSTRUCTIONS;
  return {
    ...base,
    config: { ...base.config, name: "The Mackenzie–Ross and Fraser–Lindqvist joint family celebration dinner, with ceilidh and late carriages" },
    instructions: {
      ...instructions,
      specialInstructions: fill(4000),
      accessNotes: fill(1500),
      dayOfContact: { name: "Alexandria Montgomery-Fitzwilliam", role: "Mother of the bride and principal organiser", phone: "07700 900987", email: "alexandria.montgomery-fitzwilliam@example.co.uk" },
      accessibility: instructions.accessibility === null ? null : { ...instructions.accessibility, notes: fill(1000) },
      dietary: instructions.dietary === null ? null : { ...instructions.dietary, otherAllergies: fill(1000) },
    },
    phases: base.phases.map((phase) => ({
      ...phase,
      zones: phase.zones.map((zone) => ({
        ...zone,
        rows: zone.rows.map((row, index) => index === 0 ? { ...row, notes: fill(600) } : row),
      })),
    })),
    approval: base.approval === null ? null : { ...base.approval, approverName: "Alexandria Montgomery ".repeat(9).trim() },
  };
}
