import { MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { setMaterialOpacity } from "../SurfaceVisibilityGroup.js";
import {
  stepWallAssemblyOpacity,
  wallAssemblyTargetFromBaseOpacity,
  wallKeyFromSurfaceKey,
} from "../../lib/surface-visibility-group.js";

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

describe("SurfaceVisibilityGroup material fades", () => {
  it("rebuilds a material only when a fade changes its blending, not on every step", () => {
    const wall = new MeshStandardMaterial();
    const trim = new MeshStandardMaterial();
    const start = wall.version;

    setMaterialOpacity([wall, trim], 0.8);
    expect(wall.transparent).toBe(true);
    expect(wall.version).toBe(start + 1);

    for (const opacity of [0.7, 0.55, 0.4, 0.25]) setMaterialOpacity([wall, trim], opacity);
    expect(wall.opacity).toBe(0.25);
    expect(trim.opacity).toBe(0.25);
    expect(wall.version).toBe(start + 1);

    setMaterialOpacity([wall, trim], 1);
    expect(wall.transparent).toBe(false);
    expect(trim.transparent).toBe(false);
    expect(wall.version).toBe(start + 2);
  });
});
