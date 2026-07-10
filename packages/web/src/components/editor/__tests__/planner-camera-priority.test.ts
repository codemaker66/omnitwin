import { describe, expect, it } from "vitest";
import { shouldUseLeanPlannerFurniture } from "../../PlacedFurniture.js";
import { shouldRenderPlannerMotionOverlays } from "../../../lib/planner-render-policy.js";
import { shouldUseRoomMeshLeanShell } from "../RoomMesh.js";

describe("planner camera-priority render policy", () => {
  it("keeps rich room and furniture detail available at rest on desktop", () => {
    expect(shouldUseRoomMeshLeanShell("auto", 1440, false)).toBe(false);
    expect(shouldUseLeanPlannerFurniture(1440, false)).toBe(false);
  });

  it("switches to lean room and furniture rendering during camera movement", () => {
    expect(shouldUseRoomMeshLeanShell("auto", 1440, true)).toBe(true);
    expect(shouldUseRoomMeshLeanShell("detailed", 1440, true)).toBe(true);
    expect(shouldUseLeanPlannerFurniture(1440, true)).toBe(true);
  });

  it("suspends nonessential 3D annotation overlays during camera movement", () => {
    expect(shouldRenderPlannerMotionOverlays(false)).toBe(true);
    expect(shouldRenderPlannerMotionOverlays(true)).toBe(false);
  });

  it("keeps mobile and tablet lean even when the camera is idle", () => {
    expect(shouldUseRoomMeshLeanShell("auto", 768, false)).toBe(true);
    expect(shouldUseLeanPlannerFurniture(768, false)).toBe(true);
  });
});
