import { describe, expect, it } from "vitest";
import { shouldLimitPlannerFurnitureOverlays } from "../../PlacedFurniture.js";
import { shouldRenderPlannerMotionOverlays } from "../../../lib/planner-render-policy.js";
import { shouldUseRoomMeshLeanShell } from "../RoomMesh.js";

describe("planner camera-priority render policy", () => {
  it("keeps the room shell and furniture annotations available at rest on desktop", () => {
    expect(shouldUseRoomMeshLeanShell("auto", 1440, false)).toBe(false);
    expect(shouldLimitPlannerFurnitureOverlays(1440, false)).toBe(false);
  });

  it("bounds room-shell and furniture-annotation work during camera movement", () => {
    expect(shouldUseRoomMeshLeanShell("auto", 1440, true)).toBe(true);
    expect(shouldUseRoomMeshLeanShell("detailed", 1440, true)).toBe(true);
    expect(shouldLimitPlannerFurnitureOverlays(1440, true)).toBe(true);
  });

  it("suspends nonessential 3D annotation overlays during camera movement", () => {
    expect(shouldRenderPlannerMotionOverlays(false)).toBe(true);
    expect(shouldRenderPlannerMotionOverlays(true)).toBe(false);
  });

  it("bounds compact room-shell and furniture-annotation work even when the camera is idle", () => {
    expect(shouldUseRoomMeshLeanShell("auto", 768, false)).toBe(true);
    expect(shouldLimitPlannerFurnitureOverlays(768, false)).toBe(true);
  });
});
