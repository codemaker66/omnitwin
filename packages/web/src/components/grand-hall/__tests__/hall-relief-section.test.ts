import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DataUtils, Texture, type BufferGeometry } from "three";
import { HALL_CUTS } from "../GrandHallModel.js";
import { buildHallWallGeometry } from "../hall-geometry.js";
import { buildHallDoorGeometry } from "../hall-doors.js";
import { parseWallRelief, type WallRelief, type WallReliefMesh } from "../hall-relief.js";
import {
  CAP_OVERLAP,
  HallSectionProfile,
  NO_SECTION,
  ReliefSlicer,
  SECTION_BIN,
  SECTION_PROFILE_SPANS,
  SECTION_PROFILE_WIDTH,
  buildSectionCap,
  profileDepthAt,
} from "../hall-relief-section.js";
import { CUT_SHADOW, GILT_BAND, GILT_MIN_PIXELS, LINE_MIN_PIXELS, cutShadow, giltHalfWidth, giltIntensity } from "../hall-cut-lines.js";
import { CAP_FALLOFF, CAP_GLOW_EDGE, CAP_GLOW_FAR, capGlowShare, createHallSection, SECTION_PRESETS } from "../hall-section.js";
import { createHallMaterials, HallGlazingUniforms, HallSectionUniforms } from "../hall-materials.js";
import { HallMoodUniforms } from "../hall-mood.js";
import { HallPhotos } from "../hall-photos.js";
import { WALL_BODY_TOP } from "../hall-wall-body.js";
import { HALL_OPENINGS, HALL_WALLS, isWindow, type HallOpening } from "../hall-spec.js";

let shipped: WallRelief | null = null;
function relief(): WallRelief {
  if (shipped === null) {
    const bytes = readFileSync(path.resolve("public/rooms/grand-hall/survey-2026-07-11/walls-relief.bin"));
    shipped = parseWallRelief(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  return shipped;
}

/** An opening's clear outline, stated again here (not through hall-walls.ts openingAt). */
function insideOutline(opening: HallOpening, u: number, v: number): boolean {
  const half = opening.width / 2;
  const across = u - opening.centre;
  if (Math.abs(across) > half || v < opening.sill) return false;
  const head = opening.kind === "arched-window" ? opening.head + Math.sqrt(half * half - across * across) : opening.head;
  return v <= head;
}

interface TaggedTriangle {
  readonly wall: number;
  readonly opening: number;
  /** Every vertex carries the same tag. */
  readonly uniform: boolean;
  readonly u: number;
  readonly v: number;
}

function taggedTriangles(geometry: BufferGeometry): TaggedTriangle[] {
  const position = geometry.getAttribute("position");
  const wallTag = geometry.getAttribute("aWall");
  const openingTag = geometry.getAttribute("aOpening");
  const index = geometry.getIndex();
  if (index === null) throw new Error("unindexed");
  const out: TaggedTriangle[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    const wallIndex = wallTag.getX(ids[0] ?? 0);
    const wall = HALL_WALLS[wallIndex];
    if (wall === undefined) continue;
    const tags = ids.map((i) => openingTag.getX(i));
    let u = 0;
    let v = 0;
    for (const i of ids) {
      u += ((position.getX(i) - wall.origin[0]) * wall.tangent[0] + (position.getZ(i) - wall.origin[2]) * wall.tangent[2]) / 3;
      v += position.getY(i) / 3;
    }
    out.push({ wall: wallIndex, opening: tags[0] ?? -1, uniform: tags.every((tag) => tag === tags[0]), u, v });
  }
  return out;
}

/** The relief's own depth at wall-local (u, v): the frontmost triangle over that point, or null. */
function reliefDepth(mesh: WallReliefMesh, u: number, v: number): number | null {
  const { positions: p, indices } = mesh;
  let best: number | null = null;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] ?? 0;
    const b = indices[t + 1] ?? 0;
    const c = indices[t + 2] ?? 0;
    const ua = p[a * 3] ?? 0; const va = p[a * 3 + 1] ?? 0; const da = p[a * 3 + 2] ?? 0;
    const ub = p[b * 3] ?? 0; const vb = p[b * 3 + 1] ?? 0; const db = p[b * 3 + 2] ?? 0;
    const uc = p[c * 3] ?? 0; const vc = p[c * 3 + 1] ?? 0; const dc = p[c * 3 + 2] ?? 0;
    if (Math.min(ua, ub, uc) > u || Math.max(ua, ub, uc) < u || Math.min(va, vb, vc) > v || Math.max(va, vb, vc) < v) continue;
    const det = (vb - vc) * (ua - uc) + (uc - ub) * (va - vc);
    if (Math.abs(det) < 1e-14) continue;
    const l1 = ((vb - vc) * (u - uc) + (uc - ub) * (v - vc)) / det;
    const l2 = ((vc - va) * (u - uc) + (ua - uc) * (v - vc)) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    const d = l1 * da + l2 * db + l3 * dc;
    best = best === null ? d : Math.max(best, d);
  }
  return best;
}

describe("the openings' tags on the scanned walls", () => {
  const walls = buildHallWallGeometry(relief());
  const triangles = (["wallPhoto", "wallPhotoGloss"] as const).flatMap((key) => {
    const geometry = walls.geometries.get(key);
    return geometry === undefined ? [] : taggedTriangles(geometry);
  });

  it("tags the relief in every window and door, and gives each triangle's vertices one tag", () => {
    expect(triangles.length).toBeGreaterThan(30000);
    expect(triangles.every((t) => t.uniform)).toBe(true);
    // A doorway's own relief gives way to its modelled leaves (hall-doors.ts), which carry its tag.
    const leaves = [...buildHallDoorGeometry().geometries.values()].flatMap((geometry) => taggedTriangles(geometry));
    HALL_OPENINGS.forEach((opening, index) => {
      const tagged = triangles.filter((t) => t.opening === index).length + leaves.filter((t) => t.opening === index).length;
      expect(tagged, opening.id).toBeGreaterThan(10);
    });
  });

  it("tags only triangles whose centroid lies in the opening's clear outline, and every one that does", () => {
    let mismatched = 0;
    for (const t of triangles) {
      const wall = HALL_WALLS[t.wall];
      const containing = HALL_OPENINGS.findIndex((opening) => opening.wall === wall?.id && insideOutline(opening, t.u, t.v));
      if (t.opening !== containing) mismatched += 1;
    }
    expect(mismatched).toBe(0);
  });
});

describe("the cut's lines", () => {
  const pixels = [1e-6, 1e-4, 0.001, 0.003, 0.005, 0.0053, 0.01, 0.03, 0.1, 0.5];

  it("never draws the gilt band under 0.75 px, nor under its 8 mm", () => {
    for (const pixel of pixels) {
      expect(giltHalfWidth(pixel) * 2).toBeGreaterThanOrEqual(GILT_BAND - 1e-12);
      expect(giltHalfWidth(pixel)).toBeGreaterThanOrEqual(LINE_MIN_PIXELS * pixel - 1e-12);
    }
  });

  it("draws the gilt line on the cut's edge at least twice the half-width's 0.75 px", () => {
    expect(GILT_MIN_PIXELS).toBe(2 * LINE_MIN_PIXELS);
    expect(giltHalfWidth(1) * 2).toBeCloseTo(GILT_MIN_PIXELS, 12);
  });

  it("carries the same light however far it is widened", () => {
    for (const pixel of pixels) {
      expect(giltIntensity(pixel)).toBeLessThanOrEqual(1);
      expect(giltHalfWidth(pixel) * 2 * giltIntensity(pixel)).toBeCloseTo(GILT_BAND, 12);
    }
    expect(giltIntensity(0.001)).toBe(1);
    expect(giltIntensity(0.1)).toBeCloseTo(0.004 / 0.075, 12);
  });

  it("darkens the room's face under the band softly, by 35% at most, over 4 cm", () => {
    expect(cutShadow(0)).toBeCloseTo(CUT_SHADOW.strength, 12);
    expect(cutShadow(-0.01)).toBeCloseTo(CUT_SHADOW.strength, 12);
    expect(cutShadow(CUT_SHADOW.reach / 2)).toBeCloseTo(CUT_SHADOW.strength / 4, 12);
    expect(cutShadow(CUT_SHADOW.reach)).toBe(0);
    expect(cutShadow(1)).toBe(0);
    let last = Infinity;
    for (let step = 0; step <= 50; step++) {
      const shadow = cutShadow(step / 1000);
      expect(shadow).toBeLessThanOrEqual(0.35);
      expect(shadow).toBeGreaterThanOrEqual(0);
      expect(shadow).toBeLessThanOrEqual(last);
      last = shadow;
    }
  });

  it("lights the cut most at its room edge, falling off over 0.4 m", () => {
    expect(capGlowShare(0)).toBeCloseTo(CAP_GLOW_FAR + CAP_GLOW_EDGE, 12);
    expect(capGlowShare(CAP_FALLOFF)).toBeCloseTo(CAP_GLOW_FAR + CAP_GLOW_EDGE / Math.E, 12);
    expect(capGlowShare(5)).toBeCloseTo(CAP_GLOW_FAR, 4);
    expect(capGlowShare(-1)).toBe(capGlowShare(0));
  });
});

describe("the relief's section", () => {
  const slicer = new ReliefSlicer(relief());
  const cutsAt = (height: number): number[] => HALL_WALLS.map(() => height);

  it("lays out one texel per centimetre of every wall in one row", () => {
    HALL_WALLS.forEach((wall, index) => {
      const span = SECTION_PROFILE_SPANS[index];
      expect(span?.bins).toBe(Math.ceil(wall.length / SECTION_BIN));
      const next = SECTION_PROFILE_SPANS[index + 1];
      if (span !== undefined && next !== undefined) expect(next.offset).toBeGreaterThan(span.offset + span.bins);
    });
    const last = SECTION_PROFILE_SPANS[SECTION_PROFILE_SPANS.length - 1];
    expect(SECTION_PROFILE_WIDTH).toBeGreaterThan((last?.offset ?? 0) + (last?.bins ?? 0));
    expect(SECTION_PROFILE_WIDTH).toBeLessThanOrEqual(8192);
  });

  it("follows the relief's surface at the near cut and in Plan, within 2 mm wherever the surface is smooth", () => {
    for (const height of [HALL_CUTS.near, HALL_CUTS.plan]) {
      HALL_WALLS.forEach((wall, index) => {
        const mesh = relief().get(wall.id);
        if (mesh === undefined) throw new Error(wall.id);
        const profile = slicer.slice(index, height, cutsAt(height));
        let compared = 0;
        let close = 0;
        for (let u = 0.1; u < wall.length - 0.1; u += 0.07) {
          const here = reliefDepth(mesh, u, height);
          const left = reliefDepth(mesh, u - 0.01, height);
          const right = reliefDepth(mesh, u + 0.01, height);
          if (here === null || left === null || right === null) continue;
          if (Math.abs(left - here) > 0.003 || Math.abs(right - here) > 0.003) continue;
          compared += 1;
          if (Math.abs(profileDepthAt(profile, u) - here) <= 0.002) close += 1;
        }
        expect(compared, `${wall.id} at ${String(height)}`).toBeGreaterThan(wall.length * 8);
        expect(close / compared, `${wall.id} at ${String(height)}`).toBeGreaterThanOrEqual(0.99);
      });
    }
  });

  it("reaches out to the moulding's outer edge where the relief steps (a pilaster's side, a board's edge)", () => {
    // At every bin, the profile is at least the relief's depth at the bin's centre.
    for (const height of [HALL_CUTS.near, HALL_CUTS.plan]) {
      HALL_WALLS.forEach((wall, index) => {
        const mesh = relief().get(wall.id);
        if (mesh === undefined) throw new Error(wall.id);
        const profile = slicer.slice(index, height, cutsAt(height));
        for (let i = 13; i < profile.length - 13; i += 29) {
          const depth = reliefDepth(mesh, (i + 0.5) * SECTION_BIN, height);
          if (depth === null) continue;
          expect(profile[i] ?? NO_SECTION).toBeGreaterThanOrEqual(depth - 1e-4);
        }
      });
    }
  });

  it("gives relief standing in a corner to its own wall's section only while the neighbour is cut no lower", () => {
    // The door wall's corners: the end wall meets its start, the fireplace wall its end.
    const door = 2;
    const length = HALL_WALLS[door]?.length ?? 0;
    let differs = 0;
    for (let tenths = 2; tenths <= 30; tenths++) {
      const height = tenths / 10;
      const cuts = [height, HALL_CUTS.none, height, HALL_CUTS.none];
      const lower = [height, 0.05, height, 0.05];
      const kept = slicer.slice(door, height, cuts);
      const given = slicer.slice(door, height, lower);
      for (let i = 0; i < kept.length; i++) {
        if ((kept[i] ?? 0) === (given[i] ?? 0)) continue;
        differs += 1;
        const u = (i + 0.5) * SECTION_BIN;
        expect(Math.min(u, length - u)).toBeLessThan(1.0);
        // Given away, it no longer reaches as far.
        expect(given[i] ?? 0).toBeLessThan(kept[i] ?? 0);
      }
    }
    expect(differs).toBeGreaterThan(0);
  });

  it("cuts all four walls in well under a frame's budget", () => {
    const started = performance.now();
    const rounds = 20;
    for (let r = 0; r < rounds; r++) for (let w = 0; w < 4; w++) slicer.slice(w, 1.9 + r * 0.01, cutsAt(2));
    expect((performance.now() - started) / rounds).toBeLessThan(8);
  });

  it("keeps the profiles for the current cuts in its texture, and cuts a wall again only when its cut moves", () => {
    const profile = new HallSectionProfile();
    const near = cutsAt(HALL_CUTS.near);
    expect(profile.update(near, WALL_BODY_TOP)).toBe(false);
    profile.setRelief(relief());
    expect(profile.update(near, WALL_BODY_TOP)).toBe(true);
    expect(profile.update(near, WALL_BODY_TOP)).toBe(false);
    expect(profile.update(near.map((c) => c + 0.0005), WALL_BODY_TOP)).toBe(false);
    expect(profile.update(near.map((c) => c + 0.002), WALL_BODY_TOP)).toBe(true);
    expect(profile.update(cutsAt(HALL_CUTS.none), WALL_BODY_TOP)).toBe(false);
    const data: unknown = profile.texture.image.data;
    if (!(data instanceof Uint16Array)) throw new Error("half floats expected");
    HALL_WALLS.forEach((_wall, index) => {
      const span = SECTION_PROFILE_SPANS[index];
      const values = profile.profile(index);
      if (span === undefined || values === undefined) throw new Error("layout");
      for (let i = 0; i < span.bins; i += 37) {
        expect(DataUtils.fromHalfFloat(data[span.offset + i] ?? 0)).toBeCloseTo(values[i] ?? 0, 3);
      }
    });
    expect(DataUtils.fromHalfFloat(data[0] ?? 0)).toBe(NO_SECTION);
    profile.dispose();
  });
});

describe("the section's cap", () => {
  const cap = buildSectionCap(relief());
  const position = cap.getAttribute("position");
  const tags = cap.getAttribute("aCap");
  const index = cap.getIndex();

  it("lies flat, faces up, and knows each vertex's wall, u and depth", () => {
    if (index === null) throw new Error("unindexed");
    for (let i = 0; i < position.count; i++) {
      expect(position.getY(i)).toBe(0);
      const wall = HALL_WALLS[tags.getX(i)];
      if (wall === undefined) throw new Error("wall");
      const u = tags.getY(i);
      const d = tags.getZ(i);
      expect(position.getX(i)).toBeCloseTo(wall.origin[0] + wall.tangent[0] * u + wall.normal[0] * d, 5);
      expect(position.getZ(i)).toBeCloseTo(wall.origin[2] + wall.tangent[2] * u + wall.normal[2] * d, 5);
      expect(d).toBeGreaterThanOrEqual(-CAP_OVERLAP - 1e-6);
    }
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t);
      const b = index.getX(t + 1);
      const c = index.getX(t + 2);
      const ab = [position.getX(b) - position.getX(a), position.getZ(b) - position.getZ(a)] as const;
      const ac = [position.getX(c) - position.getX(a), position.getZ(c) - position.getZ(a)] as const;
      // The y of (b - a) x (c - a): up.
      expect(ab[1] * ac[0] - ab[0] * ac[1]).toBeGreaterThan(0);
    }
  });

  it("reaches over every centimetre of the relief's section, at the near cut and in Plan", () => {
    if (index === null) throw new Error("unindexed");
    const slicer = new ReliefSlicer(relief());
    const spans: { u0: number; u1: number; d1: number }[][] = HALL_WALLS.map(() => []);
    for (let t = 0; t < index.count; t += 6) {
      const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2), index.getX(t + 4)];
      const us = ids.map((i) => tags.getY(i));
      const ds = ids.map((i) => tags.getZ(i));
      spans[tags.getX(ids[0] ?? 0)]?.push({ u0: Math.min(...us), u1: Math.max(...us), d1: Math.max(...ds) });
    }
    for (const height of [HALL_CUTS.near, HALL_CUTS.plan]) {
      HALL_WALLS.forEach((_wall, w) => {
        const profile = slicer.slice(w, height, HALL_WALLS.map(() => height));
        let uncovered = 0;
        for (let i = 0; i < profile.length; i++) {
          const proud = profile[i] ?? NO_SECTION;
          if (proud <= 0.002) continue;
          const u = (i + 0.5) * SECTION_BIN;
          if (!(spans[w]?.some((s) => u >= s.u0 - 1e-6 && u <= s.u1 + 1e-6 && s.d1 >= proud) ?? false)) uncovered += 1;
        }
        expect(uncovered, `wall ${String(w)} at ${String(height)}`).toBe(0);
      });
    }
  });

  it("is one light mesh", () => {
    expect((index?.count ?? 0) / 3).toBeLessThanOrEqual(1000);
  });
});

describe("the cut's materials", () => {
  it("build: the bodies, the relief's cap and the plinth, with and without the sun, and for a multisampled pass", () => {
    const section = new HallSectionUniforms();
    const mood = new HallMoodUniforms();
    for (const options of [{}, { sunlit: true }, { sunlit: true, multisampled: true, preset: SECTION_PRESETS.atelier }]) {
      const built = createHallSection(section, mood, options);
      expect(built.materials.cap.name).toBe("grand-hall-section-cap");
      expect(built.materials.body.name).toBe("grand-hall-wall-body");
      expect(built.profile.texture.image.width).toBe(SECTION_PROFILE_WIDTH);
      built.dispose();
    }
  });

  it("builds the walls' photographs with the cut's gilt band and shadow", () => {
    const materials = createHallMaterials({ mahoganyDark: new Texture() }, new HallPhotos(), new HallMoodUniforms(), new HallSectionUniforms(), null, { glazing: new HallGlazingUniforms() });
    expect(materials.get("wallPhoto")?.name).toBe("grand-hall-wallPhoto");
    expect(materials.get("wallPhotoGloss")?.name).toBe("grand-hall-wallPhotoGloss");
    for (const material of materials.values()) material.dispose();
  });

  it("leaves open every window, all in the window wall", () => {
    expect(HALL_OPENINGS.filter((opening) => isWindow(opening)).map((opening) => opening.wall)).toEqual(["window", "window", "window", "window", "window"]);
  });
});
