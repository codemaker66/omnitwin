import { describe, expect, it } from "vitest";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  type LayoutSnapshotVenueRuntimeReference,
} from "@omnitwin/types";
import {
  frozenLayoutRoomModel,
  frozenRoomEnvelopesMatch,
  retainFrozenLayoutRoomModel,
} from "../frozen-layout-room.js";

function runtimeWith(
  overrides: Partial<LayoutSnapshotVenueRuntimeReference>,
): LayoutSnapshotVenueRuntimeReference {
  return {
    ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime,
    ...overrides,
  };
}

describe("frozen layout room adapter", () => {
  it("centres the canonical lower-left room and applies the same offset to objects", () => {
    const model = frozenLayoutRoomModel(
      CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime,
    );
    const fixtureObject = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.objects[0];

    expect(model.geometry.wallPolygon).toEqual([
      [-10.5, -5.25],
      [10.5, -5.25],
      [10.5, 5.25],
      [-10.5, 5.25],
    ]);
    expect(model.renderDimensions).toEqual({ width: 21, length: 10.5, height: 7 });
    expect(model.furnitureOffset).toEqual([-10.5, 0, -5.25]);
    expect(fixtureObject).toBeDefined();
    expect((fixtureObject?.position.x ?? 0) + model.furnitureOffset[0])
      .toBe((fixtureObject?.position.x ?? 0) - 10.5);
    expect((fixtureObject?.position.z ?? 0) + model.furnitureOffset[2])
      .toBe((fixtureObject?.position.z ?? 0) - 5.25);
  });

  it("rejects spatial correspondence when frozen room envelopes drift", () => {
    const runtime = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime;
    const shiftedOutline = runtimeWith({
      floorPlanOutline: runtime.floorPlanOutline.map((point) => ({
        x: point.x + 2,
        y: point.y,
      })),
    });
    const changedDimensions = runtimeWith({
      spaceDimensions: { ...runtime.spaceDimensions, width: 24 },
    });

    expect(frozenRoomEnvelopesMatch(runtime, { ...runtime })).toBe(true);
    expect(frozenRoomEnvelopesMatch(runtime, shiftedOutline)).toBe(false);
    expect(frozenRoomEnvelopesMatch(runtime, changedDimensions)).toBe(false);
  });

  it("retains effective camera dimensions for equal envelopes and replaces them for drift", () => {
    const runtime = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime;
    const first = retainFrozenLayoutRoomModel(null, runtime);
    const sameEnvelope = retainFrozenLayoutRoomModel(first, { ...runtime });
    const changedEnvelope = retainFrozenLayoutRoomModel(first, runtimeWith({
      spaceDimensions: { ...runtime.spaceDimensions, width: 24 },
    }));

    expect(sameEnvelope).toBe(first);
    expect(sameEnvelope?.renderDimensions).toBe(first?.renderDimensions);
    expect(changedEnvelope).not.toBe(first);
    expect(changedEnvelope?.renderDimensions).not.toBe(first?.renderDimensions);
  });
});
