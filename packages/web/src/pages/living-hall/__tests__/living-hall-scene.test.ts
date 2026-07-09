import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { buildDollyCurves, extendShortGaze, sampleDolly } from "../LivingHallScene.js";
import {
  MIN_GAZE_DISTANCE_M,
  RECEPTION_DOLLY_STATIONS,
  RECEPTION_TILE_MANIFEST,
  receptionTileUrls,
} from "../reception-dolly-path.js";

// ---------------------------------------------------------------------------
// The dolly is authored data + pure curve math; both are testable without a
// canvas. The stations are real capture viewpoints — sanity here guards
// against a bad re-bake (NaNs, teleports, gazes shorter than comfort).
// ---------------------------------------------------------------------------

describe("reception dolly stations", () => {
  it("has enough stations for a curve and all-finite coordinates", () => {
    expect(RECEPTION_DOLLY_STATIONS.length).toBeGreaterThanOrEqual(4);
    for (const s of RECEPTION_DOLLY_STATIONS) {
      for (const n of [...s.position, ...s.look]) {
        expect(Number.isFinite(n)).toBe(true);
      }
    }
  });

  it("stays at capture height — the camera never leaves the walkable band", () => {
    for (const s of RECEPTION_DOLLY_STATIONS) {
      expect(Math.abs(s.position[1])).toBeLessThan(1);
    }
  });

  it("never teleports — consecutive stations are within a stride of the room", () => {
    for (let i = 1; i < RECEPTION_DOLLY_STATIONS.length; i++) {
      const a = new Vector3(...(RECEPTION_DOLLY_STATIONS[i - 1]?.position ?? [0, 0, 0]));
      const b = new Vector3(...(RECEPTION_DOLLY_STATIONS[i]?.position ?? [0, 0, 0]));
      expect(a.distanceTo(b)).toBeLessThan(15); // room diagonal ~17m
    }
  });
});

describe("extendShortGaze", () => {
  it("leaves comfortable gazes untouched", () => {
    const pos = new Vector3(0, 0, 0);
    const look = new Vector3(0, 0, 5);
    expect(extendShortGaze(pos, look).equals(look)).toBe(true);
  });

  it("extends a nose-to-the-wall gaze along its own direction", () => {
    const pos = new Vector3(1, 0, 1);
    const look = new Vector3(1, 0, 1.5); // 0.5m — too close
    const extended = extendShortGaze(pos, look);
    expect(extended.distanceTo(pos)).toBeCloseTo(MIN_GAZE_DISTANCE_M, 5);
    // direction preserved: still straight down +z from pos
    expect(extended.x).toBeCloseTo(1, 5);
    expect(extended.z).toBeGreaterThan(1.5);
  });

  it("survives a degenerate zero-length gaze", () => {
    const pos = new Vector3(2, 0, 2);
    const extended = extendShortGaze(pos, pos.clone());
    expect(extended.distanceTo(pos)).toBeGreaterThanOrEqual(MIN_GAZE_DISTANCE_M - 1e-6);
  });
});

describe("buildDollyCurves", () => {
  it("interpolates through the authored endpoints", () => {
    const { positions } = buildDollyCurves(RECEPTION_DOLLY_STATIONS);
    const first = RECEPTION_DOLLY_STATIONS[0];
    const last = RECEPTION_DOLLY_STATIONS[RECEPTION_DOLLY_STATIONS.length - 1];
    expect(positions.getPoint(0).distanceTo(new Vector3(...(first?.position ?? [0, 0, 0])))).toBeLessThan(1e-6);
    expect(positions.getPoint(1).distanceTo(new Vector3(...(last?.position ?? [0, 0, 0])))).toBeLessThan(1e-6);
  });

  it("keeps every guarded gaze at comfortable distance along the whole curve", () => {
    // Raw curves may converge between stations (they interpolate
    // independently); sampleDolly applies the per-frame guard the rig uses.
    const curves = buildDollyCurves(RECEPTION_DOLLY_STATIONS);
    const out = { pos: new Vector3(), look: new Vector3() };
    for (let t = 0; t <= 1.0001; t += 0.02) {
      sampleDolly(curves, Math.min(1, t), out);
      const gap = out.pos.distanceTo(out.look);
      expect(gap, `gaze collapsed at t=${t.toFixed(2)}`).toBeGreaterThanOrEqual(
        MIN_GAZE_DISTANCE_M - 1e-6,
      );
    }
  });
});

describe("tile manifest", () => {
  it("urls derive from the manifest, one per tile", () => {
    const urls = receptionTileUrls();
    expect(urls.length).toBe(RECEPTION_TILE_MANIFEST.length);
    for (const url of urls) {
      expect(url.startsWith("/splats/reception/")).toBe(true);
      expect(url.endsWith(".sog")).toBe(true);
    }
  });
});
