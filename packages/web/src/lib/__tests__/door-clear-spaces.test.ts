import { describe, expect, it } from "vitest";
import type { HallOpening, HallWall } from "../../components/grand-hall/hall-spec.js";
import {
  GRAND_HALL_DOOR_CLEAR_SPACES,
  doorClearSpaces,
  doorKeepOuts,
  doorNameList,
  footprintInSpace,
  keptClearLine,
  roomDoorClearSpaces,
  slideClearOfDoors,
  type DoorClearSpace,
  type Footprint,
} from "../door-clear-spaces.js";

// Every expected figure below is worked by hand from hall-spec.ts: the door
// wall's face at z 5.295, the fireplace wall's at x −10.5675, each door's
// centre from the survey's scan X, and the clear space 1.5 m deep and 0.3 m
// wider than the door on each side.

function space(id: string): DoorClearSpace {
  const found = GRAND_HALL_DOOR_CLEAR_SPACES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no clear space ${id}`);
  return found;
}

function box(x: number, z: number, half = 0.5): Footprint {
  return { x, z, halfW: half, halfD: half };
}

const HALL = { roomWidthM: 21, roomLengthM: 10.5 } as const;

describe("the Grand Hall's door clear spaces", () => {
  it("keeps a space in front of each of its four doors and none in front of a window", () => {
    expect(GRAND_HALL_DOOR_CLEAR_SPACES.map((door) => door.id)).toEqual([
      "door-end",
      "door-main",
      "door-fireplace",
      "door-fire-exit",
    ]);
  });

  it("runs each door-wall space from the wall face 1.5 m into the room, 0.3 m past each jamb", () => {
    // End door: centre x 8.82, 1.10 m wide.
    expect(space("door-end").rect.minX).toBeCloseTo(7.97, 6);
    expect(space("door-end").rect.maxX).toBeCloseTo(9.67, 6);
    // Main door: centre x 0.005, 1.45 m wide.
    expect(space("door-main").rect.minX).toBeCloseTo(-1.02, 6);
    expect(space("door-main").rect.maxX).toBeCloseTo(1.03, 6);
    // Fireplace door: centre x −8.87, 1.08 m wide.
    expect(space("door-fireplace").rect.minX).toBeCloseTo(-9.71, 6);
    expect(space("door-fireplace").rect.maxX).toBeCloseTo(-8.03, 6);
    for (const id of ["door-end", "door-main", "door-fireplace"]) {
      expect(space(id).rect.maxZ).toBeCloseTo(5.295, 6);
      expect(space(id).rect.minZ).toBeCloseTo(3.795, 6);
      expect(space(id).inward).toEqual([0, -1]);
    }
  });

  it("runs the fire exit's space out from the fireplace wall", () => {
    const exit = space("door-fire-exit");
    expect(exit.rect.minX).toBeCloseTo(-10.5675, 6);
    expect(exit.rect.maxX).toBeCloseTo(-9.0675, 6);
    // Centre z −3.235, 1.06 m wide.
    expect(exit.rect.minZ).toBeCloseTo(-4.065, 6);
    expect(exit.rect.maxZ).toBeCloseTo(-2.405, 6);
    expect(exit.inward).toEqual([1, 0]);
  });

  it("names each door as staff do", () => {
    expect(GRAND_HALL_DOOR_CLEAR_SPACES.map((door) => door.name)).toEqual([
      "the end door",
      "the main door",
      "the fireplace door",
      "the fire exit",
    ]);
  });
});

describe("door clear spaces from a room's survey", () => {
  const wall: HallWall = { id: "door", length: 6, origin: [3, 0, 2], tangent: [-1, 0, 0], normal: [0, 0, -1] };
  const opening = (id: string, kind: HallOpening["kind"], centre: number, width: number): HallOpening => (
    { id, kind, wall: "door", centre, width, sill: 0, head: 2.1 }
  );

  it("builds a space for each door from its wall's frame and the figure given", () => {
    const spaces = doorClearSpaces(
      [opening("d1", "door", 2, 1), opening("w1", "window", 4, 1.2)],
      [wall],
      { d1: "the side door" },
      { depthM: 1, sideM: 0.25, basis: "test" },
    );
    expect(spaces).toHaveLength(1);
    // Centre x 3 − 2 = 1; half span 0.5 + 0.25.
    expect(spaces[0]?.rect).toEqual({ minX: 0.25, maxX: 1.75, minZ: 1, maxZ: 2 });
    expect(spaces[0]?.name).toBe("the side door");
  });

  it("calls an unnamed door simply a door", () => {
    const spaces = doorClearSpaces([opening("d2", "door", 3, 0.9)], [wall], {});
    expect(spaces[0]?.name).toBe("the door");
  });

  it("refuses a door on a wall the survey does not have", () => {
    expect(() => doorClearSpaces([{ ...opening("d3", "door", 1, 1), wall: "end" }], [wall], {})).toThrow(/end/);
  });

  it("has the Grand Hall's doors on record and no other room's", () => {
    expect(roomDoorClearSpaces("grand-hall")).toBe(GRAND_HALL_DOOR_CLEAR_SPACES);
    expect(roomDoorClearSpaces("saloon")).toBeNull();
    expect(roomDoorClearSpaces(null)).toBeNull();
  });
});

describe("whether a piece stands in a clear space", () => {
  const main = (): DoorClearSpace => space("door-main");

  it("counts a footprint that reaches into the space", () => {
    expect(footprintInSpace(box(0, 3.4), main())).toBe(true);
  });

  it("lets a footprint touch the space's edge", () => {
    // z from 2.795 to 3.795: its back edge on the space's inner edge.
    expect(footprintInSpace(box(0, 3.295), main())).toBe(false);
    // x from 1.03 to 2.03: alongside the space.
    expect(footprintInSpace(box(1.53, 4.5), main())).toBe(false);
  });

  it("ignores a footprint well clear of the door", () => {
    expect(footprintInSpace(box(4, 4.5), main())).toBe(false);
  });
});

describe("sliding pieces clear of the doors", () => {
  const spaces = GRAND_HALL_DOOR_CLEAR_SPACES;

  it("leaves pieces that stand clear where they are", () => {
    expect(slideClearOfDoors({ ...HALL, moving: [box(0, 0)], others: [], spaces, stepM: null })).toEqual({ kind: "clear" });
  });

  it("takes the shortest way out, straight back from the main door", () => {
    // z 3.5..4.5 is 0.705 m into the space; sideways would be 1.52 or 1.53 m.
    const slide = slideClearOfDoors({ ...HALL, moving: [box(0, 4)], others: [], spaces, stepM: null });
    expect(slide.kind).toBe("slide");
    if (slide.kind !== "slide") return;
    expect(slide.dx).toBeCloseTo(0, 9);
    expect(slide.dz).toBeCloseTo(-0.705, 9);
    expect(slide.doors.map((door) => door.id)).toEqual(["door-main"]);
  });

  it("slides sideways when that is shorter", () => {
    // x −8.8..−7.8 reaches 0.77 m past the fireplace door's space edge at −8.03.
    const slide = slideClearOfDoors({ ...HALL, moving: [box(-8.3, 4.5)], others: [], spaces, stepM: null });
    expect(slide.kind === "slide" ? [slide.dx, slide.dz] : null).toEqual([expect.closeTo(0.77, 9), expect.closeTo(0, 9)]);
  });

  it("never slides a piece out of the room", () => {
    // 0.31 m left would clear the fireplace door but cross the fireplace wall at x −10.5.
    const slide = slideClearOfDoors({ ...HALL, moving: [box(-9.9, 4.4)], others: [], spaces, stepM: null });
    expect(slide.kind === "slide" ? [slide.dx, slide.dz] : null).toEqual([expect.closeTo(0, 9), expect.closeTo(-1.105, 9)]);
  });

  it("moves a table and its chairs together by the one offset that clears them all", () => {
    const table = box(0, 3.6);
    const chair = box(0, 4.6, 0.25);
    const slide = slideClearOfDoors({ ...HALL, moving: [table, chair], others: [], spaces, stepM: null });
    // The chair decides: its back edge at z 4.85 must come to 3.795.
    expect(slide.kind === "slide" ? [slide.dx, slide.dz] : null).toEqual([expect.closeTo(0, 9), expect.closeTo(-1.055, 9)]);
  });

  it("keeps to the planner's grid when snapping is on", () => {
    const slide = slideClearOfDoors({ ...HALL, moving: [box(0, 4)], others: [], spaces, stepM: 1 });
    expect(slide.kind === "slide" ? [slide.dx, slide.dz] : null).toEqual([expect.closeTo(0, 9), expect.closeTo(-1, 9)]);
  });

  it("lands the piece in hand on a grid point, wherever a wall snap had left it", () => {
    // Held at x 0.3: the nearest grid point clear of the main door is (0, 3).
    const slide = slideClearOfDoors({ ...HALL, moving: [box(0.3, 4)], others: [], spaces, stepM: 1, anchor: { x: 0.3, z: 4 } });
    expect(slide.kind === "slide" ? [slide.dx, slide.dz] : null).toEqual([expect.closeTo(-0.3, 9), expect.closeTo(-1, 9)]);
  });

  it("goes round other furniture when a clear spot is almost as near", () => {
    // Straight back (0.705 m) would land on the piece at x −0.3..0.7, z 2.3..3.3.
    // Back and 0.8 m left sets it beside that piece instead: 1.07 m in all.
    const slide = slideClearOfDoors({ ...HALL, moving: [box(0, 4)], others: [box(0.2, 2.8)], spaces, stepM: null });
    expect(slide.kind === "slide" ? [slide.dx, slide.dz] : null).toEqual([expect.closeTo(-0.8, 9), expect.closeTo(-0.705, 9)]);
  });

  it("does not wander off to find free floor: the door comes first", () => {
    const others = [{ x: 0, z: 2.8, halfW: 3, halfD: 0.5 }, box(1.6, 4), box(-1.6, 4)];
    const slide = slideClearOfDoors({ ...HALL, moving: [box(0, 4)], others, spaces, stepM: null });
    expect(slide.kind === "slide" ? [slide.dx, slide.dz] : null).toEqual([expect.closeTo(0, 9), expect.closeTo(-0.705, 9)]);
  });

  it("can insist on a spot clear of other furniture too, as near as there is one", () => {
    // Sideways, the pieces at x ±1.6 are in the way until 2.6 m; under the long
    // piece (z 2.3..3.3) is free from 2.2 m back.
    const others = [{ x: 0, z: 2.8, halfW: 3, halfD: 0.5 }, box(1.6, 4), box(-1.6, 4)];
    const slide = slideClearOfDoors({ ...HALL, moving: [box(0, 4)], others, spaces, stepM: null, avoidOthers: "require" });
    expect(slide.kind === "slide" ? [slide.dx, slide.dz] : null).toEqual([expect.closeTo(0, 9), expect.closeTo(-2.2, 9)]);
  });

  it("gives up rather than carry pieces further than it may", () => {
    const others = [{ x: 0, z: 2.8, halfW: 3, halfD: 0.5 }, box(1.6, 4), box(-1.6, 4)];
    const slide = slideClearOfDoors({ ...HALL, moving: [box(0, 4)], others, spaces, stepM: null, avoidOthers: "require", maxDistanceM: 2 });
    expect(slide.kind).toBe("stuck");
  });

  it("says so when no clear spot exists", () => {
    const everywhere: DoorClearSpace = { ...space("door-main"), rect: { minX: -11, maxX: 11, minZ: -6, maxZ: 6 } };
    const slide = slideClearOfDoors({ ...HALL, moving: [box(0, 4)], others: [], spaces: [everywhere], stepM: null });
    expect(slide.kind).toBe("stuck");
  });
});

describe("door keep-outs for the layout engines", () => {
  it("hands each space over as a centred rectangle", () => {
    const main = doorKeepOuts([space("door-main")])[0];
    expect(main?.cx).toBeCloseTo(0.005, 6);
    expect(main?.cz).toBeCloseTo(4.545, 6);
    expect(main?.width).toBeCloseTo(2.05, 6);
    expect(main?.depth).toBeCloseTo(1.5, 6);
  });
});

describe("door words", () => {
  it("lists doors in plain British English", () => {
    expect(doorNameList([space("door-main")])).toBe("the main door");
    expect(doorNameList([space("door-main"), space("door-fire-exit")])).toBe("the main door and the fire exit");
    expect(doorNameList([space("door-end"), space("door-main"), space("door-fire-exit")])).toBe("the end door, the main door and the fire exit");
  });

  it("names the door kept clear in one quiet line", () => {
    expect(keptClearLine([space("door-fireplace")])).toBe("Kept the fireplace door clear.");
  });
});
