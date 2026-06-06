import { describe, expect, it, beforeEach } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { createPlacedItem, resetPlacedIdCounter } from "../placement.js";
import { computeFluidFurnitureDragFrame } from "../furniture-drag.js";
import { SNAP_GUIDE_THRESHOLD } from "../snap-guide.js";

const tableId = "round-table-6ft";
const chairId = "banquet-chair";

beforeEach(() => {
  resetPlacedIdCounter();
});

describe("computeFluidFurnitureDragFrame", () => {
  it("follows the pointer and grab offset exactly while still returning visual alignment guides", () => {
    const primary = createPlacedItem(tableId, 3, -2);
    const alignedChair = createPlacedItem(chairId, 0, 6);
    const nearAlignmentX = SNAP_GUIDE_THRESHOLD * 0.5;
    const grabOffset = { x: 0.4, z: -0.2 };

    const frame = computeFluidFurnitureDragFrame(
      primary,
      { x: nearAlignmentX + grabOffset.x, z: grabOffset.z },
      grabOffset,
      [primary, alignedChair],
      new Set([primary.id]),
    );

    expect(frame.targetX).toBeCloseTo(nearAlignmentX);
    expect(frame.targetZ).toBeCloseTo(0);
    expect(frame.dx).toBeCloseTo(nearAlignmentX - primary.x);
    expect(frame.dz).toBeCloseTo(0 - primary.z);
    expect(frame.guides.some((guide) => guide.kind === "center")).toBe(true);
  });

  it("does not magnetically clamp active table drags to the room wall", () => {
    const primary = createPlacedItem(tableId, 0, 0);
    const halfRoomWidth = GRAND_HALL_RENDER_DIMENSIONS.width / 2;
    const rawTargetX = halfRoomWidth - 0.25;

    const frame = computeFluidFurnitureDragFrame(
      primary,
      { x: rawTargetX, z: 1.75 },
      { x: 0, z: 0 },
      [primary],
      new Set([primary.id]),
    );

    expect(frame.targetX).toBeCloseTo(rawTargetX);
    expect(frame.targetZ).toBeCloseTo(1.75);
    expect(frame.dx).toBeCloseTo(rawTargetX);
    expect(frame.dz).toBeCloseTo(1.75);
  });
});
