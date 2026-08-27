import { describe, expect, it } from "vitest";
import { denseSpan, parseObjVertices, roomFrameFromVertices, verticalRoomSpan } from "../obj-bounds.js";

// A 10 x 6 x 3 m box room, floor at z = 0, sampled at 0.25 m in XGRIDS' Z-up
// frame. Floor, ceiling AND the four walls are sampled, because a real mesh
// export samples every surface the operator saw — an earlier version of this
// fixture had only the floor and ceiling planes, which made the vertical axis
// look bimodal and pushed the measurement toward the wrong rule.
//
// Trailing off +Y is a sparse "corridor spur", and rising above is a
// "stairwell" of moderate density: together they are the shape of every
// handheld capture, whose raw bounding box is far larger than the room.
function boxRoomVertices(): [number, number, number][] {
  const verts: [number, number, number][] = [];
  for (let x = 0; x <= 10; x += 0.25) {
    for (let y = 0; y <= 6; y += 0.25) {
      verts.push([x, y, 0]);
      verts.push([x, y, 3]);
    }
  }
  // Walls, so the vertical histogram is a continuous band, as real ones are.
  for (let z = 0; z <= 3; z += 0.25) {
    for (let x = 0; x <= 10; x += 0.25) {
      verts.push([x, 0, z]);
      verts.push([x, 6, z]);
    }
    for (let y = 0; y <= 6; y += 0.25) {
      verts.push([0, y, z]);
      verts.push([10, y, z]);
    }
  }
  // Corridor spur leading away, and a stairwell climbing out of the room.
  for (let i = 0; i < 24; i += 1) verts.push([5, 8 + i, 1.5]);
  for (let z = 3.5; z <= 14; z += 0.25) {
    for (let k = 0; k < 6; k += 1) verts.push([1 + k * 0.2, 1, z]);
  }
  return verts;
}

describe("parseObjVertices", () => {
  it("reads only v records and ignores faces, normals, comments and blanks", () => {
    const verts = parseObjVertices("# c\n\nv 1 2 3\nvn 0 0 1\nvt 0 0\nf 1 1 1\nv 4 5 6\n");
    expect(verts).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it("skips malformed vertex records rather than emitting NaN coordinates", () => {
    expect(parseObjVertices("v 1 2 3\nv 9 nope 9\nv 4 5 6\n")).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it("tolerates the extra fields OBJ allows after xyz, such as vertex colour", () => {
    expect(parseObjVertices("v 1 2 3 0.5 0.5 0.5\n")).toEqual([[1, 2, 3]]);
  });
});

describe("denseSpan", () => {
  it("run mode returns the dominant occupied run and drops a sparse tail", () => {
    const span = denseSpan(boxRoomVertices().map((v) => v[1]), "run");
    expect(span).not.toBeNull();
    expect(span?.[0]).toBeCloseTo(0, 0);
    expect(span?.[1]).toBeCloseTo(6, 0);
  });

  it("returns null when there is no data to measure", () => {
    expect(denseSpan([])).toBeNull();
  });
});

describe("verticalRoomSpan", () => {
  it("cuts at the ceiling, excluding a stairwell climbing out of the room", () => {
    const span = verticalRoomSpan(boxRoomVertices().map((v) => v[2]));
    expect(span?.[0]).toBeCloseTo(0, 0);
    expect(span?.[1]).toBeCloseTo(3, 0);
  });

  it("prefers the band holding the most geometry over a denser but thinner one", () => {
    // A sparse slab far below, plus a real room: the room must win on mass.
    const values: number[] = [];
    for (let i = 0; i < 200; i += 1) values.push(-30 + (i % 3) * 0.1);
    for (let i = 0; i < 4000; i += 1) values.push((i % 40) * 0.1);
    const span = verticalRoomSpan(values);
    expect(span?.[0]).toBeGreaterThan(-5);
  });

  it("returns null when there is no data to measure", () => {
    expect(denseSpan([])).toBeNull();
  });
});

describe("roomFrameFromVertices", () => {
  it("recovers the occupied room extent, rejecting both the corridor spur and the stairwell", () => {
    const frame = roomFrameFromVertices(boxRoomVertices());
    expect(frame).not.toBeNull();
    expect(frame?.extent[0]).toBeCloseTo(10, 0);
    expect(frame?.extent[1]).toBeCloseTo(6, 0);
    expect(frame?.extent[2]).toBeCloseTo(3, 0);
  });

  it("puts the floor at the dense low edge, not at a spurious sub-floor point", () => {
    const verts = boxRoomVertices();
    verts.push([5, 3, -12]);
    expect(roomFrameFromVertices(verts)?.floorZ).toBeCloseTo(0, 0);
  });

  it("centres the frame on the occupied room, not on the raw bounding box", () => {
    const frame = roomFrameFromVertices(boxRoomVertices());
    expect(frame?.center[0]).toBeCloseTo(5, 0);
    expect(frame?.center[1]).toBeCloseTo(3, 0);
  });

  it("reports how much of the capture the room frame retained", () => {
    const frame = roomFrameFromVertices(boxRoomVertices());
    expect(frame?.retainedFraction).toBeGreaterThan(0.9);
    expect(frame?.retainedFraction).toBeLessThanOrEqual(1);
  });

  it("refuses a capture with too few vertices to measure honestly", () => {
    expect(roomFrameFromVertices([[0, 0, 0], [1, 1, 1]])).toBeNull();
  });
});
