import { describe, expect, it } from "vitest";
import type { BufferGeometry } from "three";
import { HallBuilders } from "../hall-builders.js";
import {
  GLASS_PRESETS,
  WINDOW_WALL_INDEX,
  buildGlazingBars,
  buildGlazingPanes,
  buildGlazingReveals,
  glazingOutline,
  parseGlassPreset,
  revealOuterDepth,
  schlick,
  sheetReflectance,
  withGlazingClosed,
} from "../hall-glazing.js";
import {
  HALL_GLAZING,
  HALL_GLAZING_SECTION,
  HALL_HALF_LENGTH,
  HALL_HALF_WIDTH,
  HALL_LIGHT_HALF_WIDTH,
  HALL_OPENINGS,
  HALL_WALL_THICKNESS,
  isWindow,
  openingHeadAt,
  type HallGlazing,
} from "../hall-spec.js";

type Vec3 = readonly [number, number, number];

interface Triangle {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly c: Vec3;
  readonly normal: Vec3;
  readonly uv: readonly [number, number];
}

function trianglesOf(geometry: BufferGeometry): Triangle[] {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.hasAttribute("uv") ? geometry.getAttribute("uv") : null;
  const index = geometry.getIndex();
  const at = (i: number): Vec3 => [position.getX(i), position.getY(i), position.getZ(i)];
  const count = index === null ? position.count : index.count;
  const vertex = (k: number): number => (index === null ? k : index.getX(k));
  const out: Triangle[] = [];
  for (let k = 0; k < count; k += 3) {
    const [i, j, l] = [vertex(k), vertex(k + 1), vertex(k + 2)];
    out.push({
      a: at(i), b: at(j), c: at(l),
      normal: [normal.getX(i), normal.getY(i), normal.getZ(i)],
      uv: uv === null ? [0, 0] : [uv.getX(i), uv.getY(i)],
    });
  }
  return out;
}

const cross = (u: Vec3, v: Vec3): Vec3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const sub = (u: Vec3, v: Vec3): Vec3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
const dot = (u: Vec3, v: Vec3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
/** Window-wall local coordinates of a world point: u along the wall, v up, depth into the room. */
const local = (p: Vec3): Vec3 => [p[0] + HALL_HALF_LENGTH, p[1], p[2] + HALL_HALF_WIDTH];

function paintOf(build: (hb: HallBuilders) => void): BufferGeometry {
  const hb = new HallBuilders();
  build(hb);
  const paint = hb.build().geometries.get("paint");
  if (paint === undefined) throw new Error("nothing painted");
  return paint;
}

/** The glazing a wall-local u belongs to (within its opening's width). */
function glazingAt(u: number): HallGlazing | undefined {
  return HALL_GLAZING.find((glazing) => {
    const opening = HALL_OPENINGS.find((candidate) => candidate.id === glazing.opening);
    return opening !== undefined && Math.abs(u - opening.centre) <= opening.width / 2 + 1e-6;
  });
}

/** Whether (u, v) lies within a window's glazed outline (its light, or over an arch's transom its fanlight), within `slack`. */
function insideGlazing(glazing: HallGlazing, u: number, v: number, slack: number): boolean {
  if (v < glazing.sill - slack) return false;
  const du = u - glazing.centre;
  if (v <= glazing.top + slack && Math.abs(du) <= HALL_LIGHT_HALF_WIDTH + slack) return true;
  return glazing.fanlight !== null && Math.hypot(du, v - glazing.top) <= glazing.fanlight.radius + slack;
}

/** Whether a triangle covers wall-local (u, v) in the wall's plane. */
function covers(t: Triangle, u: number, v: number): boolean {
  const [a, b, c] = [local(t.a), local(t.b), local(t.c)];
  const s = (p: Vec3, q: Vec3): number => (q[0] - p[0]) * (v - p[1]) - (q[1] - p[1]) * (u - p[0]);
  const d1 = s(a, b);
  const d2 = s(b, c);
  const d3 = s(c, a);
  return (d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9) || (d1 <= 1e-9 && d2 <= 1e-9 && d3 <= 1e-9);
}

describe("the windows' measured glazing (hall-spec)", () => {
  it("glazes every window once, and nothing else", () => {
    const windows = HALL_OPENINGS.filter(isWindow).map((opening) => opening.id).sort();
    expect(HALL_GLAZING.map((glazing) => glazing.opening).sort()).toEqual(windows);
  });

  it("gives every wall a positive, sourced thickness", () => {
    for (const [id, wall] of Object.entries(HALL_WALL_THICKNESS)) {
      expect(wall.thickness, id).toBeGreaterThan(0.3);
      expect(wall.thickness, id).toBeLessThan(1.5);
      expect(wall.source.length, id).toBeGreaterThan(10);
    }
  });

  it("puts each window's outer face beyond its glass, and its glass inside the wall", () => {
    for (const glazing of HALL_GLAZING) {
      expect(glazing.glassDepth, glazing.opening).toBeLessThan(0);
      expect(glazing.outerDepth, glazing.opening).toBeLessThan(glazing.glassDepth);
      expect(revealOuterDepth(glazing), glazing.opening).toBeLessThan(glazing.glassDepth);
      expect(revealOuterDepth(glazing), glazing.opening).toBeGreaterThanOrEqual(-HALL_WALL_THICKNESS.window.thickness);
      expect(glazing.source.length).toBeGreaterThan(20);
    }
  });

  it("keeps every light, bar and fanlight inside its opening", () => {
    for (const glazing of HALL_GLAZING) {
      const opening = HALL_OPENINGS.find((candidate) => candidate.id === glazing.opening);
      expect(opening).toBeDefined();
      if (opening === undefined) continue;
      expect(glazing.sill).toBeGreaterThanOrEqual(opening.sill - 0.01);
      for (const point of glazingOutline(glazing)) {
        const head = openingHeadAt(opening, point[0]);
        expect(head, `${glazing.opening} at u ${point[0].toFixed(3)}`).not.toBeNull();
        expect(point[1]).toBeLessThanOrEqual((head ?? 0) + 1e-6);
      }
      for (const u of glazing.verticals) expect(Math.abs(u - glazing.centre)).toBeLessThan(HALL_LIGHT_HALF_WIDTH);
      for (const v of [...glazing.bars, glazing.rail]) {
        expect(v).toBeGreaterThan(glazing.sill);
        expect(v).toBeLessThan(glazing.top);
      }
    }
  });
});

describe("the windows' panes", () => {
  const panes = buildGlazingPanes();
  const triangles = trianglesOf(panes);

  it("stand at each window's glass, facing the room, inside its glazed outline", () => {
    expect(triangles.length).toBeGreaterThan(0);
    for (const t of triangles) {
      expect(dot(cross(sub(t.b, t.a), sub(t.c, t.a)), [0, 0, 1])).toBeGreaterThan(0);
      for (const p of [t.a, t.b, t.c]) {
        const [u, v, depth] = local(p);
        const glazing = glazingAt(u);
        expect(glazing, `pane vertex at u ${u.toFixed(3)}`).toBeDefined();
        if (glazing === undefined) continue;
        expect(depth).toBeCloseTo(glazing.glassDepth, 5);
        expect(insideGlazing(glazing, u, v, 1e-4)).toBe(true);
        // And inside the opening itself (an arch's round head included).
        const opening = HALL_OPENINGS.find((candidate) => candidate.id === glazing.opening);
        const head = opening === undefined ? null : openingHeadAt(opening, u);
        expect(head, `pane vertex at u ${u.toFixed(3)}`).not.toBeNull();
        expect(v).toBeLessThanOrEqual((head ?? 0) + 1e-6);
        expect(v).toBeGreaterThanOrEqual((opening?.sill ?? 0) - 1e-6);
      }
    }
  });

  it("cover every window, and cost little", () => {
    expect(triangles.length).toBeLessThanOrEqual(200);
    for (const glazing of HALL_GLAZING) {
      const mid = (glazing.sill + glazing.top) / 2;
      expect(triangles.some((t) => covers(t, glazing.centre, mid)), glazing.opening).toBe(true);
    }
    expect(panes.getAttribute("aAtlas").count).toBe(panes.getAttribute("position").count);
  });
});

describe("the windows' glazing bars", () => {
  const bars = paintOf(buildGlazingBars);
  const triangles = trianglesOf(bars);

  it("stand in front of each window's glass, inside its glazed outline", () => {
    const deepest = Math.max(...Object.values(HALL_GLAZING_SECTION).map((section) => section.depth));
    for (const t of triangles) {
      for (const p of [t.a, t.b, t.c]) {
        const [u, v, depth] = local(p);
        const glazing = glazingAt(u);
        expect(glazing, `bar vertex at u ${u.toFixed(3)}`).toBeDefined();
        if (glazing === undefined) continue;
        expect(depth).toBeGreaterThanOrEqual(glazing.glassDepth - 1e-5);
        expect(depth).toBeLessThanOrEqual(glazing.glassDepth + deepest + 1e-5);
        // The stiles stand a centimetre over the light's edge, onto the atlas's glass.
        expect(insideGlazing(glazing, u, v, 0.0105), `${glazing.opening} (${u.toFixed(3)}, ${v.toFixed(3)})`).toBe(true);
      }
    }
  });

  it("wind every face along its normal, with nothing facing away from the room", () => {
    for (const t of triangles) {
      expect(dot(cross(sub(t.b, t.a), sub(t.c, t.a)), t.normal)).toBeGreaterThan(0);
      expect(t.normal[2]).toBeGreaterThan(-1e-6);
    }
  });

  it("put every measured bar where it was measured", () => {
    const fronts = triangles.filter((t) => t.normal[2] > 0.999);
    const covered = (u: number, v: number): boolean => fronts.some((t) => covers(t, u, v));
    for (const glazing of HALL_GLAZING) {
      const rows = [glazing.sill, ...glazing.bars, glazing.rail, glazing.top].sort((p, q) => p - q);
      // Each vertical bar, in every pane's height between two horizontals.
      for (const u of glazing.verticals) {
        for (let i = 0; i + 1 < rows.length; i++) {
          const v = ((rows[i] ?? 0) + (rows[i + 1] ?? 0)) / 2;
          expect(covered(u, v), `${glazing.opening} vertical at ${u.toFixed(3)}, v ${v.toFixed(3)}`).toBe(true);
        }
      }
      // Each horizontal bar and the meeting rail, in each of the three panes' widths.
      const columns = [glazing.centre - HALL_LIGHT_HALF_WIDTH + 0.12, glazing.centre, glazing.centre + HALL_LIGHT_HALF_WIDTH - 0.12];
      for (const v of [...glazing.bars, glazing.rail]) {
        for (const u of columns) expect(covered(u, v), `${glazing.opening} horizontal at v ${v.toFixed(3)}, u ${u.toFixed(3)}`).toBe(true);
      }
      // And not across a pane between them.
      expect(covered(glazing.centre, glazing.rail - 0.2), `${glazing.opening} pane`).toBe(false);
      const fan = glazing.fanlight;
      if (fan === null) continue;
      // The round head's crown and the pierced ring's rims over the centre.
      expect(covered(glazing.centre, glazing.top + fan.roundHead)).toBe(true);
      expect(covered(glazing.centre + 0.02, glazing.top + fan.ringInner)).toBe(true);
      expect(covered(glazing.centre + 0.02, glazing.top + fan.ringOuter)).toBe(true);
      // A piercing is open.
      const hole = ((fan.holes.first + fan.holes.step * 8) * Math.PI) / 180;
      const middle = (fan.ringInner + fan.ringOuter) / 2;
      expect(covered(glazing.centre + middle * Math.cos(hole), glazing.top + middle * Math.sin(hole))).toBe(false);
    }
  });

  it("stay within their budget", () => {
    expect(triangles.length).toBeLessThanOrEqual(2500);
  });

  it("belong to the window wall, for its cut", () => {
    const wall = bars.getAttribute("aWall");
    for (let i = 0; i < wall.count; i++) expect(wall.getX(i)).toBe(WINDOW_WALL_INDEX);
  });
});

describe("the windows' outer reveals", () => {
  const reveals = paintOf(buildGlazingReveals);
  const triangles = trianglesOf(reveals);

  it("run from each window's glass exactly to its outer face, and never past the wall's skin", () => {
    for (const glazing of HALL_GLAZING) {
      const own = triangles.filter((t) => glazingAt(local(t.a)[0]) === glazing);
      expect(own.length, glazing.opening).toBeGreaterThan(0);
      const depths = own.flatMap((t) => [t.a, t.b, t.c].map((p) => local(p)[2]));
      expect(Math.max(...depths)).toBeCloseTo(glazing.glassDepth, 6);
      expect(Math.min(...depths)).toBeCloseTo(revealOuterDepth(glazing), 6);
    }
    for (const t of triangles) {
      for (const p of [t.a, t.b, t.c]) expect(local(p)[2]).toBeGreaterThanOrEqual(-HALL_WALL_THICKNESS.window.thickness - 1e-6);
    }
  });

  it("face into the opening, outside the glass, painted beside it and stone beyond", () => {
    for (const t of triangles) {
      expect(dot(cross(sub(t.b, t.a), sub(t.c, t.a)), t.normal)).toBeGreaterThan(0);
      expect(t.uv[0]).toBe(1);
      expect(Math.abs(t.normal[2])).toBeLessThan(1e-6);
    }
    expect(triangles.some((t) => t.uv[1] === 1)).toBe(true);
    expect(triangles.some((t) => t.uv[1] === 0)).toBe(true);
    expect(triangles.length).toBeLessThanOrEqual(1500);
  });
});

describe("the glass", () => {
  it("reads its preset from the address, falling back to the physical one", () => {
    expect(parseGlassPreset("?glass=clear")).toBe("clear");
    expect(parseGlassPreset("?sky=1&glass=lustre")).toBe("lustre");
    expect(parseGlassPreset("?glass=mirror")).toBe("physical");
    expect(parseGlassPreset("")).toBe("physical");
    expect(parseGlassPreset(null)).toBe("physical");
  });

  it("reflects as single glazing does", () => {
    for (const preset of Object.values(GLASS_PRESETS)) {
      expect(preset.f0).toBeGreaterThan(0);
      expect(preset.f0).toBeLessThanOrEqual(0.2);
    }
    // Two faces of glass at 4% each: 7.7% at normal incidence, all at grazing.
    expect(sheetReflectance(schlick(GLASS_PRESETS.physical.f0, 1))).toBeCloseTo(0.0769, 4);
    expect(sheetReflectance(schlick(GLASS_PRESETS.physical.f0, 0))).toBeCloseTo(1, 6);
    expect(GLASS_PRESETS.clear.reflectance).toBeLessThan(GLASS_PRESETS.physical.reflectance);
    expect(GLASS_PRESETS.lustre.reflectance).toBeGreaterThan(GLASS_PRESETS.physical.reflectance);
  });

  it("closes while the room's reflections are captured, and reopens after", () => {
    const glazing = { open: { value: 1 } };
    const panes = { visible: true };
    const seen = withGlazingClosed(glazing, panes, () => [glazing.open.value, panes.visible] as const);
    expect(seen).toEqual([0, false]);
    expect(glazing.open.value).toBe(1);
    expect(panes.visible).toBe(true);
  });

  it("reopens when the capture throws", () => {
    const glazing = { open: { value: 1 } };
    const panes = { visible: true };
    expect(() => withGlazingClosed(glazing, panes, () => { throw new Error("capture failed"); })).toThrow("capture failed");
    expect(glazing.open.value).toBe(1);
    expect(panes.visible).toBe(true);
  });

  it("keeps a closed window closed, and works without panes", () => {
    const glazing = { open: { value: 0 } };
    expect(withGlazingClosed(glazing, null, () => glazing.open.value)).toBe(0);
    expect(glazing.open.value).toBe(0);
  });
});
