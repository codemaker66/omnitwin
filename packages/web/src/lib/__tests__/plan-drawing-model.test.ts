import { describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { HALL_OPENINGS } from "../../components/grand-hall/hall-spec.js";
import { getCatalogueItemBySlug } from "../catalogue.js";
import type { PlacedItem } from "../placement.js";
import { stampSetup } from "../setup-cards.js";
import {
  DRAWING_MARGIN_PX,
  DRAWING_ZOOM,
  GRAND_HALL_CHIMNEYPIECE,
  bestArea,
  chairBack,
  convexHull,
  drawingAreas,
  drawingSummary,
  drawnExtent,
  drawnRoom,
  drawnUnits,
  fitView,
  freestNameSpot,
  panBy,
  piecesInBox,
  toFloor,
  toScreen,
  zoomAbout,
} from "../plan-drawing-model.js";

// ---------------------------------------------------------------------------
// Plan's Drawing, the model (T-674; spec §6.3, §7.2): what a plan draws and
// says, where the hall's doors, windows and fireplace are, and the sums that
// fit the room into the space the chrome leaves.
// ---------------------------------------------------------------------------

function idOf(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`no ${slug} in the catalogue`);
  return item.id;
}

function piece(id: string, slug: string, x: number, z: number, extra: Partial<PlacedItem> = {}): PlacedItem {
  return { id, catalogueItemId: idOf(slug), x, y: 0, z, rotationY: 0, clothed: false, clothStyle: null, tableSetting: null, groupId: null, ...extra };
}

/** A round at (x, z) with `chairs` chairs round it, facing it, in one group. */
function round(name: string, x: number, z: number, chairs: number, label?: string): PlacedItem[] {
  const group = `g-${name}`;
  return [
    piece(name, "round-table-6ft-white", x, z, { groupId: group, ...(label === undefined ? {} : { label }) }),
    ...Array.from({ length: chairs }, (_, n) => {
      const angle = (2 * Math.PI * n) / chairs;
      return piece(`${name}-c${String(n)}`, "banquet-chair", x + 1.2 * Math.cos(angle), z + 1.2 * Math.sin(angle), { groupId: group, rotationY: -angle - Math.PI / 2 });
    }),
  ];
}

function ids(): () => string {
  let n = 0;
  return () => `p${String(n++)}`;
}

describe("the pieces as a plan draws them", () => {
  it("draws a table with its chairs as one unit, carrying the table's own number", () => {
    const units = drawnUnits(round("t7", 2, 1, 10, "Table 7"));
    expect(units).toHaveLength(1);
    const [unit] = units;
    expect(unit?.label).toBe("Table 7");
    expect(unit?.labelKind).toBe("number");
    expect(unit?.mainId).toBe("t7");
    expect(unit?.chairs).toBe(10);
    expect(unit?.labelAt).toEqual({ x: 2, z: 1 });
    // The table is a circle of its catalogue size, its chairs drawn over its edge.
    const table = unit?.pieces.find((drawn) => drawn.role === "table");
    expect(table?.shape).toMatchObject({ kind: "circle", centre: { x: 2, z: 1 } });
    expect(table?.shape.kind === "circle" ? table.shape.radius * 2 : 0).toBeCloseTo(getCatalogueItemBySlug("round-table-6ft-white")?.width ?? 0, 6);
    expect(unit?.pieces.at(-1)?.role).toBe("chair");
  });

  it("never invents a number for a table the layout has not numbered", () => {
    const [unit] = drawnUnits(round("t", 0, 0, 8));
    expect(unit?.label).toBeNull();
    expect(unit?.labelKind).toBeNull();
  });

  it("gives each chair its back: the edge farthest from its table", () => {
    const [unit] = drawnUnits(round("t", 0, 0, 4));
    const chairs = unit?.pieces.filter((drawn) => drawn.role === "chair") ?? [];
    expect(chairs).toHaveLength(4);
    for (const chair of chairs) {
      expect(chair.back).not.toBeNull();
      if (chair.back === null) continue;
      const middle = { x: (chair.back[0].x + chair.back[1].x) / 2, z: (chair.back[0].z + chair.back[1].z) / 2 };
      // The back's middle lies farther out than the chair's own middle.
      expect(Math.hypot(middle.x, middle.z)).toBeGreaterThan(Math.hypot(chair.centre.x, chair.centre.z));
    }
  });

  it("finds a square's back edge exactly", () => {
    const square = [{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }];
    expect(chairBack(square, { x: 0, z: -5 })).toEqual([{ x: 1, z: 1 }, { x: -1, z: 1 }]);
  });

  it("draws a dance floor as one named floor under the tables, with its size", () => {
    const floor = stampSetup({ card: "dance-floor", cols: 5, rows: 4 }, { x: 0, z: 0 }, 0, ids());
    const units = drawnUnits([...round("t1", 6, 0, 10, "Table 1"), ...floor]);
    expect(units[0]?.label).toBe("Dance floor");
    expect(units[0]?.labelKind).toBe("name");
    expect(units[0]?.pieces.every((drawn) => drawn.role === "panel")).toBe(true);
    const panel = getCatalogueItemBySlug("dancefloor-panel");
    const tenths = (value: number): string => (Math.round(value * 10) / 10).toFixed(1);
    expect(units[0]?.detail).toBe(`${tenths((panel?.width ?? 0) * 5)} × ${tenths((panel?.depth ?? 0) * 4)} m`);
    expect(units[1]?.label).toBe("Table 1");
    // Its outer edge is the floor's own rectangle, drawn heavier than the joints between its panels.
    const outline = units[0]?.outline ?? [];
    expect(outline).toHaveLength(4);
    expect(Math.max(...outline.map((point) => point.x)) - Math.min(...outline.map((point) => point.x))).toBeCloseTo((panel?.width ?? 0) * 5, 6);
  });

  it("finds the outer edge of a set of points", () => {
    const hull = convexHull([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 2 }, { x: 0, z: 2 }, { x: 1, z: 0 }]);
    expect([...hull].sort((a, b) => a.x - b.x || a.z - b.z)).toEqual([{ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 2, z: 0 }, { x: 2, z: 2 }]);
  });

  it("names a lone piece by its card, and leaves out dressing and anything set on a table", () => {
    const units = drawnUnits([
      piece("lectern", "lectern", 0, 0),
      piece("cloth", "white-table-cloth", 1, 1),
      piece("laptop", "laptop", 2, 2, { y: 0.76 }),
      piece("stand", "mic-stand", 3, 3),
    ]);
    expect(units.map((unit) => unit.mainId).sort()).toEqual(["lectern", "stand"]);
    expect(units.find((unit) => unit.mainId === "lectern")?.label).toBe("Lectern");
  });

  it("draws a turned trestle as its turned outline, the one the aisles are measured between", () => {
    const [unit] = drawnUnits([piece("tr", "trestle-6ft-white", 0, 0, { rotationY: Math.PI / 2 })]);
    const shape = unit?.pieces[0]?.shape;
    expect(shape?.kind).toBe("polygon");
    if (shape?.kind !== "polygon") return;
    const xs = shape.points.map((point) => point.x);
    const zs = shape.points.map((point) => point.z);
    const item = getCatalogueItemBySlug("trestle-6ft-white");
    // A quarter turn puts the trestle's length along z.
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(item?.width ?? 0, 6);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(item?.depth ?? 0, 6);
  });

  it("says what is on the floor in words", () => {
    const floor = stampSetup({ card: "dance-floor", cols: 3, rows: 3 }, { x: 0, z: 0 }, 0, ids());
    expect(drawingSummary(drawnUnits([...round("a", -4, 0, 10, "Table 1"), ...round("b", 4, 0, 10, "Table 2"), ...floor]))).toBe("2 tables, 20 chairs and a dance floor");
    expect(drawingSummary(drawnUnits(round("a", 0, 0, 1)))).toBe("1 table and 1 chair");
    expect(drawingSummary([])).toBe("nothing on the floor yet");
  });
});

describe("the room as a plan draws it", () => {
  const hall = drawnRoom(GRAND_HALL_RENDER_DIMENSIONS, true);

  it("names the Grand Hall's walls as staff do", () => {
    const names = Object.fromEntries(hall.walls.map((wall) => [wall.side, wall.name]));
    expect(names).toEqual({ xMin: "Fireplace wall", xMax: "End wall", zMin: "Window wall", zMax: "Door wall" });
  });

  it("puts every door and window of the survey on its wall, the doors named", () => {
    expect(hall.openings).toHaveLength(HALL_OPENINGS.length);
    expect(hall.openings.filter((opening) => opening.kind === "window").every((opening) => opening.side === "zMin" && opening.name === null)).toBe(true);
    const doors = hall.openings.filter((opening) => opening.kind === "door");
    expect(doors.map((door) => door.name).sort()).toEqual(["End door", "Fire exit", "Fireplace door", "Main door"]);
    const main = doors.find((door) => door.name === "Main door");
    // The main door is in the middle of the door wall, 1.45 m wide.
    expect(main?.side).toBe("zMax");
    expect(((main?.from.x ?? 0) + (main?.to.x ?? 0)) / 2).toBeCloseTo(0, 1);
    expect((main?.to.x ?? 0) - (main?.from.x ?? 0)).toBeCloseTo(1.45, 2);
    expect(main?.from.z).toBeCloseTo(GRAND_HALL_RENDER_DIMENSIONS.length / 2, 6);
    // The fire exit is in the fireplace wall, towards the window wall.
    const exit = doors.find((door) => door.name === "Fire exit");
    expect(exit?.side).toBe("xMin");
    expect(exit?.from.z ?? 0).toBeLessThan(0);
  });

  it("never sets a wall's name over a door's", () => {
    for (const wall of hall.walls) {
      for (const door of hall.openings.filter((opening) => opening.side === wall.side && opening.name !== null)) {
        const at = wall.side === "xMin" || wall.side === "xMax" ? (door.from.z + door.to.z) / 2 : (door.from.x + door.to.x) / 2;
        expect(Math.abs(at - wall.nameAt), `${String(wall.name)} by ${String(door.name)}`).toBeGreaterThan(1.6);
      }
    }
    // The window wall has no named door, so its name sits in the middle.
    expect(hall.walls.find((wall) => wall.side === "zMin")?.nameAt).toBe(0);
  });

  it("finds the freest stretch of a wall", () => {
    expect(freestNameSpot(20, [], 1)).toBe(0);
    // Doors at -8 and 0 on a 20 m wall: the stretch from 1 to 10 is the longest.
    expect(freestNameSpot(20, [0, -8], 1)).toBeCloseTo(5.5, 6);
  });

  it("draws the fireplace where the scan measured it: centred on the fireplace wall, its firebox set back", () => {
    const fireplace = hall.fireplace;
    expect(fireplace).not.toBeNull();
    if (fireplace === null) return;
    const face = -GRAND_HALL_RENDER_DIMENSIONS.width / 2;
    const zs = fireplace.surround.map((point) => point.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(GRAND_HALL_CHIMNEYPIECE.to - GRAND_HALL_CHIMNEYPIECE.from, 6);
    expect((Math.max(...zs) + Math.min(...zs)) / 2).toBeCloseTo(0, 0);
    expect(Math.min(...fireplace.surround.map((point) => point.x))).toBeCloseTo(face, 6);
    expect(Math.min(...fireplace.firebox.map((point) => point.x))).toBeCloseTo(face - GRAND_HALL_CHIMNEYPIECE.fireboxDepth, 6);
  });

  it("draws any other room as a plain rectangle with unnamed walls", () => {
    const plain = drawnRoom({ width: 12, length: 8, height: 3 }, false);
    expect(plain.walls.every((wall) => wall.name === null)).toBe(true);
    expect(plain.openings).toEqual([]);
    expect(plain.fireplace).toBeNull();
    expect(drawnExtent(plain)).toEqual({ minX: -6.3, maxX: 6.3, minZ: -4.3, maxZ: 4.3 });
  });
});

describe("fitting the drawing to the space the chrome leaves", () => {
  const hall = drawnRoom(GRAND_HALL_RENDER_DIMENSIONS, true);

  it("sets the whole drawing in the area, centred, inside the paper's margin", () => {
    const area = { left: 20, top: 200, width: 1560, height: 600 };
    const view = fitView(hall, area);
    const extent = drawnExtent(hall);
    const topLeft = toScreen(view, { x: extent.minX, z: extent.minZ });
    const bottomRight = toScreen(view, { x: extent.maxX, z: extent.maxZ });
    expect(topLeft.x).toBeGreaterThanOrEqual(area.left + DRAWING_MARGIN_PX - 1e-6);
    expect(topLeft.y).toBeGreaterThanOrEqual(area.top + DRAWING_MARGIN_PX - 1e-6);
    expect(bottomRight.x).toBeLessThanOrEqual(area.left + area.width - DRAWING_MARGIN_PX + 1e-6);
    expect(bottomRight.y).toBeLessThanOrEqual(area.top + area.height - DRAWING_MARGIN_PX + 1e-6);
    // Centred: equal room either side.
    expect(topLeft.x - area.left).toBeCloseTo(area.left + area.width - bottomRight.x, 6);
    expect(topLeft.y - area.top).toBeCloseTo(area.top + area.height - bottomRight.y, 6);
  });

  it("goes under the slate or beside it, whichever draws the room larger", () => {
    const free = { left: 20, top: 20, right: 1346, bottom: 620 };
    const slate = { left: 20, top: 20, right: 360, bottom: 198 };
    const areas = drawingAreas(free, slate, 12);
    expect(areas).toHaveLength(2);
    const [under, beside] = areas;
    if (under === undefined || beside === undefined) return;
    // On a 1366 laptop the long hall draws larger beside the slate than under it.
    expect(fitView(hall, beside).scale).toBeGreaterThan(fitView(hall, under).scale);
    expect(bestArea(hall, areas)).toEqual(beside);
    // No slate in the way: the whole free area.
    expect(drawingAreas(free, null, 12)).toEqual([{ left: 20, top: 20, width: 1326, height: 600 }]);
  });

  it("has no area too small for its margin", () => {
    expect(bestArea(hall, [{ left: 0, top: 0, width: 40, height: 400 }])).toBeNull();
  });

  it("turns a screen point into the floor point under it and back", () => {
    const view = { scale: 50, originX: 800, originY: 500 };
    const floor = toFloor(view, 900, 450);
    expect(floor).toEqual({ x: 2, z: -1 });
    expect(toScreen(view, floor)).toEqual({ x: 900, y: 450 });
  });

  it("zooms about the pointer, between the fit and four times it", () => {
    const fit = { scale: 50, originX: 800, originY: 500 };
    const zoomed = zoomAbout(fit, fit, 2, 900, 450);
    expect(zoomed.scale).toBe(100);
    // The floor point under the pointer stays under it.
    expect(toFloor(zoomed, 900, 450)).toEqual(toFloor(fit, 900, 450));
    expect(zoomAbout(zoomed, fit, 100, 900, 450).scale).toBe(50 * DRAWING_ZOOM.max);
    // Never out past the fit: back to the fit itself, centred.
    expect(zoomAbout(zoomed, fit, 0.1, 10, 10)).toEqual(fit);
  });

  it("pans only once zoomed in", () => {
    const fit = { scale: 50, originX: 800, originY: 500 };
    expect(panBy(fit, fit, 40, 0)).toEqual(fit);
    const zoomed = zoomAbout(fit, fit, 2, 800, 500);
    expect(panBy(zoomed, fit, 40, -10)).toEqual({ ...zoomed, originX: zoomed.originX + 40, originY: zoomed.originY - 10 });
  });

  it("selects an area by the pieces' middles, as the room's own area select does", () => {
    const pieces = [...round("a", -4, 0, 2, "Table 1"), ...round("b", 4, 0, 2, "Table 2"), piece("cloth", "white-table-cloth", -4, 0)];
    expect([...piecesInBox(pieces, { x: -6, z: -2 }, { x: -2, z: 2 })].sort()).toEqual(["a", "a-c0", "a-c1"]);
    expect([...piecesInBox(pieces, { x: 2, z: 2 }, { x: 6, z: -2 })].sort()).toEqual(["b", "b-c0", "b-c1"]);
  });
});
