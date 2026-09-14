import { describe, expect, it } from "vitest";
import { annotationSafeArea, placeSceneAnnotations, rectanglesOverlap, type AnnotationMeasure, type AnnotationRect } from "../cockpit-scene-annotation-layout.js";
const area = { x: 280, y: 82, width: 816, height: 710 };
const markers: readonly AnnotationMeasure[] = [
  { id: "heritage", priority: 2, x: 670, y: 638, width: 244, height: 92 },
  ...["c", "b", "a", "d"].map((id) => ({ id, priority: id === "a" ? 0 : 1, x: 670, y: 638, width: 244, height: 60 })),
];
function assertContained(rects: readonly AnnotationRect[], bounds: AnnotationRect): void {
  for (const r of rects) {
    expect(r.x).toBeGreaterThanOrEqual(bounds.x); expect(r.y).toBeGreaterThanOrEqual(bounds.y);
    expect(r.x + r.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(r.y + r.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  }
}
describe("scene annotation placement", () => {
  it("separates the coincident standing-view labels and long heritage disclosure without dropping any", () => {
    const result = placeSceneAnnotations(markers, area);
    expect(result.mode).toBe("packed"); expect(result.placements).toHaveLength(5);
    assertContained(result.placements, area);
    result.placements.forEach((a, i) => { result.placements.slice(i + 1).forEach((b) => { expect(rectanglesOverlap(a, b)).toBe(false); }); });
  });
  it("does not depend on incoming artifact order", () => {
    expect(placeSceneAnnotations(markers, area)).toEqual(placeSceneAnnotations([...markers].reverse(), area));
    expect(placeSceneAnnotations(markers, area).placements.map((p) => p.id)).toEqual(["a", "b", "c", "d", "heritage"]);
  });
  it("clamps off-screen anchors while retaining every record", () => {
    const result = placeSceneAnnotations(markers.map((m, i) => ({ ...m, x: i % 2 ? -900 : 3000, y: i % 2 ? -100 : 2000 })), area);
    assertContained(result.placements, area); expect(result.placements).toHaveLength(5);
  });
  it("uses an explicitly scrollable list when full-size targets cannot fit", () => {
    const result = placeSceneAnnotations(markers, { x: 20, y: 60, width: 180, height: 140 });
    expect(result.mode).toBe("list"); expect(result.placements).toHaveLength(5);
    expect(result.contentHeight).toBeGreaterThan(140);
    expect(result.placements.every((p) => p.width === 180 && p.height >= 44)).toBe(true);
  });
  it.each([1366, 960])("finds actual free canvas at viewport width %i", (width) => {
    const left = width === 1366 ? 272 : 217; const right = width === 1366 ? 1104 : 741;
    const obstacles = [{ x: 12, y: 14, width: left - 12, height: 880 }, { x: right, y: 14, width: width - right - 14, height: 808 }, { x: 12, y: 912, width: width - 26, height: 74 }, { x: width / 2 - 185, y: 800, width: 370, height: 46 }];
    const free = annotationSafeArea({ x: 0, y: 0, width, height: 1000 }, obstacles);
    expect(free).not.toBeNull(); if (free === null) throw new Error("No area");
    expect(free.width).toBeGreaterThan(300); assertContained([free], { x: 0, y: 0, width, height: 1000 });
    obstacles.forEach((b) => { expect(rectanglesOverlap(free, b)).toBe(false); });
  });
  it("does not claim free space when an open panel covers the canvas", () => {
    expect(annotationSafeArea({ x: 0, y: 0, width: 400, height: 300 }, [{ x: 0, y: 0, width: 400, height: 300 }])).toBeNull();
  });
  it("handles an empty visible annotation set", () => {
    expect(placeSceneAnnotations([], area)).toEqual({ mode: "packed", placements: [], contentHeight: 0 });
  });
  it("retains a long expanded warning and every other record in a short phone list", () => {
    const records = markers.map((marker, index) => ({ ...marker, height: index === 0 ? 420 : 60 }));
    const result = placeSceneAnnotations(records, { x: 12, y: 110, width: 366, height: 96 });
    expect(result.mode).toBe("list");
    expect(new Set(result.placements.map((p) => p.id))).toEqual(new Set(markers.map((p) => p.id)));
    result.placements.forEach((a, i) => { result.placements.slice(i + 1).forEach((b) => { expect(rectanglesOverlap(a, b)).toBe(false); }); });
    expect(Math.max(...result.placements.map((p) => p.y + p.height))).toBe(result.contentHeight);
  });
  it("ignores obstacles wholly outside the viewport and accounts for moved controls", () => {
    const viewport = { x: 0, y: 0, width: 390, height: 844 };
    const top = { x: 0, y: 0, width: 390, height: 120 };
    const bottom = { x: 0, y: 690, width: 390, height: 154 };
    const offscreen = { x: -800, y: 20, width: 250, height: 700 };
    const first = annotationSafeArea(viewport, [top, bottom, offscreen]);
    expect(first).not.toBeNull();
    if (first === null) throw new Error("No free phone area");
    assertContained([first], viewport);
    expect(rectanglesOverlap(first, top)).toBe(false);
    expect(rectanglesOverlap(first, bottom)).toBe(false);
    const moved = annotationSafeArea(viewport, [top, { ...bottom, y: 480, height: 364 }]);
    expect(moved?.height).toBeLessThan(first.height);
  });

});
