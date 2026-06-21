import { describe, it, expect } from "vitest";
import { GuestFlowReplayInputSchema, runGuestFlowReplayV0 } from "@omnitwin/types";
import {
  buildGuestFlowReplayInputFromLayout,
  GUEST_FLOW_LAYOUT_INPUT_DISCLAIMER,
  MAX_GUEST_FLOW_AGENTS,
  DEFAULT_ASSUMED_GUEST_COUNT,
  BAR_CATALOGUE_SLUG,
  type GuestFlowDoorOverride,
} from "../guest-flow-layout-input.js";
import { CATALOGUE_ITEMS, type CatalogueItem } from "../catalogue.js";
import { RENDER_SCALE } from "../../constants/scale.js";
import { projectReplayPointToFloor, type ReplayRoomBounds } from "../cockpit-overlay-projection.js";
import type { PlacedItem } from "../placement.js";

// ---------------------------------------------------------------------------
// guest-flow-layout-input — Epic 1 spine: live layout → GuestFlowReplayInput.
// The decisive test is the sim→scene round-trip (an obstacle must land exactly
// under the furniture that produced it) plus an end-to-end run through the real
// simulator (proving the built input is genuinely consumable, not just typed).
// ---------------------------------------------------------------------------

const ROOM_W = 21;
const ROOM_L = 10.5;

function itemByCategory(category: CatalogueItem["category"]): CatalogueItem {
  const item = CATALOGUE_ITEMS.find((candidate) => candidate.category === category);
  if (item === undefined) throw new Error(`No catalogue item for category ${category}`);
  return item;
}

function itemBySlug(slug: string): CatalogueItem {
  const item = CATALOGUE_ITEMS.find((candidate) => candidate.slug === slug);
  if (item === undefined) throw new Error(`No catalogue item for slug ${slug}`);
  return item;
}

/** Place a catalogue item at a render-space position. */
function place(item: CatalogueItem, xRender: number, zRender: number, rotationY = 0): PlacedItem {
  return {
    id: `placed-${item.slug}-${String(xRender)}-${String(zRender)}`,
    catalogueItemId: item.id,
    x: xRender,
    y: 0,
    z: zRender,
    rotationY,
    clothed: false,
    clothStyle: null,
    tableSetting: null,
    groupId: null,
  };
}

function boundsOf(polygon: readonly { readonly x: number; readonly y: number }[]): ReplayRoomBounds {
  return polygon.reduce<ReplayRoomBounds>(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      minY: Math.min(acc.minY, p.y),
      maxX: Math.max(acc.maxX, p.x),
      maxY: Math.max(acc.maxY, p.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

function centroid(polygon: readonly { readonly x: number; readonly y: number }[]): { readonly x: number; readonly y: number } {
  const sum = polygon.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / polygon.length, y: sum.y / polygon.length };
}

// Render dimensions, exactly as the cockpit overlay passes them.
const RENDER_DIMS = { width: ROOM_W * RENDER_SCALE, length: ROOM_L * RENDER_SCALE, height: 7 };

describe("schema validity", () => {
  it("produces an input the strict schema accepts", () => {
    const result = buildGuestFlowReplayInputFromLayout({
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [place(itemByCategory("table"), 8, 4)],
    });
    expect(() => GuestFlowReplayInputSchema.parse(result)).not.toThrow();
    expect(result.entrances.length).toBeGreaterThanOrEqual(1);
    expect(result.exits.length).toBeGreaterThanOrEqual(1);
    expect(result.destinations.length).toBeGreaterThanOrEqual(1);
  });

  it("reports the real placed-object count", () => {
    const table = itemByCategory("table");
    const result = buildGuestFlowReplayInputFromLayout({
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [place(table, 4, 0), place(table, -4, 0)],
    });
    expect(result.layout.placedObjectCount).toBe(2);
  });
});

describe("sim → scene round-trip (overlays land under the furniture)", () => {
  it("projects an obstacle's centroid back to the table's scene position", () => {
    const xRender = 8;
    const zRender = 4;
    const result = buildGuestFlowReplayInputFromLayout({
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [place(itemByCategory("table"), xRender, zRender)],
    });

    expect(result.obstacles).toHaveLength(1);
    const obstacle = result.obstacles[0];
    if (obstacle === undefined) throw new Error("expected one obstacle");

    const bounds = boundsOf(result.roomPolygon);
    const [worldX, , worldZ] = projectReplayPointToFloor(centroid(obstacle.polygon), bounds, RENDER_DIMS, 0);
    // The obstacle must project back onto the exact scene position of its table.
    expect(worldX).toBeCloseTo(xRender, 2);
    expect(worldZ).toBeCloseTo(zRender, 2);
  });

  it("keeps the room polygon centred on the origin and the right size", () => {
    const result = buildGuestFlowReplayInputFromLayout({
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [],
    });
    const bounds = boundsOf(result.roomPolygon);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(ROOM_W, 5);
    expect(bounds.maxY - bounds.minY).toBeCloseTo(ROOM_L, 5);
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(0, 5);
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(0, 5);
  });
});

describe("obstacle selection", () => {
  it("turns tables, stages and the bar into obstacles but not chairs", () => {
    const result = buildGuestFlowReplayInputFromLayout({
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [
        place(itemByCategory("table"), 4, 0),
        place(itemByCategory("stage"), -6, 0),
        place(itemBySlug(BAR_CATALOGUE_SLUG), 6, -3),
        place(itemByCategory("chair"), 1, 1),
        place(itemByCategory("chair"), 2, 1),
      ],
    });
    // table + stage + bar = 3 obstacles; the two chairs are excluded.
    expect(result.obstacles).toHaveLength(3);
  });

  it("gives every obstacle a closed footprint polygon", () => {
    const result = buildGuestFlowReplayInputFromLayout({
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [place(itemByCategory("table"), 0, 0)],
    });
    for (const obstacle of result.obstacles) {
      expect(obstacle.polygon.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("layout-derived destinations", () => {
  it("creates a seating destination at the table cluster centroid", () => {
    const table = itemByCategory("table");
    const result = buildGuestFlowReplayInputFromLayout({
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [place(table, 8, 0), place(table, -8, 0)],
    });
    const seating = result.destinations.find((d) => /seat/i.test(d.label));
    expect(seating).toBeDefined();
    // Centroid of (±4 m) tables is the origin.
    expect(seating?.point.x).toBeCloseTo(0, 2);
  });

  it("creates a bar destination when a bar is placed", () => {
    const result = buildGuestFlowReplayInputFromLayout({
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [place(itemByCategory("table"), 0, 0), place(itemBySlug(BAR_CATALOGUE_SLUG), 10, -4)],
    });
    expect(result.destinations.some((d) => /bar/i.test(d.label))).toBe(true);
  });

  it("falls back to a single gathering point for an empty layout", () => {
    const result = buildGuestFlowReplayInputFromLayout({
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [],
    });
    expect(result.obstacles).toHaveLength(0);
    expect(result.destinations).toHaveLength(1);
  });
});

describe("doors and provenance", () => {
  it("defaults to assumed mid-wall doors flagged as planning assumptions", () => {
    const result = buildGuestFlowReplayInputFromLayout({
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [],
    });
    expect(result.entrances).toHaveLength(1);
    expect(result.exits).toHaveLength(1);
    const door = result.assumptions.find((a) => a.key === "door_positions");
    expect(String(door?.value)).toMatch(/assumed/i);
    expect(door?.source).toBe("planning assumption");
  });

  it("uses surveyed doors when provided and records them as such", () => {
    const entrances: GuestFlowDoorOverride[] = [{ id: "e-real", label: "Surveyed north door", xM: 0, zM: -5, widthM: 1.8 }];
    const exits: GuestFlowDoorOverride[] = [{ id: "x-real", label: "Surveyed south door", xM: 0, zM: 5 }];
    const result = buildGuestFlowReplayInputFromLayout({
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [],
      entrances,
      exits,
    });
    expect(result.entrances[0]?.id).toBe("e-real");
    expect(result.entrances[0]?.widthM).toBe(1.8);
    // Z flips into the sim frame: scene zM -5 → sim y +5.
    expect(result.entrances[0]?.point.y).toBeCloseTo(5, 5);
    const door = result.assumptions.find((a) => a.key === "door_positions");
    expect(String(door?.value)).toMatch(/surveyed/i);
    expect(door?.source).toBe("caller-provided");
  });
});

describe("guest count → agents", () => {
  it("uses the planned guest count as the agent count", () => {
    const result = buildGuestFlowReplayInputFromLayout({
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [],
      plannedGuestCount: 250,
    });
    expect(result.agentCount).toBe(250);
    const guest = result.assumptions.find((a) => a.key === "guest_count");
    expect(guest?.source).toBe("event guest count");
  });

  it("clamps an over-large guest count to the simulator cap", () => {
    const result = buildGuestFlowReplayInputFromLayout({
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [],
      plannedGuestCount: 9999,
    });
    expect(result.agentCount).toBe(MAX_GUEST_FLOW_AGENTS);
  });

  it("falls back to the default count, flagged as an assumption", () => {
    const result = buildGuestFlowReplayInputFromLayout({
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [],
    });
    expect(result.agentCount).toBe(DEFAULT_ASSUMED_GUEST_COUNT);
    const guest = result.assumptions.find((a) => a.key === "guest_count");
    expect(guest?.source).toMatch(/default/i);
  });
});

describe("determinism", () => {
  it("produces an identical input for identical options", () => {
    const opts = {
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [place(itemByCategory("table"), 4, 2), place(itemBySlug(BAR_CATALOGUE_SLUG), -6, 3)],
      plannedGuestCount: 120,
    };
    expect(buildGuestFlowReplayInputFromLayout(opts)).toEqual(buildGuestFlowReplayInputFromLayout(opts));
  });
});

describe("end-to-end through the real simulator", () => {
  it("feeds a runnable input to runGuestFlowReplayV0", () => {
    const table = itemByCategory("table");
    const input = buildGuestFlowReplayInputFromLayout({
      roomWidthM: ROOM_W,
      roomLengthM: ROOM_L,
      placedItems: [place(table, 6, 2), place(table, -6, 2), place(itemBySlug(BAR_CATALOGUE_SLUG), 8, -3)],
      plannedGuestCount: 60,
    });
    const artifact = runGuestFlowReplayV0(input);
    expect(artifact.metrics.agentCount).toBe(60);
    expect(artifact.navmesh.walkableCellCount).toBeGreaterThan(0);
    expect(artifact.disclosureLabel).toBe("Simulated guest flow - planning support");
  });
});

describe("claim safety", () => {
  it("disclaimer keeps the output planning-grade and never asserts certification", () => {
    expect(GUEST_FLOW_LAYOUT_INPUT_DISCLAIMER).toMatch(/simulated planning support/i);
    expect(GUEST_FLOW_LAYOUT_INPUT_DISCLAIMER).toMatch(/not a measured or certified/i);
    expect(GUEST_FLOW_LAYOUT_INPUT_DISCLAIMER).not.toMatch(/\bcompliant\b/i);
  });
});
