import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildHallGeometry, buildHallWallGeometry, floorUv } from "../hall-geometry.js";
import { parseWallRelief, type WallRelief, type WallReliefMesh } from "../hall-relief.js";
import { MODELLED_DOOR, isPanelling } from "../hall-walls.js";
import {
  HALL_CHANDELIERS,
  HALL_COFFERS,
  HALL_DOME,
  HALL_ELEVATION,
  HALL_HALF_LENGTH,
  HALL_HALF_WIDTH,
  HALL_HEIGHT,
  HALL_OPENINGS,
  HALL_WALLS,
  domeHeightAt,
  fromSurvey,
  hallWall,
  isWindow,
  openingHeadAt,
  openingTop,
  wallPoint,
} from "../hall-spec.js";
import {
  clipPolygonToHemisphere,
  hallAmbientOcclusion,
  hallChandelierIrradiance,
  hallDaylightIrradiance,
  isInsideOpening,
  polygonFormFactor,
  type Vec3,
} from "../hall-lighting-model.js";
import { WALL_ATLAS_FITS, WALL_ATLAS_ORIGIN, WALL_ATLAS_PPM, WALL_ATLAS_ROW, WALL_ATLAS_SIZE, atlasUvForPoint, wallAtlasUv } from "../hall-atlas.js";
import { DOME_ARC, DOME_PROFILE, domeUv } from "../hall-ceiling.js";

describe("Grand Hall survey", () => {
  it("measures the panelled interior larger than the published plan, as scanned", () => {
    expect(HALL_HALF_LENGTH * 2).toBeCloseTo(21.135, 3);
    expect(HALL_HALF_WIDTH * 2).toBeCloseTo(10.59, 3);
    expect(HALL_HEIGHT).toBeCloseTo(6.7, 3);
  });

  it("maps scan coordinates into the planner frame", () => {
    // The dome's axis, found in the scan, lies at the centre of the room.
    const dome = fromSurvey([8.793, -4.974, 8.97]);
    expect(Math.abs(dome[0])).toBeLessThan(0.02);
    expect(Math.abs(dome[2])).toBeLessThan(0.02);
    expect(dome[1]).toBeCloseTo(8.925, 3);
    // Station 039, in the centre window bay, stands beyond the window wall's
    // plane in the planner's −z, near x = 0.
    const station = fromSurvey([8.9266, -9.5346, 1.5191]);
    expect(station[2]).toBeLessThan(-4.5);
    expect(Math.abs(station[0])).toBeLessThan(0.2);
  });

  it("keeps every opening inside its wall and every arch's architrave under the frieze's top", () => {
    for (const opening of HALL_OPENINGS) {
      const wall = hallWall(opening.wall);
      expect(opening.centre - opening.width / 2).toBeGreaterThan(0);
      expect(opening.centre + opening.width / 2).toBeLessThan(wall.length);
      expect(openingTop(opening) + 0.33).toBeLessThan(HALL_ELEVATION.friezeTop);
    }
  });

  it("puts the windows on the -Z wall, the doors on +Z and the fireplace at -X", () => {
    const windows = HALL_OPENINGS.filter(isWindow);
    expect(windows).toHaveLength(5);
    for (const opening of windows) expect(wallPoint(hallWall(opening.wall), opening.centre, 1)[2]).toBeCloseTo(-HALL_HALF_WIDTH);
    const doors = HALL_OPENINGS.filter((opening) => opening.wall === "door");
    expect(doors).toHaveLength(3);
    for (const opening of doors) expect(wallPoint(hallWall(opening.wall), opening.centre, 1)[2]).toBeCloseTo(HALL_HALF_WIDTH);
    expect(wallPoint(hallWall("fireplace"), 1, 1)[0]).toBeCloseTo(-HALL_HALF_LENGTH);
  });

  it("finds the windows and doors symmetrical about the hall's cross axis, as built", () => {
    const pairs = (wall: "window" | "door"): number[] => HALL_OPENINGS.filter((opening) => opening.wall === wall).map((opening) => opening.centre).sort((a, b) => a - b);
    for (const wall of ["window", "door"] as const) {
      const centres = pairs(wall);
      const axis = ((centres[0] ?? 0) + (centres[centres.length - 1] ?? 0)) / 2;
      expect(Math.abs(axis - HALL_HALF_LENGTH)).toBeLessThan(0.06);
      for (let i = 0; i < centres.length; i++) {
        // As built, to the scan's few centimetres: the main door stands 3 cm
        // off the line through its two side doors.
        const mirror = 2 * axis - (centres[i] ?? 0);
        expect(Math.min(...centres.map((centre) => Math.abs(centre - mirror)))).toBeLessThan(0.07);
      }
    }
  });

  it("rises an arched window's head in a semicircle over its whole width", () => {
    const arch = HALL_OPENINGS.find((opening) => opening.kind === "arched-window");
    expect(arch).toBeDefined();
    if (arch === undefined) return;
    expect(openingHeadAt(arch, arch.centre)).toBeCloseTo(arch.head + arch.width / 2);
    expect(openingHeadAt(arch, arch.centre + arch.width / 2)).toBeCloseTo(arch.head);
    expect(openingHeadAt(arch, arch.centre + arch.width)).toBeNull();
    expect(isInsideOpening(arch, arch.centre, arch.head + 0.5)).toBe(true);
    expect(isInsideOpening(arch, arch.centre + arch.width / 2 - 0.05, arch.head + 0.5)).toBe(false);
  });

  it("profiles the dome from the ceiling at its foot to the crown, never rising outward", () => {
    expect(domeHeightAt(HALL_DOME.footRadius)).toBeCloseTo(HALL_HEIGHT);
    expect(domeHeightAt(HALL_DOME.bandTopRadius)).toBeGreaterThan(7.4);
    let previous = Infinity;
    for (let r = HALL_DOME.crownRadius; r <= HALL_DOME.footRadius; r += 0.05) {
      const height = domeHeightAt(r);
      expect(height).toBeLessThanOrEqual(previous + 1e-9);
      previous = height;
    }
    expect(DOME_ARC).toBeGreaterThan(3);
    expect(DOME_PROFILE[0]?.[1]).toBeCloseTo(HALL_HEIGHT);
  });

  it("hangs the four scroll chandeliers from the coffer lattice's roses", () => {
    const roses = HALL_CHANDELIERS.filter((chandelier) => chandelier.style === "scroll");
    expect(roses).toHaveLength(4);
    for (const chandelier of roses) {
      expect(Math.abs(chandelier.position[0])).toBeCloseTo(6.5 * HALL_COFFERS.pitch, 6);
      expect(Math.abs(chandelier.position[2])).toBeCloseTo(3 * HALL_COFFERS.rowPitch, 6);
      expect(chandelier.bottom).toBeLessThan(chandelier.position[1]);
    }
  });
});

describe("Grand Hall wall atlas", () => {
  it("fits all four walls in one square image without overlap", () => {
    expect(WALL_ATLAS_FITS).toBe(true);
    const rects = HALL_WALLS.map((wall) => {
      const [x, y] = WALL_ATLAS_ORIGIN[wall.id];
      return { id: wall.id, x0: x, x1: x + Math.ceil(wall.length * WALL_ATLAS_PPM), y0: y, y1: y + WALL_ATLAS_ROW };
    });
    for (const rect of rects) {
      expect(rect.x1, rect.id).toBeLessThanOrEqual(WALL_ATLAS_SIZE);
      expect(rect.y1, rect.id).toBeLessThanOrEqual(WALL_ATLAS_SIZE);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (a === undefined || b === undefined) continue;
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
        expect(overlap, `${a.id}/${b.id}`).toBe(false);
      }
    }
  });

  it("finds a wall point's texel by projecting it onto its wall", () => {
    HALL_WALLS.forEach((wall, index) => {
      for (const [u, v, depth] of [[0.5, 1, 0], [wall.length - 0.5, 6, 0.12], [wall.length / 2, 3, -0.4]] as const) {
        const point = wallPoint(wall, u, v, depth);
        const [s, t] = atlasUvForPoint(index, point);
        const [es, et] = wallAtlasUv(wall.id, u, v);
        expect(s).toBeCloseTo(es, 9);
        expect(t).toBeCloseTo(et, 9);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
      }
    });
  });

  it("unrolls the dome from its foot at the top of the image to its centre at the bottom", () => {
    expect(domeUv(0, 0)).toEqual([0, 1]);
    const [u, v] = domeUv(Math.PI, DOME_ARC);
    expect(u).toBeCloseTo(0.5);
    expect(v).toBeCloseTo(0);
  });
});

describe("Grand Hall light model", () => {
  const UP: Vec3 = [0, 1, 0];

  it("pools chandelier light on the floor under the fittings", () => {
    const corner = hallChandelierIrradiance([-10.4, 0, 5.2], UP);
    for (const chandelier of HALL_CHANDELIERS) {
      const below = hallChandelierIrradiance([chandelier.position[0], 0, chandelier.position[2]], UP);
      expect(below).toBeGreaterThan(corner);
    }
    expect(hallChandelierIrradiance([0, 0, 0], UP)).toBeGreaterThan(corner * 2);
  });

  it("gives daylight to the floor near the windows and none on the window wall", () => {
    const nearWindow = hallDaylightIrradiance([0, 0, -4.2], UP);
    const farSide = hallDaylightIrradiance([0, 0, 4.8], UP);
    expect(nearWindow).toBeGreaterThan(farSide);
    expect(hallDaylightIrradiance([0, 2, -HALL_HALF_WIDTH], [0, 0, 1])).toBe(0);
    expect(hallDaylightIrradiance([0, 2, HALL_HALF_WIDTH - 0.01], [0, 0, -1])).toBeGreaterThan(0);
  });

  it("darkens floor corners against open floor", () => {
    expect(hallAmbientOcclusion([-10.5, 0, -5.25], UP, "floor")).toBeLessThan(hallAmbientOcclusion([0, 0, 0], UP, "floor"));
    expect(hallAmbientOcclusion([0, 0, 0], UP, "floor")).toBeGreaterThan(0.95);
  });

  it("computes a unit form factor for an emitter filling the hemisphere and none behind", () => {
    const big: Vec3[] = [[-1000, 1, -1000], [1000, 1, -1000], [1000, 1, 1000], [-1000, 1, 1000]];
    expect(polygonFormFactor([0, 0, 0], UP, big)).toBeCloseTo(1, 2);
    expect(polygonFormFactor([0, 2, 0], UP, big)).toBe(0);
    const straddling: Vec3[] = [[-1, -1, -2], [1, -1, -2], [1, 1, -2], [-1, 1, -2]];
    expect(clipPolygonToHemisphere(straddling, [0, 0, 0], UP).length).toBeGreaterThanOrEqual(3);
    expect(polygonFormFactor([0, 0, 0], UP, straddling)).toBeGreaterThan(0);
  });
});

/** The relief file as shipped to the browser. */
function shippedReliefBytes(): ArrayBuffer {
  const file = readFileSync(path.resolve("public/rooms/grand-hall/survey-2026-07-11/walls-relief.bin"));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

function shippedRelief(): WallRelief {
  return parseWallRelief(shippedReliefBytes());
}

/** Depth of a wall's relief at wall-local (u, v), from the triangle containing it. */
function reliefDepthAt(mesh: WallReliefMesh, u: number, v: number): number {
  const { positions: p, indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] ?? 0, indices[t + 1] ?? 0, indices[t + 2] ?? 0];
    const ax = p[a * 3] ?? 0;
    const ay = p[a * 3 + 1] ?? 0;
    const bx = p[b * 3] ?? 0;
    const by = p[b * 3 + 1] ?? 0;
    const cx = p[c * 3] ?? 0;
    const cy = p[c * 3 + 1] ?? 0;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue;
    const wa = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / det;
    const wb = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / det;
    const wc = 1 - wa - wb;
    if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) continue;
    return wa * (p[a * 3 + 2] ?? 0) + wb * (p[b * 3 + 2] ?? 0) + wc * (p[c * 3 + 2] ?? 0);
  }
  return Number.NaN;
}

describe("Grand Hall wall relief", () => {
  const relief = shippedRelief();
  const wallMesh = (id: (typeof HALL_WALLS)[number]["id"]): WallReliefMesh => {
    const mesh = relief.get(id);
    if (mesh === undefined) throw new Error(`no relief for ${id}`);
    return mesh;
  };

  it("ships a relief for every wall, spanning it from end to end and floor to ceiling", () => {
    for (const wall of HALL_WALLS) {
      const { positions, indices } = wallMesh(wall.id);
      expect(indices.length % 3).toBe(0);
      let uMin = Infinity;
      let uMax = -Infinity;
      let vMin = Infinity;
      let vMax = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        uMin = Math.min(uMin, positions[i] ?? 0);
        uMax = Math.max(uMax, positions[i] ?? 0);
        vMin = Math.min(vMin, positions[i + 1] ?? 0);
        vMax = Math.max(vMax, positions[i + 1] ?? 0);
      }
      expect(uMin, wall.id).toBeCloseTo(0, 3);
      expect(uMax, wall.id).toBeCloseTo(wall.length, 3);
      expect(vMin, wall.id).toBeCloseTo(0, 3);
      expect(vMax, wall.id).toBeCloseTo(HALL_HEIGHT, 3);
      // Simplified to a few thousand faces per wall, not the scan's millions.
      expect(indices.length / 3, wall.id).toBeLessThan(30_000);
    }
  });

  it("finds the plaster on its plane and the glazing deep in every window", () => {
    // Plain plaster between the dado and the ledge, beside the main door.
    const main = HALL_OPENINGS.find((opening) => opening.id === MODELLED_DOOR);
    expect(main).toBeDefined();
    if (main === undefined) return;
    expect(Math.abs(reliefDepthAt(wallMesh("door"), main.centre + 2.6, 3.0))).toBeLessThan(0.08);
    for (const opening of HALL_OPENINGS.filter(isWindow)) {
      const glass = reliefDepthAt(wallMesh("window"), opening.centre, (opening.sill + opening.head) / 2);
      expect(glass, opening.id).toBeLessThan(-0.45);
    }
  });

  it("sets the firebox back in the chimneypiece under its proud mantel shelf", () => {
    // The chimneypiece is centred 5.33 m along the fireplace wall.
    const fireplace = wallMesh("fireplace");
    expect(reliefDepthAt(fireplace, 5.33, 0.8)).toBeLessThan(-0.2);
    expect(reliefDepthAt(fireplace, 5.33, 1.65)).toBeGreaterThan(0.04);
  });

  it("leaves the main door's recess for its modelled leaves", () => {
    const main = HALL_OPENINGS.find((opening) => opening.id === MODELLED_DOOR);
    expect(main).toBeDefined();
    if (main === undefined) return;
    expect(reliefDepthAt(wallMesh("door"), main.centre, 1.2)).toBeCloseTo(-0.3, 2);
  });

  it("rejects a file that is not a relief, or is cut short, or points past its vertices", () => {
    expect(() => parseWallRelief(new ArrayBuffer(16))).toThrow(/not a relief/);
    const bytes = shippedReliefBytes();
    expect(() => parseWallRelief(bytes.slice(0, 200))).toThrow(/truncated/);
    // The first wall's first index, pushed past its vertex count.
    const view = new DataView(bytes);
    const vertexCount = view.getUint32(8 + 12, true);
    const indexBytes = view.getUint32(8 + 20, true);
    const indicesAt = (8 + 48 + vertexCount * 6 + 3) & ~3;
    if (indexBytes === 2) view.setUint16(indicesAt, vertexCount, true);
    else view.setUint32(indicesAt, vertexCount, true);
    expect(() => parseWallRelief(bytes)).toThrow(/index/);
  });

  it("rejects a range that is not a span of finite numbers, and a wall given twice", () => {
    const nan = shippedReliefBytes();
    new DataView(nan).setFloat32(8 + 24, Number.NaN, true);
    expect(() => parseWallRelief(nan)).toThrow(/range/);
    const flat = shippedReliefBytes();
    const view = new DataView(flat);
    view.setFloat32(8 + 28, view.getFloat32(8 + 24, true), true);
    expect(() => parseWallRelief(flat)).toThrow(/range/);
    // The second wall renamed as the first.
    const twice = shippedReliefBytes();
    const first = new Uint8Array(twice, 8, 12).slice();
    const vertexCount = new DataView(twice).getUint32(8 + 12, true);
    const triangleCount = new DataView(twice).getUint32(8 + 16, true);
    const indexBytes = new DataView(twice).getUint32(8 + 20, true);
    const afterVertices = (8 + 48 + vertexCount * 6 + 3) & ~3;
    const second = (afterVertices + triangleCount * 3 * indexBytes + 3) & ~3;
    new Uint8Array(twice, second, 12).set(first);
    expect(() => parseWallRelief(twice)).toThrow(/twice/);
  });
});

describe("Grand Hall geometry", () => {
  const room = buildHallGeometry();
  const walls = buildHallWallGeometry(shippedRelief());
  const parts = [...room.geometries, ...walls.geometries];

  it("builds every surface with finite positions and light", () => {
    for (const [key, geometry] of parts) {
      const position = geometry.getAttribute("position");
      const light = geometry.getAttribute("aLight");
      expect(position.count, key).toBeGreaterThan(0);
      expect(light.count, key).toBe(position.count);
      for (let i = 0; i < position.array.length; i++) expect(Number.isFinite(position.array[i]), key).toBe(true);
      for (let i = 0; i < light.array.length; i++) {
        const value = light.array[i] ?? Number.NaN;
        expect(Number.isFinite(value), key).toBe(true);
        expect(value, key).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("gives every photographed wall vertex a texel inside the atlas", () => {
    for (const key of ["wallPhoto", "wallPhotoGloss"] as const) {
      const geometry = walls.geometries.get(key);
      expect(geometry, key).toBeDefined();
      const atlas = geometry?.getAttribute("aAtlas");
      expect(atlas, key).toBeDefined();
      if (atlas === undefined) continue;
      for (let i = 0; i < atlas.count; i++) {
        expect(atlas.getX(i), key).toBeGreaterThanOrEqual(-1e-6);
        expect(atlas.getX(i), key).toBeLessThanOrEqual(1 + 1e-6);
        expect(atlas.getY(i), key).toBeGreaterThanOrEqual(-1e-6);
        expect(atlas.getY(i), key).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
  });

  it("puts the varnished dado and attic panelling in the glossy photograph", () => {
    expect(isPanelling(0.5)).toBe(true);
    expect(isPanelling(3.0)).toBe(false);
    expect(isPanelling(6.3)).toBe(true);
    const gloss = walls.geometries.get("wallPhotoGloss")?.getAttribute("position");
    const matte = walls.geometries.get("wallPhoto")?.getAttribute("position");
    expect(gloss?.count ?? 0).toBeGreaterThan(0);
    expect(matte?.count ?? 0).toBeGreaterThan(0);
  });

  it("stays inside the room's envelope (plus the window embrasures and the dome)", () => {
    for (const [key, geometry] of parts) {
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      expect(box, key).not.toBeNull();
      if (box === null) continue;
      // As scanned: the firebox runs 0.33 m back into the fireplace wall and
      // the window wall's embrasures up to 0.95 m.
      expect(box.min.x, key).toBeGreaterThanOrEqual(-HALL_HALF_LENGTH - 0.4);
      expect(box.max.x, key).toBeLessThanOrEqual(HALL_HALF_LENGTH + 0.4);
      expect(box.min.z, key).toBeGreaterThanOrEqual(-HALL_HALF_WIDTH - 1.0);
      expect(box.max.z, key).toBeLessThanOrEqual(HALL_HALF_WIDTH + 0.4);
      expect(box.min.y, key).toBeGreaterThanOrEqual(-0.01);
      expect(box.max.y, key).toBeLessThanOrEqual(HALL_DOME.crownHeight + 0.05);
    }
  });

  it("is light enough to draw every frame on a phone", () => {
    expect(room.stats.triangles + walls.stats.triangles).toBeLessThan(220_000);
    expect(room.stats.parts + walls.stats.parts).toBeLessThanOrEqual(16);
  });

  it("shows flat photographed walls until the relief arrives", () => {
    const flat = buildHallWallGeometry(null);
    const position = flat.geometries.get("wallPhoto")?.getAttribute("position");
    expect(position?.count ?? 0).toBeGreaterThan(0);
    expect(flat.stats.triangles).toBeLessThan(walls.stats.triangles);
  });

  it("maps the floor orthophoto with the door side at its top row", () => {
    expect(floorUv(-HALL_HALF_LENGTH, -HALL_HALF_WIDTH)).toEqual([0, 0]);
    expect(floorUv(HALL_HALF_LENGTH, HALL_HALF_WIDTH)).toEqual([1, 1]);
  });
});
