import { describe, expect, it } from "vitest";
import type { FloorPlanPoint } from "@omnitwin/types";
import {
  buildProposalLayoutSnapshot,
  type SnapshotAssetDims,
  type SnapshotPlacedObject,
} from "../services/proposal-layout-snapshot.js";

// A 20m × 10m room whose origin is offset (minX=5, minZ=2) so the relative-
// coordinate projection is exercised, not just the easy 0-origin case.
const OFFSET_ROOM: readonly FloorPlanPoint[] = [
  { x: 5, y: 2 },
  { x: 25, y: 2 },
  { x: 25, y: 12 },
  { x: 5, y: 12 },
];

const ROUND_TABLE = "asset-round";
const TRESTLE = "asset-trestle";
const CHAIR = "asset-chair";
const STAGE = "asset-stage";

const ASSETS = new Map<string, SnapshotAssetDims>([
  [ROUND_TABLE, { widthM: 1.8, depthM: 1.8, category: "table", name: "6ft Round Table" }],
  [TRESTLE, { widthM: 1.83, depthM: 0.76, category: "table", name: "6ft Trestle" }],
  [CHAIR, { widthM: 0.45, depthM: 0.45, category: "chair", name: "Banquet Chair" }],
  [STAGE, { widthM: 2, depthM: 1, category: "stage", name: "Stage Deck" }],
]);

function placed(overrides: Partial<SnapshotPlacedObject> & { assetDefinitionId: string }): SnapshotPlacedObject {
  return { positionX: 7, positionZ: 4, rotationY: 0, scale: 1, ...overrides };
}

describe("buildProposalLayoutSnapshot", () => {
  it("returns null for a degenerate outline", () => {
    expect(buildProposalLayoutSnapshot([{ x: 0, y: 0 }, { x: 1, y: 1 }], [], ASSETS)).toBeNull();
  });

  it("returns null when there are no renderable items", () => {
    expect(buildProposalLayoutSnapshot(OFFSET_ROOM, [], ASSETS)).toBeNull();
    expect(
      buildProposalLayoutSnapshot(OFFSET_ROOM, [placed({ assetDefinitionId: "unknown" })], ASSETS),
    ).toBeNull();
  });

  it("derives room dimensions from the outline bounding box", () => {
    const snapshot = buildProposalLayoutSnapshot(OFFSET_ROOM, [placed({ assetDefinitionId: ROUND_TABLE })], ASSETS);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.roomWidthM).toBe(20);
    expect(snapshot?.roomLengthM).toBe(10);
  });

  it("projects positions relative to the room origin", () => {
    const snapshot = buildProposalLayoutSnapshot(
      OFFSET_ROOM,
      [placed({ assetDefinitionId: ROUND_TABLE, positionX: 7, positionZ: 4 })],
      ASSETS,
    );
    const item = snapshot?.items[0];
    expect(item?.xM).toBeCloseTo(2); // 7 - minX(5)
    expect(item?.zM).toBeCloseTo(2); // 4 - minZ(2)
  });

  it("infers round tables as circles and everything else as rectangles", () => {
    const snapshot = buildProposalLayoutSnapshot(
      OFFSET_ROOM,
      [
        placed({ assetDefinitionId: ROUND_TABLE }),
        placed({ assetDefinitionId: TRESTLE }),
        placed({ assetDefinitionId: CHAIR }),
        placed({ assetDefinitionId: STAGE }),
      ],
      ASSETS,
    );
    expect(snapshot?.items.map((i) => [i.kind, i.shape])).toEqual([
      ["table", "round"],
      ["table", "rect"],
      ["chair", "rect"],
      ["stage", "rect"],
    ]);
  });

  it("applies the placed-object scale to the footprint and converts rotation to degrees", () => {
    const snapshot = buildProposalLayoutSnapshot(
      OFFSET_ROOM,
      [placed({ assetDefinitionId: ROUND_TABLE, scale: 2, rotationY: Math.PI })],
      ASSETS,
    );
    const item = snapshot?.items[0];
    expect(item?.widthM).toBeCloseTo(3.6); // 1.8 × 2
    expect(item?.depthM).toBeCloseTo(3.6);
    expect(item?.rotationDeg).toBeCloseTo(180);
  });

  it("clamps out-of-bounds positions into the room and treats non-positive scale as 1", () => {
    const snapshot = buildProposalLayoutSnapshot(
      OFFSET_ROOM,
      [placed({ assetDefinitionId: CHAIR, positionX: 100, positionZ: -100, scale: 0 })],
      ASSETS,
    );
    const item = snapshot?.items[0];
    expect(item?.xM).toBe(20); // clamped to roomWidthM
    expect(item?.zM).toBe(0); // clamped from negative
    expect(item?.widthM).toBeCloseTo(0.45); // scale 0 → 1
  });

  it("produces a schema-valid snapshot with origin-relative non-negative coords", () => {
    const snapshot = buildProposalLayoutSnapshot(
      OFFSET_ROOM,
      [placed({ assetDefinitionId: ROUND_TABLE }), placed({ assetDefinitionId: CHAIR })],
      ASSETS,
    );
    expect(snapshot).not.toBeNull();
    for (const item of snapshot?.items ?? []) {
      expect(item.xM).toBeGreaterThanOrEqual(0);
      expect(item.zM).toBeGreaterThanOrEqual(0);
      expect(item.xM).toBeLessThanOrEqual(snapshot?.roomWidthM ?? 0);
      expect(item.zM).toBeLessThanOrEqual(snapshot?.roomLengthM ?? 0);
    }
  });
});
