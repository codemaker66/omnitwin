// The chair brush on a room's own floor (lib/room-floor). A press-drag between two floor points fills
// the box between them with chairs, and in the Robert Adam Room, the Reception Room and the Saloon two
// points of the floor can have wall between them. What the brush sets is held to walls-the-slow-way,
// none of it the planner's geometry; the Grand Hall's brush is held to what it set before (second review
// of audit editor-save-4, major 2).
import { afterEach, describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { roomGeometries } from "../../data/room-geometries.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { computeChairBrushSummary, type ChairBrushPoint } from "../../lib/chair-brush.js";
import { plannerRoomOf } from "../../lib/room-floor.js";
import { footprintInsideWalls, insideWalls, type Walls } from "../../lib/__tests__/walls-the-slow-way.js";
import { usePlacementStore } from "../placement-store.js";
import { useRoomDimensionsStore } from "../room-dimensions-store.js";

const SHAPED_ROOMS = ["Robert Adam Room", "Reception Room", "Saloon"] as const;

const found = getCatalogueItemBySlug("burgess-turini-18-3");
if (found === undefined) throw new Error("no chair in the catalogue");
/** The planner's chair: 0.42 m wide, 0.58 m deep. */
const CHAIR = found;

/** A millimetre: nearer a wall than this, the slow way and the planner may differ by rounding alone. */
const HAIR = 0.001;
const QUARTER = Math.PI / 2;

/** Opens a room as the room store holds it, empty, and gives back its walls. */
function openRoom(name: string, snapEnabled: boolean): Walls {
  const geometry = roomGeometries[name];
  if (geometry === undefined) throw new Error(`no geometry for ${name}`);
  useRoomDimensionsStore.getState().setDimensions(plannerRoomOf(geometry.wallPolygon, geometry.ceilingHeight));
  usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostRotation: 0, ghostValid: false, ghostInvalidReason: null, snapEnabled });
  return geometry.wallPolygon;
}

/**
 * Whether a chair at a spot, facing along z or turned a quarter, stands wholly inside the walls: the slow
 * way, its footprint taken in by `slack` (a hair by default, so a chair set exactly against a wall stands).
 */
function stands(walls: Walls, x: number, z: number, turn: number, slack: number = HAIR): boolean {
  const quarter = Math.abs(Math.sin(turn)) > 0.5;
  return footprintInsideWalls(walls, x, z, (quarter ? CHAIR.depth : CHAIR.width) / 2, (quarter ? CHAIR.width : CHAIR.depth) / 2, slack);
}

const spot = (point: { readonly x: number; readonly z: number }): string => `${point.x.toFixed(3)}, ${point.z.toFixed(3)}`;

/** The planner's 1 m grid. */
const onGrid = (value: number): number => Math.round(value);

/** Every chair of the box a brush fills between two points, before any wall is asked: the brush's own layout is not what these tests judge. */
function wholeBrush(snapEnabled: boolean, from: readonly [number, number], to: readonly [number, number], turn: number): readonly ChairBrushPoint[] {
  const [ax, az, bx, bz] = snapEnabled ? [onGrid(from[0]), onGrid(from[1]), onGrid(to[0]), onGrid(to[1])] : [from[0], from[1], to[0], to[1]];
  return computeChairBrushSummary(CHAIR, ax, az, bx, bz, turn).points;
}

afterEach(() => {
  useRoomDimensionsStore.getState().setDimensions(GRAND_HALL_RENDER_DIMENSIONS);
  usePlacementStore.setState({ placedItems: [], snapEnabled: true });
});

describe("the chair brush in the Robert Adam Room", () => {
  it.each([
    ["on the grid", true, [3, 0], [-2, 5]],
    ["off the grid", false, [3.03, 0.02], [-2.04, 5.01]],
  ] as const)("sets no chair through the walls when it runs from (3, 0) to (−2, 5) across the step, %s", (_grid, snapEnabled, from, to) => {
    const walls = openRoom("Robert Adam Room", snapEnabled);
    // Both ends are on the floor: the upper section, and the lower section past the step.
    expect(insideWalls(walls, from[0], from[1]) && insideWalls(walls, to[0], to[1])).toBe(true);
    const ids = usePlacementStore.getState().placeChairBrush(CHAIR.id, from[0], from[1], to[0], to[1], 0);
    const placed = usePlacementStore.getState().placedItems;
    // The count it reports is the count it set.
    expect(placed.map((chair) => chair.id)).toEqual(ids);
    expect(placed.filter((chair) => !stands(walls, chair.x, chair.z, chair.rotationY)).map(spot)).toEqual([]);
    expect(placed.filter((chair) => !insideWalls(walls, chair.x, chair.z)).map(spot)).toEqual([]);
    // It is the same brush less the chairs the walls do not take: 72 fill the box, 54 of them wholly on the floor.
    const whole = wholeBrush(snapEnabled, from, to, 0);
    expect(whole).toHaveLength(72);
    expect(placed.map(spot)).toEqual(whole.filter((point) => stands(walls, point.x, point.z, 0)).map(spot));
    expect(placed).toHaveLength(54);
  });

  it("sets nothing, and says so, when no chair of the brush stands on the floor", () => {
    const walls = openRoom("Robert Adam Room", false);
    // Along the lower section's east wall, x = −0.1, from a point 5 cm inside it: every chair would stand through that wall.
    expect(insideWalls(walls, -0.15, 4.2) && insideWalls(walls, -0.15, 7.8)).toBe(true);
    expect(wholeBrush(false, [-0.15, 4.2], [-0.15, 7.8], 0).length).toBeGreaterThan(4);
    expect(usePlacementStore.getState().placeChairBrush(CHAIR.id, -0.15, 4.2, -0.15, 7.8, 0)).toEqual([]);
    expect(usePlacementStore.getState().placedItems).toEqual([]);
  });
});

describe.each(SHAPED_ROOMS)("the chair brush in the %s", (name) => {
  it("sets exactly the chairs of each brush that stand wholly inside the walls, whichever two floor points it runs between", () => {
    const wrong: string[] = [];
    let brushes = 0;
    let chairsSet = 0;
    let chairsLeftOut = 0;
    for (const snapEnabled of [true, false]) {
      for (const turn of [0, QUARTER]) {
        const walls = openRoom(name, snapEnabled);
        const xs = walls.map(([x]) => x);
        const zs = walls.map(([, z]) => z);
        const floorPoints: (readonly [number, number])[] = [];
        for (let x = Math.min(...xs) + 0.35; x < Math.max(...xs); x += 2.3) {
          for (let z = Math.min(...zs) + 0.45; z < Math.max(...zs); z += 1.9) {
            if (insideWalls(walls, x, z)) floorPoints.push([x, z]);
          }
        }
        for (const from of floorPoints) {
          for (const to of floorPoints) {
            const whole = wholeBrush(snapEnabled, from, to, turn);
            if (whole.length <= 1) continue;
            usePlacementStore.setState({ placedItems: [] });
            const ids = usePlacementStore.getState().placeChairBrush(CHAIR.id, from[0], from[1], to[0], to[1], turn);
            const placed = usePlacementStore.getState().placedItems;
            brushes += 1;
            chairsSet += placed.length;
            chairsLeftOut += whole.length - placed.length;
            const said = `${name}, grid ${snapEnabled ? "on" : "off"}, turn ${turn.toFixed(2)}, (${spot({ x: from[0], z: from[1] })}) to (${spot({ x: to[0], z: to[1] })})`;
            if (ids.length !== placed.length) wrong.push(`${said}: reports ${String(ids.length)} chairs, set ${String(placed.length)}`);
            const set = new Set(placed.map(spot));
            // The brush's own chairs, in its own order.
            if (placed.map(spot).join("; ") !== whole.map(spot).filter((one) => set.has(one)).join("; ")) wrong.push(`${said}: sets chairs that are not the brush's, or out of its order`);
            const through = placed.filter((chair) => !stands(walls, chair.x, chair.z, turn)).map(spot);
            // Within a hair of a wall the slow way cannot say: a chair left out is wrong only where it stands inside with a hair to spare.
            const missed = whole.filter((point) => !set.has(spot(point)) && stands(walls, point.x, point.z, turn, -HAIR)).map(spot);
            if (through.length > 0 || missed.length > 0) {
              wrong.push(`${said}: ${String(through.length)} set through the walls (${through[0] ?? "none"}), ${String(missed.length)} left out though inside (${missed[0] ?? "none"})`);
            }
          }
        }
      }
    }
    expect(brushes).toBeGreaterThan(300);
    expect(chairsSet).toBeGreaterThan(3000);
    // The walls did take chairs out of some brushes: the room is not a box.
    expect(chairsLeftOut).toBeGreaterThan(100);
    expect({ wrong: wrong.length, first: wrong.slice(0, 3) }).toEqual({ wrong: 0, first: [] });
  }, 120_000);
});

describe("the chair brush in the Grand Hall, a room with no floor of its own", () => {
  // What each brush set before the brush learned of floors (origin/master 9fdb57a6 and this branch up to 5a2eb871), chair by chair.
  const row = (count: number, at: (index: number) => readonly [number, number]): readonly string[] =>
    Array.from({ length: count }, (_, index) => spot({ x: at(index)[0], z: at(index)[1] }));

  function brushed(snapEnabled: boolean, from: readonly [number, number], to: readonly [number, number], turn: number): readonly string[] {
    useRoomDimensionsStore.getState().setDimensions(GRAND_HALL_RENDER_DIMENSIONS);
    usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostRotation: 0, ghostValid: false, ghostInvalidReason: null, snapEnabled });
    const ids = usePlacementStore.getState().placeChairBrush(CHAIR.id, from[0], from[1], to[0], to[1], turn);
    const placed = usePlacementStore.getState().placedItems;
    expect(placed.map((chair) => chair.id)).toEqual(ids);
    expect(placed.every((chair) => chair.rotationY === turn)).toBe(true);
    return placed.map(spot);
  }

  it("sets the row it always set from a drag across the floor, its ends taken to the grid", () => {
    // (−3.2, 1.1) to (2.4, 3.6) becomes (−3, 1) to (2, 4): nine chairs 0.57 m apart along z = 1.
    expect(brushed(true, [-3.2, 1.1], [2.4, 3.6], 0)).toEqual(row(9, (index) => [-3 + 0.57 * index, 1]));
  });

  it("sets the column it always set with the chairs turned a quarter and the grid off", () => {
    expect(brushed(false, [8.3, -4.9], [10.2, 4.9], QUARTER)).toEqual(row(18, (index) => [8.3, -4.9 + 0.57 * index]));
  });

  it("still sets a column 1 cm through the end wall, as it always did: the hall's brush asks no wall", () => {
    // Chairs centred on x = 10.3 reach x = 10.51; the end wall stands at x = 10.5.
    expect(brushed(false, [10.3, -1], [10.3, 1.5], 0)).toEqual(row(4, (index) => [10.3, -1 + 0.7 * index]));
  });
});
