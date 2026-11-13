import { describe, expect, it } from "vitest";
import {
  FRONT_DETAIL_FULL, FRONT_DETAIL_LIGHT, FRONT_PART, LET_IN, ROOM_BODY_HALF_X, bandOutline, blockedHalfWidth, buildHallFront, frontFootprint,
  frontPoint, hallWindowHoles, insetArchOutline, openIntervals, openingOutline,
} from "../hall-exterior.js";
import {
  DOME, FRONT_AXIS_X, FRONT_BAYS, FRONT_FACE_Z, FRONT_HALF_WIDTH, FRONT_PAVEMENT_Y, GROUND_OPENINGS, LINK_FACE_PROUD, TEMPLE,
} from "../hall-exterior-spec.js";
import { FRONT_PALETTES } from "../hall-exterior-material.js";
import { hallFrontCut } from "../hall-exterior-cut.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_OPENINGS, HALL_WALL_THICKNESS } from "../hall-spec.js";
import { HALL_PAVEMENT_Y } from "../hall-site.js";

const full = buildHallFront(FRONT_DETAIL_FULL);
const light = buildHallFront(FRONT_DETAIL_LIGHT);

function signedArea(loop: readonly (readonly [number, number])[]): number {
  let area = 0;
  loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length] ?? a;
    area += a[0] * b[1] - b[0] * a[1];
  });
  return area / 2;
}

/** Whether two segments cross (touching at a shared end does not count). */
function segmentsCross(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], d: readonly [number, number]): boolean {
  const orient = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]): number =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
}

function isSimple(loop: readonly (readonly [number, number])[]): boolean {
  for (let i = 0; i < loop.length; i++) {
    for (let j = i + 2; j < loop.length; j++) {
      if (i === 0 && j === loop.length - 1) continue;
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const c = loop[j];
      const d = loop[(j + 1) % loop.length];
      if (a !== undefined && b !== undefined && c !== undefined && d !== undefined && segmentsCross(a, b, c, d)) return false;
    }
  }
  return true;
}

describe("the front's frame", () => {
  it("puts the building's axis on the centre window and the front on the window wall's outer face", () => {
    const centre = HALL_OPENINGS.find((opening) => opening.id === "arch-centre");
    expect(centre).toBeDefined();
    // An opening's centre runs along its wall from x = −HALL_HALF_LENGTH.
    expect(FRONT_AXIS_X).toBeCloseTo(-HALL_HALF_LENGTH + (centre?.centre ?? 0), 9);
    expect(FRONT_AXIS_X).toBeCloseTo(-0.025, 3);
    expect(FRONT_FACE_Z).toBeCloseTo(-(HALL_HALF_WIDTH + HALL_WALL_THICKNESS.window.thickness), 9);
    expect(FRONT_PAVEMENT_Y).toBe(HALL_PAVEMENT_Y);
    expect(frontPoint(0, 0, 0)).toEqual([FRONT_AXIS_X, HALL_PAVEMENT_Y, FRONT_FACE_Z]);
    // u runs toward grid north, the planner's −x; proud runs out into the street, −z.
    expect(frontPoint(1, 2, 0.5)).toEqual([FRONT_AXIS_X - 1, HALL_PAVEMENT_Y + 2, FRONT_FACE_Z - 0.5]);
  });

  it("opens the front exactly where the hall's five windows are, in the planner's own coordinates", () => {
    const holes = hallWindowHoles();
    expect(holes.map((hole) => hole.opening.id).sort()).toEqual(["arch-centre", "arch-end", "arch-fireplace", "window-end", "window-fireplace"]);
    for (const hole of holes) {
      const [x, y] = frontPoint(hole.u, hole.bottom, 0);
      expect(x).toBeCloseTo(-HALL_HALF_LENGTH + hole.opening.centre, 9);
      expect(y).toBeCloseTo(hole.opening.sill, 9);
      expect(frontPoint(hole.u, hole.top, 0)[1]).toBeCloseTo(hole.opening.head, 9);
    }
  });

  it("agrees with the hall's survey along the front: the measured bays carry the hall's windows to within 6 cm", () => {
    const holes = hallWindowHoles();
    const pavilionDoorways = GROUND_OPENINGS.filter((opening) => opening.fill === "doorway").map((opening) => opening.u);
    const arches = holes.filter((hole) => hole.opening.id !== "arch-centre" && hole.rise > 0).map((hole) => hole.u);
    const sashes = holes.filter((hole) => hole.rise === 0).map((hole) => hole.u);
    // Each pavilion's doorway (P) stands under its Venetian window (room).
    for (const u of arches) expect(Math.min(...pavilionDoorways.map((d) => Math.abs(d - u)))).toBeLessThan(0.03);
    // Each link's bay (P) centres its sash window (room).
    const links = FRONT_BAYS.filter((bay) => bay.kind === "link").map((bay) => (bay.uMin + bay.uMax) / 2);
    for (const u of sashes) expect(Math.min(...links.map((centre) => Math.abs(centre - u)))).toBeLessThan(0.06);
  });

  it("stands the front where the hall's scan sees it through the windows and the front door", () => {
    for (const bay of FRONT_BAYS) expect(bay.proud).toBeGreaterThanOrEqual(LINK_FACE_PROUD);
    const proudOf = (kind: string): number => FRONT_BAYS.find((bay) => bay.kind === kind)?.proud ?? Number.NaN;
    const faceZ = (proud: number): number => frontPoint(0, 0, proud)[2];
    // The centre window's outer reveal, the pavilions' Venetian windows' and the front door's (E57, planner z).
    expect(faceZ(proudOf("temple"))).toBeCloseTo(-6.312, 3);
    expect(faceZ(proudOf("pavilion"))).toBeCloseTo(-6.607, 3);
    expect(faceZ(TEMPLE.podiumProud)).toBeCloseTo(-7.2, 3);
    // The links share the temple front's back wall; the end bays step forward of them, the south more than the north (DSM).
    expect(proudOf("link")).toBe(proudOf("temple"));
    const proudOfId = (id: string): number => FRONT_BAYS.find((bay) => bay.id === id)?.proud ?? Number.NaN;
    expect(proudOfId("end-bay-south") - proudOf("link")).toBeCloseTo(0.235, 3);
    expect(proudOfId("end-bay-north") - proudOf("link")).toBeCloseTo(0.125, 3);
    // The plan's column circles stand on the podium, clear of the back wall.
    expect(faceZ(TEMPLE.columnAxisProud)).toBeCloseTo(-6.836, 3);
    expect(TEMPLE.columnAxisProud + TEMPLE.diameterLower / 2).toBeLessThan(TEMPLE.podiumProud);
  });

  it("stands the dome where the DSM's rings centre it, streetward of the hall's painted dome", () => {
    const [x, , z] = frontPoint(DOME.u, 0, -DOME.behindFace);
    expect(x).toBeCloseTo(-0.053, 6);
    expect(z).toBeCloseTo(-0.447, 6);
  });
});

describe("the front's outlines", () => {
  it("draws an arched opening counter-clockwise, its crown at the rise", () => {
    const outline = openingOutline(0, 1, 0, 2, 1, 16);
    expect(signedArea(outline)).toBeGreaterThan(0);
    expect(Math.max(...outline.map(([, z]) => z))).toBeCloseTo(3, 2);
    expect(isSimple(outline)).toBe(true);
  });

  it("makes a surround open at its foot one simple polygon", () => {
    const band = bandOutline(openingOutline(0, 1.4, 0, 2, 1.4, 18), openingOutline(0, 0.9, 0, 2, 0.9, 18));
    expect(isSimple(band)).toBe(true);
    expect(Math.abs(signedArea(band))).toBeGreaterThan(0);
  });

  it("sets a fanlight's glass inside its arch without crossing it", () => {
    const opening = GROUND_OPENINGS.find((candidate) => candidate.fill === "doorway");
    expect(opening).toBeDefined();
    if (opening === undefined) return;
    const half = opening.width / 2;
    const arch = openingOutline(opening.u, half, opening.bottom, opening.top, opening.rise, 32);
    const glass = insetArchOutline(opening.u, half, opening.rise, opening.top, 0.08);
    expect(glass.length).toBeGreaterThan(3);
    const crown = Math.max(...arch.map(([, z]) => z));
    for (const [u, z] of glass) {
      expect(z).toBeLessThan(crown - 0.07);
      expect(Math.abs(u - opening.u)).toBeLessThan(half);
    }
  });

  it("breaks the courses round each opening and its voussoirs, nowhere else", () => {
    expect(openIntervals(0, 10, [[2, 3], [2.5, 4], [8, 12]])).toEqual([[0, 2], [4, 8]]);
    const door = GROUND_OPENINGS.find((opening) => opening.fill === "front-door");
    expect(door).toBeDefined();
    if (door === undefined) return;
    expect(blockedHalfWidth(door, door.bottom + 0.5)).toBeCloseTo(door.width / 2, 9);
    // Over the springing the ring of voussoirs reaches out past the opening, then closes over the crown.
    expect(blockedHalfWidth(door, door.top + 0.01)).toBeGreaterThan(door.width / 2 + door.ringWidth * 0.9);
    expect(blockedHalfWidth(door, door.top + door.rise + door.ringWidth + 0.05)).toBe(0);
    expect(blockedHalfWidth(door, door.bottom - 0.1)).toBe(0);
  });
});

describe("the built front", () => {
  it("is finite, stands on the pavement and keeps within its frontage", () => {
    const position = full.geometry.getAttribute("position");
    const part = full.geometry.getAttribute("aPart");
    const footprint = frontFootprint();
    let minY = Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    const underfoot = new Set<number>();
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
      minY = Math.min(minY, y);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      if (y < HALL_PAVEMENT_Y - 1e-6) underfoot.add(Math.round(part.getX(i)));
    }
    // Nothing goes below the pavement but the downpipes, let into it as into their drains.
    expect(minY).toBeGreaterThanOrEqual(HALL_PAVEMENT_Y - LET_IN - 1e-6);
    expect([...underfoot]).toEqual([FRONT_PART.metal]);
    // The pavilions' top cornice overhangs them by 0.3 m; nothing reaches past the end bays.
    expect(minX).toBeGreaterThanOrEqual(footprint.xMin - 1e-6);
    expect(maxX).toBeLessThanOrEqual(footprint.xMax + 1e-6);
    expect(footprint.xMax - footprint.xMin).toBeCloseTo(2 * FRONT_HALF_WIDTH, 6);
  });

  it("is made of closed solids, so the cut reads as a section through them", () => {
    // Weld coincident vertices, then every edge must be used an even number of times.
    const position = full.geometry.getAttribute("position");
    const index = full.geometry.getIndex();
    expect(index).not.toBeNull();
    if (index === null) return;
    const ids = new Map<string, number>();
    const welded = new Int32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      const key = [position.getX(i), position.getY(i), position.getZ(i)].map((value) => String(Math.round(value * 1e4))).join(",");
      let id = ids.get(key);
      if (id === undefined) {
        id = ids.size;
        ids.set(key, id);
      }
      welded[i] = id;
    }
    const edges = new Map<string, number>();
    for (let t = 0; t < index.count; t += 3) {
      const corners = [welded[index.getX(t)] ?? -1, welded[index.getX(t + 1)] ?? -1, welded[index.getX(t + 2)] ?? -1];
      for (let k = 0; k < 3; k++) {
        const a = corners[k] ?? -1;
        const b = corners[(k + 1) % 3] ?? -1;
        if (a === b) continue;
        const key = a < b ? `${String(a)}:${String(b)}` : `${String(b)}:${String(a)}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    const odd = [...edges.values()].filter((count) => count % 2 !== 0).length;
    expect(odd).toBe(0);
  });

  it("tags every triangle with a material the finishes all colour", () => {
    const parts = full.geometry.getAttribute("aPart");
    const known = new Set<number>(Object.values(FRONT_PART));
    const used = new Set<number>();
    for (let i = 0; i < parts.count; i++) used.add(parts.getX(i));
    // The material's colour chain counts the parts from 0, and every part is drawn somewhere.
    expect([...known].sort((a, b) => a - b)).toEqual([...Array(known.size).keys()]);
    expect([...used].sort((a, b) => a - b)).toEqual([...known].sort((a, b) => a - b));
    for (const palette of Object.values(FRONT_PALETTES)) {
      for (const name of Object.keys(FRONT_PART)) expect(palette[name as keyof typeof FRONT_PART]).toMatch(/^#[0-9a-f]{6}$/);
      expect(palette.cut).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("stays within its budget, and a phone's finish draws fewer triangles", () => {
    expect(full.triangles).toBeLessThan(90_000);
    expect(light.triangles).toBeLessThan(full.triangles);
    expect(light.triangles).toBeLessThan(65_000);
  });

  it("is a skin on the window wall where the wall's body stands, never inside it", () => {
    // In front of the room (the pavilions, links and temple front), nothing of the front lies between
    // the room's plane and the wall's outer face above the floor; and nothing anywhere reaches the room.
    const position = full.geometry.getAttribute("position");
    const pavilionsOuterX = Math.max(...FRONT_BAYS.filter((bay) => bay.kind === "pavilion").map((bay) => Math.abs(frontPoint(bay.uMax, 0, 0)[0])));
    expect(pavilionsOuterX).toBeLessThan(ROOM_BODY_HALF_X);
    let inside = 0;
    let inRoom = 0;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      if (Math.abs(x) < pavilionsOuterX - 0.1 && y > 0.05 && y < 6 && z > FRONT_FACE_Z + 0.002 && z < -HALL_HALF_WIDTH) inside++;
      if (Math.abs(x) < HALL_HALF_LENGTH && y > 0 && y < 6.7 && z > -HALL_HALF_WIDTH + 1e-3 && z < HALL_HALF_WIDTH) inRoom++;
    }
    expect(inside).toBe(0);
    expect(inRoom).toBe(0);
  });

  it("starts uncut until the cutaway says otherwise", () => {
    expect(hallFrontCut.value).toBe(100);
  });
});
