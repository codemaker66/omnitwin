import { describe, expect, it } from "vitest";
import {
  stepWallAssemblyOpacity,
  wallAssemblyTargetFromBaseOpacity,
  wallKeyFromSurfaceKey,
} from "../SurfaceVisibilityGroup.js";

describe("SurfaceVisibilityGroup wall assembly helpers", () => {
  it("detects wall surface keys and ignores ceiling/dome surfaces", () => {
    expect(wallKeyFromSurfaceKey("wall-back")).toBe("wall-back");
    expect(wallKeyFromSurfaceKey("wall-front")).toBe("wall-front");
    expect(wallKeyFromSurfaceKey("ceiling")).toBeNull();
    expect(wallKeyFromSurfaceKey("dome")).toBeNull();
  });

  it("uses the shared wall-build threshold", () => {
    expect(wallAssemblyTargetFromBaseOpacity(0.49)).toBe(0);
    expect(wallAssemblyTargetFromBaseOpacity(0.5)).toBe(1);
  });

  it("steps locked ornament opacity instead of snapping to the hidden state", () => {
    const next = stepWallAssemblyOpacity(1, 0, 0.1);

    expect(next).toBeGreaterThan(0.95);
    expect(next).toBeLessThan(1);
  });

  it("clamps long frame deltas so click animations remain deliberate", () => {
    expect(stepWallAssemblyOpacity(1, 0, 10)).toBe(stepWallAssemblyOpacity(1, 0, 0.1));
  });
});
