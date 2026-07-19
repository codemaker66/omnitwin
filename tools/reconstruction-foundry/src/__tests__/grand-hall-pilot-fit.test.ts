import { describe, expect, it } from "vitest";

import {
  cameraCentreFromPose,
  extractE57ScanTranslations,
  parseColmapCamerasBin,
  parseColmapImagesBin,
  readE57LogicalBytes,
} from "../grand-hall-pilot-inspection.js";
import {
  fitSimilarityHorn,
  buildPilotFitReport,
  PILOT_HELD_OUT_SWEEPS,
} from "../grand-hall-pilot-fit.js";

function colmapCamerasFixture(): Uint8Array {
  // One PINHOLE camera (model_id 1, 4 params).
  const buffer = new ArrayBuffer(8 + 4 + 4 + 8 + 8 + 4 * 8);
  const view = new DataView(buffer);
  view.setBigUint64(0, 1n, true);
  view.setInt32(8, 7, true);
  view.setInt32(12, 1, true);
  view.setBigUint64(16, 1024n, true);
  view.setBigUint64(24, 1024n, true);
  for (const [index, value] of [512.5, 512.5, 512, 512].entries()) {
    view.setFloat64(32 + index * 8, value, true);
  }
  return new Uint8Array(buffer);
}

function colmapImagesFixture(): Uint8Array {
  // One registered image, identity rotation, tvec (1,2,3), name "scan_000_front.jpg", zero 2D points.
  const name = "scan_000_front.jpg";
  const buffer = new ArrayBuffer(8 + 4 + 8 * 7 + 4 + name.length + 1 + 8);
  const view = new DataView(buffer);
  let offset = 0;
  view.setBigUint64(offset, 1n, true);
  offset += 8;
  view.setInt32(offset, 42, true);
  offset += 4;
  for (const value of [1, 0, 0, 0, 1, 2, 3]) {
    view.setFloat64(offset, value, true);
    offset += 8;
  }
  view.setInt32(offset, 7, true);
  offset += 4;
  for (const char of name) {
    view.setUint8(offset, char.charCodeAt(0));
    offset += 1;
  }
  view.setUint8(offset, 0);
  offset += 1;
  view.setBigUint64(offset, 0n, true);
  return new Uint8Array(buffer);
}

function e57PagedFixture(xml: string): Uint8Array {
  // Physical layout: 1024-byte pages, last 4 bytes of each page are CRC
  // (ignored by the logical reader); XML begins at physical offset 48.
  const xmlBytes = new TextEncoder().encode(xml);
  const pages = new Uint8Array(2048);
  let logical = 0;
  let physical = 48;
  while (logical < xmlBytes.length) {
    if (physical % 1024 >= 1020) {
      physical = (Math.floor(physical / 1024) + 1) * 1024;
    }
    pages[physical] = xmlBytes[logical] ?? 0;
    physical += 1;
    logical += 1;
  }
  return pages;
}

describe("deterministic COLMAP metadata inspection", () => {
  it("parses cameras.bin and images.bin exactly", () => {
    const cameras = parseColmapCamerasBin(colmapCamerasFixture());
    expect(cameras).toEqual([
      { cameraId: 7, modelId: 1, width: 1024, height: 1024, params: [512.5, 512.5, 512, 512] },
    ]);
    const images = parseColmapImagesBin(colmapImagesFixture());
    expect(images).toHaveLength(1);
    expect(images[0]?.name).toBe("scan_000_front.jpg");
    expect(images[0]?.tvec).toEqual([1, 2, 3]);
  });

  it("computes the camera centre as -R^T t", () => {
    // Identity rotation: centre = -t.
    expect(cameraCentreFromPose([1, 0, 0, 0], [1, 2, 3])).toEqual([-1, -2, -3]);
    // 180-degree rotation about z (q = [0,0,0,1]): centre = -R^T t = [1,2,-3].
    const centre = cameraCentreFromPose([0, 0, 0, 1], [1, 2, 3]);
    expect(centre[0]).toBeCloseTo(1, 12);
    expect(centre[1]).toBeCloseTo(2, 12);
    expect(centre[2]).toBeCloseTo(-3, 12);
  });
});

describe("deterministic E57 metadata inspection", () => {
  it("strips CRC pages when reading logical bytes and extracts scan translations", () => {
    const xml =
      "<e57Root><data3D><vectorChild><pose><translation>" +
      '<x type="Float">1.5</x><y type="Float">-2.25</y><z type="Float">0.75</z>' +
      "</translation></pose></vectorChild></data3D></e57Root>";
    const physical = e57PagedFixture(xml);
    const logical = readE57LogicalBytes(physical, 48, xml.length);
    expect(new TextDecoder().decode(logical)).toBe(xml);
    const translations = extractE57ScanTranslations(new TextDecoder().decode(logical));
    expect(translations).toEqual([{ index: 0, x: 1.5, y: -2.25, z: 0.75 }]);
  });
});

describe("similarity fit with held-out sweep centres", () => {
  it("recovers a known similarity transform exactly", () => {
    const source: [number, number, number][] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 1],
      [2, 0.5, -1],
    ];
    // target = s * R(90deg about z) * source + t, s=1.7362602881, t=(10,-5,2).
    const s = 1.7362602881;
    const target = source.map(([x, y, z]): [number, number, number] => [
      s * -y + 10,
      s * x - 5,
      s * z + 2,
    ]);
    const fit = fitSimilarityHorn(source, target);
    expect(fit.scale).toBeCloseTo(s, 9);
    for (const [index, point] of source.entries()) {
      const mapped = fit.apply(point);
      expect(mapped[0]).toBeCloseTo(target[index]?.[0] ?? Number.NaN, 9);
      expect(mapped[1]).toBeCloseTo(target[index]?.[1] ?? Number.NaN, 9);
      expect(mapped[2]).toBeCloseTo(target[index]?.[2] ?? Number.NaN, 9);
    }
  });

  it("holds out one complete sweep centre per decade and reports both residual sets", () => {
    expect(PILOT_HELD_OUT_SWEEPS).toEqual([5, 15, 25, 35, 45]);
    const correspondences = Array.from({ length: 50 }, (_, index) => ({
      sweepIndex: index,
      source: [index, index * 2, index * 3] as [number, number, number],
      target: [index * 2 + 1, index * 4 + 1, index * 6 + 1] as [number, number, number],
    }));
    const report = buildPilotFitReport(correspondences);
    expect(report.fitSet.count).toBe(45);
    expect(report.heldOutSet.count).toBe(5);
    expect(report.heldOutSet.sweepIndices).toEqual([5, 15, 25, 35, 45]);
    // The synthetic relation is an exact similarity (scale 2, translation 1),
    // so all residual statistics collapse to ~0 in both sets.
    expect(report.fitSet.residuals.maxMeters).toBeLessThan(1e-9);
    expect(report.heldOutSet.residuals.maxMeters).toBeLessThan(1e-9);
    expect(report.sfmLeakDocumented).toContain("jointly");
  });
});
