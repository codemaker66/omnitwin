// ---------------------------------------------------------------------------
// The sun's and moon's casters let light onto the floor only through the
// windows.
//
// A CPU stand-in for the hall's shadow map, on the floor: every caster the
// room mounts (hallSunCasterParts, as GrandHallModel draws them on the
// caster layer) is projected along the light onto the floor's plane and
// rasterised, the walls' relief letting the light through where the shipped
// wall atlas marks glass, as createHallCasterMaterials does. Every floor
// point the light then reaches must look out through a window: its ray
// toward the light leaves the room through a window's opening in the window
// wall (the relief's footprint there, hall-wall-body.ts). Anything else is a
// slit in the casters. On 22 October the moon drew thin bright lines across
// the floor and the tables through three of them: the relief's top behind
// the ceiling's edge, the walls' relief ends missing each other in the
// corners, and the ceiling's corners cut off by its ring's chords.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import decodeWebp, { init } from "@jsquash/webp/decode.js";
import { buildHallGeometry, buildHallWallGeometry } from "../hall-geometry.js";
import { parseWallRelief } from "../hall-relief.js";
import { drawnRelief } from "../hall-walls.js";
import { buildHallDoorGeometry } from "../hall-doors.js";
import { bodyOpenings, buildWallBody, insideHole } from "../hall-wall-body.js";
import { hallSunCasterParts, type SunCasterPart } from "../hall-sun.js";
import { hallSkyAt } from "../hall-sky.js";
import { hallDirection } from "../hall-site.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_HEIGHT, HALL_WALLS, hallWall, isWindow } from "../hall-spec.js";

type V3 = readonly [number, number, number];

/** The caster's cut: the atlas marks glass 128/255 and everything else 255 (createHallCasterMaterials). */
const GLASS_BELOW = 0.75;
/** HallSunLight's rule: the sun lights the room while it is above this strength, else the moon. */
const SUN_UP = 0.0005;
/** The relief's vertices this low lie on the floor: its bottom row (underRelief). */
const FLOOR_ROW = 0.005;

interface Atlas {
  readonly rgba: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

interface Grid {
  readonly cell: number;
  readonly nx: number;
  readonly nz: number;
}

function grid(cell: number): Grid {
  return { cell, nx: Math.round((2 * HALL_HALF_LENGTH) / cell), nz: Math.round((2 * HALL_HALF_WIDTH) / cell) };
}

/** The atlas's alpha at (u, v), bilinear; v = 0 is its bottom row (the photographs load flipped). */
function atlasAlpha(atlas: Atlas, u: number, v: number): number {
  const px = Math.min(Math.max(u * atlas.width - 0.5, 0), atlas.width - 1.001);
  const py = Math.min(Math.max((1 - v) * atlas.height - 0.5, 0), atlas.height - 1.001);
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const at = (x: number, y: number): number => (atlas.rgba[(y * atlas.width + x) * 4 + 3] ?? 255) / 255;
  return at(ix, iy) * (1 - fx) * (1 - fy) + at(ix + 1, iy) * fx * (1 - fy) + at(ix, iy + 1) * (1 - fx) * fy + at(ix + 1, iy + 1) * fx * fy;
}

/** Floor cells (row z, column x) the light from `toward` reaches past every caster: 1 where lit. */
function floorLight(parts: readonly SunCasterPart[], toward: V3, atlas: Atlas, g: Grid): Uint8Array {
  const length = Math.hypot(toward[0], toward[1], toward[2]);
  const [lx, ly, lz] = [toward[0] / length, toward[1] / length, toward[2] / length];
  const blocked = new Uint8Array(g.nx * g.nz);
  const gx = [0, 0, 0];
  const gz = [0, 0, 0];
  const us = [0, 0, 0];
  const vs = [0, 0, 0];
  for (const part of parts) {
    const position = part.geometry.getAttribute("position");
    const atlasUv = part.glazed ? part.geometry.getAttribute("aAtlas") : null;
    const index = part.geometry.getIndex();
    const count = index === null ? position.count : index.count;
    for (let t = 0; t + 2 < count; t += 3) {
      let above = false;
      for (let k = 0; k < 3; k++) {
        const vertex = index === null ? t + k : index.getX(t + k);
        const x = position.getX(vertex);
        const y = position.getY(vertex);
        const z = position.getZ(vertex);
        if (y > 1e-6) above = true;
        // Along the light onto the floor's plane, in cells.
        gx[k] = (x - (y / ly) * lx + HALL_HALF_LENGTH) / g.cell - 0.5;
        gz[k] = (z - (y / ly) * lz + HALL_HALF_WIDTH) / g.cell - 0.5;
        if (atlasUv !== null) {
          us[k] = atlasUv.getX(vertex);
          vs[k] = atlasUv.getY(vertex);
        }
      }
      // A face lying on the floor shades none of it.
      if (!above) continue;
      const [x0, x1, x2] = gx as [number, number, number];
      const [z0, z1, z2] = gz as [number, number, number];
      const area = (x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0);
      // Edge-on to the light: the map draws nothing for it.
      if (Math.abs(area) < 1e-12) continue;
      const c0 = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const c1 = Math.min(g.nx - 1, Math.ceil(Math.max(x0, x1, x2)));
      const r0 = Math.max(0, Math.floor(Math.min(z0, z1, z2)));
      const r1 = Math.min(g.nz - 1, Math.ceil(Math.max(z0, z1, z2)));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const w0 = ((x1 - c) * (z2 - r) - (x2 - c) * (z1 - r)) / area;
          const w1 = ((x2 - c) * (z0 - r) - (x0 - c) * (z2 - r)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
          const cellIndex = r * g.nx + c;
          if (blocked[cellIndex] === 1) continue;
          if (atlasUv !== null) {
            const u = w0 * (us[0] ?? 0) + w1 * (us[1] ?? 0) + w2 * (us[2] ?? 0);
            const v = w0 * (vs[0] ?? 0) + w1 * (vs[1] ?? 0) + w2 * (vs[2] ?? 0);
            if (atlasAlpha(atlas, u, v) <= GLASS_BELOW) continue;
          }
          blocked[cellIndex] = 1;
        }
      }
    }
  }
  return blocked.map((value) => 1 - value);
}

/** The windows' openings at the window wall's plane: where the relief goes back into each bay. */
const WINDOW_HOLES = bodyOpenings(hallWall("window")).filter((entry) => isWindow(entry.opening)).map((entry) => ({ id: entry.opening.id, hole: entry.footprint }));

/**
 * For each floor cell, the window (index in WINDOW_HOLES) its ray toward the
 * light leaves the room by, or -1: through the ceiling, another wall or the
 * window wall's piers.
 */
function windowSeen(toward: V3, g: Grid): Int8Array {
  const length = Math.hypot(toward[0], toward[1], toward[2]);
  const [lx, ly, lz] = [toward[0] / length, toward[1] / length, toward[2] / length];
  const out = new Int8Array(g.nx * g.nz).fill(-1);
  if (lz >= 0) return out;
  for (let r = 0; r < g.nz; r++) {
    for (let c = 0; c < g.nx; c++) {
      const x = -HALL_HALF_LENGTH + (c + 0.5) * g.cell;
      const z = -HALL_HALF_WIDTH + (r + 0.5) * g.cell;
      const tWall = (-HALL_HALF_WIDTH - z) / lz;
      const tCeiling = HALL_HEIGHT / ly;
      const tEnd = Math.abs(lx) < 1e-12 ? Infinity : ((lx > 0 ? HALL_HALF_LENGTH : -HALL_HALF_LENGTH) - x) / lx;
      if (tWall > tCeiling || tWall > tEnd) continue;
      const u = x + tWall * lx + HALL_HALF_LENGTH;
      const height = tWall * ly;
      out[r * g.nx + c] = WINDOW_HOLES.findIndex(({ hole }) => insideHole(hole, u, height));
    }
  }
  return out;
}

/**
 * Floor no one sees: inside the walls' relief, behind the line its scanned
 * surface stands along on the floor (the skirting, the window seats, the
 * cases, the hearth). The floor there is inside the solid the relief's
 * surface stands for, and light through the relief's own glazing reaches it
 * from behind; a cell's width of slack takes the grid's aliasing.
 */
function underRelief(parts: readonly SunCasterPart[], g: Grid): Uint8Array {
  // Each wall's floor line: (u along it, depth into the room) at its bottom row, by u.
  const lines = HALL_WALLS.map((): [number, number][] => []);
  for (const part of parts.filter((entry) => entry.glazed)) {
    const position = part.geometry.getAttribute("position");
    const wallOf = part.geometry.getAttribute("aWall");
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) > FLOOR_ROW) continue;
      const index = Math.round(wallOf.getX(i));
      const wall = HALL_WALLS[index];
      if (wall === undefined) continue;
      const dx = position.getX(i) - wall.origin[0];
      const dz = position.getZ(i) - wall.origin[2];
      lines[index]?.push([dx * wall.tangent[0] + dz * wall.tangent[2], dx * wall.normal[0] + dz * wall.normal[2]]);
    }
  }
  const depthAt = (line: readonly [number, number][], u: number): number => {
    let lo = 0;
    let hi = line.length - 1;
    const first = line[0];
    const last = line[hi];
    if (first === undefined || last === undefined) return 0;
    if (u <= first[0]) return first[1];
    if (u >= last[0]) return last[1];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((line[mid]?.[0] ?? 0) <= u) lo = mid; else hi = mid;
    }
    const a = line[lo] ?? first;
    const b = line[hi] ?? last;
    return b[0] - a[0] < 1e-9 ? Math.max(a[1], b[1]) : a[1] + ((u - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  };
  const covered = new Uint8Array(g.nx * g.nz);
  HALL_WALLS.forEach((wall, index) => {
    const line = (lines[index] ?? []).sort((p, q) => p[0] - q[0]);
    for (let r = 0; r < g.nz; r++) {
      for (let c = 0; c < g.nx; c++) {
        const dx = -HALL_HALF_LENGTH + (c + 0.5) * g.cell - wall.origin[0];
        const dz = -HALL_HALF_WIDTH + (r + 0.5) * g.cell - wall.origin[2];
        const u = dx * wall.tangent[0] + dz * wall.tangent[2];
        const depth = dx * wall.normal[0] + dz * wall.normal[2];
        if (u >= 0 && u <= wall.length && depth < depthAt(line, u) + g.cell) covered[r * g.nx + c] = 1;
      }
    }
  });
  return covered;
}

/** Lit floor, square metres, that no window explains; a cell beside one that does is allowed (the grid's own aliasing). */
function unexplainedLight(lit: Uint8Array, seen: Int8Array, covered: Uint8Array, g: Grid): number {
  let cells = 0;
  for (let r = 0; r < g.nz; r++) {
    for (let c = 0; c < g.nx; c++) {
      if (lit[r * g.nx + c] !== 1 || covered[r * g.nx + c] === 1) continue;
      let explained = false;
      for (let dr = -1; dr <= 1 && !explained; dr++) {
        for (let dc = -1; dc <= 1 && !explained; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < g.nz && cc >= 0 && cc < g.nx && (seen[rr * g.nx + cc] ?? -1) >= 0) explained = true;
        }
      }
      if (!explained) cells += 1;
    }
  }
  return cells * g.cell * g.cell;
}

function bodyLight(iso: string): { readonly body: "sun" | "moon"; readonly direction: V3 } {
  const sky = hallSkyAt(Date.parse(iso));
  return sky.sun.strength > SUN_UP ? { body: "sun", direction: sky.sun.direction } : { body: "moon", direction: sky.moon.direction };
}

let parts: SunCasterPart[] = [];
const coveredByGrid = new Map<number, Uint8Array>();
/** underRelief for the grid, once. */
function covered(g: Grid): Uint8Array {
  let mask = coveredByGrid.get(g.cell);
  if (mask === undefined) {
    mask = underRelief(parts, g);
    coveredByGrid.set(g.cell, mask);
  }
  return mask;
}
let atlas: Atlas = { rgba: new Uint8ClampedArray(4), width: 1, height: 1 };

beforeAll(async () => {
  // libwebp's binding only uses ImageData as a typed RGBA container; no canvas.
  vi.stubGlobal("ImageData", class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} });
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(path.resolve(path.dirname(require.resolve("@jsquash/webp/decode.js")), "codec/dec/webp_dec.wasm"));
  await init(await WebAssembly.compile(new Uint8Array(wasm).buffer));
  const survey = path.resolve("public/rooms/grand-hall/survey-2026-07-11");
  const image = await decodeWebp(new Uint8Array(readFileSync(path.join(survey, "walls-4096.webp"))).buffer);
  atlas = { rgba: image.data, width: image.width, height: image.height };
  const relief = drawnRelief(parseWallRelief(new Uint8Array(readFileSync(path.join(survey, "walls-relief.bin"))).buffer));
  parts = hallSunCasterParts({
    room: buildHallGeometry().geometries,
    walls: buildHallWallGeometry(relief).geometries,
    doors: buildHallDoorGeometry().geometries,
    body: buildWallBody().geometry,
  });
}, 60_000);

describe("the hall's sun and moon casters", () => {
  // Blake's walk-through: the moon nearly full, 23 and 26 October 2026 in the
  // evening (British Summer Time ends on the 25th), and the sun at noon, when
  // a dashed line crossed the floor at x ≈ -4.3 m on 19 October.
  const moments = [
    "2026-10-23T20:30:00+01:00", "2026-10-23T21:30:00+01:00", "2026-10-23T22:30:00+01:00",
    "2026-10-26T20:30:00+00:00", "2026-10-26T21:30:00+00:00", "2026-10-26T22:30:00+00:00",
    "2026-10-19T12:30:00+01:00", "2026-10-26T12:30:00+00:00",
  ];
  const fine = grid(0.01);

  it.each(moments)("lets the light of %s onto the floor only through the windows", (iso) => {
    const { body, direction } = bodyLight(iso);
    expect(direction[1], `${body} below the horizon`).toBeGreaterThan(0);
    const lit = floorLight(parts, direction, atlas, fine);
    expect(unexplainedLight(lit, windowSeen(direction, fine), covered(fine), fine)).toBe(0);
  }, 60_000);

  it("lets no light through anywhere else from any side of the sky", () => {
    const coarse = grid(0.02);
    const leaks: string[] = [];
    for (const altitude of [12, 30, 55]) {
      for (let bearing = 0; bearing < 360; bearing += 30) {
        const direction = hallDirection(bearing, altitude, [0, 0, 0]);
        const area = unexplainedLight(floorLight(parts, direction, atlas, coarse), windowSeen(direction, coarse), covered(coarse), coarse);
        if (area > 0) leaks.push(`${String(bearing)}° at ${String(altitude)}°: ${area.toFixed(4)} m²`);
      }
    }
    expect(leaks).toEqual([]);
  }, 120_000);

  it("still lets the full moon in through every window on the night of 26 October", () => {
    const { body, direction } = bodyLight("2026-10-26T20:30:00+00:00");
    expect(body).toBe("moon");
    const lit = floorLight(parts, direction, atlas, fine);
    const seen = windowSeen(direction, fine);
    const byWindow = WINDOW_HOLES.map(() => 0);
    lit.forEach((value, cell) => {
      const window = seen[cell] ?? -1;
      if (value === 1 && window >= 0) byWindow[window] = (byWindow[window] ?? 0) + fine.cell * fine.cell;
    });
    for (const [index, { id }] of WINDOW_HOLES.entries()) expect(byWindow[index], id).toBeGreaterThan(0.5);
  }, 60_000);

  it("closes the ceiling to the room's corners", () => {
    const ceiling = buildHallGeometry().geometries.get("ceilingPhoto");
    expect(ceiling).toBeDefined();
    if (ceiling === undefined) return;
    const position = ceiling.getAttribute("position");
    const index = ceiling.getIndex();
    const count = index === null ? position.count : index.count;
    const covers = (px: number, pz: number): boolean => {
      for (let t = 0; t + 2 < count; t += 3) {
        const p = [0, 1, 2].map((k) => {
          const vertex = index === null ? t + k : index.getX(t + k);
          return [position.getX(vertex), position.getZ(vertex)] as const;
        });
        const [a, b, c] = p as [readonly [number, number], readonly [number, number], readonly [number, number]];
        const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
        if (Math.abs(area) < 1e-12) continue;
        const w0 = ((b[0] - px) * (c[1] - pz) - (c[0] - px) * (b[1] - pz)) / area;
        const w1 = ((c[0] - px) * (a[1] - pz) - (a[0] - px) * (c[1] - pz)) / area;
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) return true;
      }
      return false;
    };
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) {
      expect(covers(sx * (HALL_HALF_LENGTH - 0.01), sz * (HALL_HALF_WIDTH - 0.01)), `corner ${String(sx)}, ${String(sz)}`).toBe(true);
    }
  });
});
