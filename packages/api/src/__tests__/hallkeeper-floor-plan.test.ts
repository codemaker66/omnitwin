import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import PDFDocument from "pdfkit";
import type { HallkeeperFloorPlan } from "@omnitwin/types";
import { buildHallkeeperFloorPlan, footprintCorners, projectHallkeeperFloorPlan } from "../services/hallkeeper-floor-plan.js";
import { renderHallkeeperFloorPlan } from "../services/hallkeeper-floor-plan-pdf.js";
import { extractEventSheet } from "../services/event-sheet-extractor.js";

const objectId = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";
const object: HallkeeperFloorPlan["objects"][number] = {
  objectId, assetDefinitionId: assetId, name: "Measured rectangle", category: "table", x: 2, z: 1,
  rotationY: Math.PI / 2, widthM: 2, depthM: 1, scale: 1, collisionType: "box",
};
const plan: HallkeeperFloorPlan = {
  coordinateSpace: "real_m_v1", outline: [{ x: -10, z: -5 }, { x: 10, z: -5 }, { x: 10, z: 5 }, { x: -10, z: 5 }], objects: [object],
};

describe("frozen floor plan", () => {
  it("takes outline, catalogue dimensions and all actual object poses from source rows", () => {
    const result = buildHallkeeperFloorPlan(plan.outline.map((point) => ({ x: point.x, y: point.z })), [{
      id: objectId, assetDefinitionId: assetId, positionX: "2.000", positionZ: "1.000", rotationY: "1.57080", scale: "1.500",
    }], new Map([[assetId, { id: assetId, name: "Measured rectangle", category: "table", widthM: "2.000", depthM: "1.000", collisionType: "box" }]]));
    expect(result.outline).toEqual(plan.outline);
    expect(result.objects).toEqual([{ ...object, rotationY: 1.5708, scale: 1.5 }]);
  });
  it("preserves Three.js yaw handedness and actual footprint size", () => {
    const corners = footprintCorners(object);
    const expected = [{ x: 1.5, z: 2 }, { x: 1.5, z: 0 }, { x: 2.5, z: 0 }, { x: 2.5, z: 2 }];
    for (const [index, point] of corners.entries()) {
      expect(point.x).toBeCloseTo(expected[index]?.x ?? Infinity, 12);
      expect(point.z).toBeCloseTo(expected[index]?.z ?? Infinity, 12);
    }
  });
  it("uses one uniform scale without clipping an object outside a non-rectangular room", () => {
    const result = projectHallkeeperFloorPlan({ ...plan, outline: plan.outline.slice(0, 3), objects: [{ ...object, x: 30 }] }, { x: 10, y: 20, width: 400, height: 200 });
    const points = [...result.outline, ...result.objects.flatMap((item) => item.corners)];
    expect(result.outline).toHaveLength(3);
    expect(points.every((point) => point.x >= 10 && point.x <= 410 && point.y >= 20 && point.y <= 220)).toBe(true);
    expect((result.objects[0]?.width ?? 0) / (result.objects[0]?.depth ?? 0)).toBe(2);
  });
  it("changes snapshot hash for outline, footprint, scale or grouped-chair pose changes", () => {
    const hash = (floorPlan: HallkeeperFloorPlan) => extractEventSheet({ placements: [], accessoryMap: new Map(), metadata: null, room: { widthM: 20, lengthM: 10 }, floorPlan }).sourceHash;
    const baseline = hash(plan);
    for (const changed of [
      { ...plan, outline: plan.outline.map((point, index) => index === 0 ? { ...point, x: -9 } : point) },
      { ...plan, objects: [{ ...object, widthM: 3 }] },
      { ...plan, objects: [{ ...object, scale: 2 }] },
      { ...plan, objects: [{ ...object, category: "chair", x: 3 }] },
    ]) expect(hash(changed)).not.toBe(baseline);
  });
  it.each([false, true])("writes actual vector paths and a bounded scale bar; sub-metre room=%s", async (smallRoom) => {
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      doc.on("end", () => { resolve(Buffer.concat(chunks)); });
      doc.on("error", reject);
    });
    const renderedPlan = smallRoom ? { ...plan, objects: [], outline: plan.outline.map((point) => ({ x: point.x / 200, z: point.z / 100 })) } : plan;
    renderHallkeeperFloorPlan(doc, renderedPlan, { x: 20, y: 30, width: 400, height: 260 });
    doc.end();
    const pdf = await done;
    const streams = [...pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/gu)]
      .map((match) => inflateSync(Buffer.from(match[1] ?? "", "latin1")).toString("latin1")).join("\n");
    if (smallRoom) {
      // 2080 points/metre. A 0.02m bar uses 41.6pt, inside its 90pt allocation.
      expect(streams).toContain("366.4 279 m\n408 279 l");
    } else {
      // Independently calculated: 18.4 points/metre, origin (220,158), +Z down.
      expect(streams).toContain("36 66 m\n404 66 l\n404 250 l\n36 250 l\nh");
      expect(streams).toContain("247.6 194.8 m\n247.6 158 l\n266 158 l\n266 194.8 l\nh");
      expect(streams).toContain("371.2 279 m\n408 279 l"); // real two-metre scale bar
    }
  });
});
