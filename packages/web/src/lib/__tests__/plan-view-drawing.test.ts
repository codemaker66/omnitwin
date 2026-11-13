import { describe, expect, it } from "vitest";
import type { PlanViewFootprint } from "@omnitwin/types";
import {
  PLAN_VIEW_WIDTH,
  describePlanItems,
  drawPlanView,
  formatInVenueClock,
} from "../plan-view-drawing.js";

// The view-only page's drawing (fix-first item 11): one uniform scale for the
// room and its furniture, the room's own proportions, and a true scale bar.

const HALL = [{ x: -10, z: -5 }, { x: 10, z: -5 }, { x: 10, z: 5 }, { x: -10, z: 5 }];
const chair = (x: number, z: number, rotationY = 0): PlanViewFootprint => ({
  name: "Velvet Banquet Chair", category: "chair", x, z, rotationY, scale: 1,
  widthM: 0.42, depthM: 0.58, collisionType: "box",
});

describe("drawPlanView", () => {
  it("keeps the room's proportions and draws furniture at the room's own scale", () => {
    const drawing = drawPlanView({ outline: HALL, objects: [chair(0, 0)] });
    if (drawing === null) throw new Error("expected a drawing");
    const xs = drawing.outline.map((point) => point.x);
    const ys = drawing.outline.map((point) => point.y);
    const roomWidth = Math.max(...xs) - Math.min(...xs);
    const roomDepth = Math.max(...ys) - Math.min(...ys);
    expect(roomWidth / roomDepth).toBeCloseTo(2, 6);
    expect(drawing.width).toBe(PLAN_VIEW_WIDTH);
    const pointsPerMetre = roomWidth / 20;
    const [first, second, third] = drawing.footprints[0]?.corners ?? [];
    expect(Math.hypot((second?.x ?? 0) - (first?.x ?? 0), (second?.y ?? 0) - (first?.y ?? 0))).toBeCloseTo(0.42 * pointsPerMetre, 6);
    expect(Math.hypot((third?.x ?? 0) - (second?.x ?? 0), (third?.y ?? 0) - (second?.y ?? 0))).toBeCloseTo(0.58 * pointsPerMetre, 6);
    // The centre of the hall is the centre of the drawing's width.
    expect(drawing.footprints[0]?.center.x).toBeCloseTo(PLAN_VIEW_WIDTH / 2, 6);
    expect(drawing.scaleBar.length).toBeCloseTo(drawing.scaleBar.metres * pointsPerMetre, 6);
    expect(drawing.scaleBar.length).toBeLessThanOrEqual(PLAN_VIEW_WIDTH / 3);
  });

  it("keeps an item placed outside the room, rather than clipping or moving it", () => {
    const drawing = drawPlanView({ outline: HALL, objects: [chair(14, 0)] });
    const corner = Math.max(...(drawing?.footprints[0]?.corners ?? []).map((point) => point.x));
    expect(corner).toBeLessThanOrEqual(PLAN_VIEW_WIDTH);
    expect(Math.max(...(drawing?.outline ?? []).map((point) => point.x))).toBeLessThan(corner);
  });

  it("holds a very deep room within a screen's height", () => {
    const deep = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 60 }, { x: 0, z: 60 }];
    const drawing = drawPlanView({ outline: deep, objects: [] });
    expect(drawing?.height).toBeLessThan(PLAN_VIEW_WIDTH * 1.6);
  });

  it("turns furniture the way the planner and the PDF do", () => {
    const turned = drawPlanView({ outline: HALL, objects: [chair(0, 0, Math.PI / 2)] });
    const corners = turned?.footprints[0]?.corners ?? [];
    const width = Math.max(...corners.map((p) => p.x)) - Math.min(...corners.map((p) => p.x));
    const depth = Math.max(...corners.map((p) => p.y)) - Math.min(...corners.map((p) => p.y));
    // A quarter turn puts the chair's depth across the page.
    expect(width).toBeGreaterThan(depth);
    expect(turned?.footprints[0]?.rotationDeg).toBeCloseTo(-90, 6);
  });

  it("draws nothing from an outline with no area", () => {
    expect(drawPlanView({ outline: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }], objects: [] })).toBeNull();
  });
});

describe("describePlanItems", () => {
  it("names what is placed in plain words", () => {
    expect(describePlanItems([
      { name: "Round Table (White Cloth)", category: "table", count: 8 },
      { name: "Velvet Banquet Chair", category: "chair", count: 60 },
      { name: "Banquet Chair", category: "chair", count: 4 },
      { name: "Lectern", category: "lectern", count: 1 },
    ])).toBe("8 tables, 64 chairs and 1 lectern");
    expect(describePlanItems([])).toBe("nothing placed yet");
  });
});

describe("formatInVenueClock", () => {
  it("states the time in the venue's clock, and says UTC when the zone is unknown", () => {
    expect(formatInVenueClock("2026-10-17T13:02:00.000Z", "Europe/London")).toBe("17 October 2026, 14:02");
    expect(formatInVenueClock("2026-10-17T13:02:00.000Z", "Not/AZone")).toBe("17 October 2026, 13:02 UTC");
  });
});
