import { DoubleSide, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { setSurfaceOpacity } from "../SurfaceVisibilityGroup.js";
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

    setSurfaceOpacity([wall, trim], 0.8);
    expect(wall.transparent).toBe(true);
    expect(wall.version).toBe(start + 1);

    for (const opacity of [0.7, 0.55, 0.4, 0.25]) setSurfaceOpacity([wall, trim], opacity);
    expect(wall.opacity).toBe(0.25);
    expect(trim.opacity).toBe(0.25);
    expect(wall.version).toBe(start + 1);

    setSurfaceOpacity([wall, trim], 1);
    expect(wall.transparent).toBe(false);
    expect(trim.transparent).toBe(false);
    expect(wall.version).toBe(start + 2);
  });

  it("keeps translucent glass at its authored opacity on an opaque surface and fades it with the surface", () => {
    // The Grand Hall window glass: 0.42 over its daylight backing.
    const glass = new MeshStandardMaterial({ transparent: true, opacity: 0.42, depthWrite: false, side: DoubleSide });
    const start = glass.version;

    setSurfaceOpacity(glass, 1);
    expect(glass.opacity).toBe(0.42);
    expect(glass.transparent).toBe(true);
    expect(glass.version).toBe(start);

    setSurfaceOpacity(glass, 0.5);
    expect(glass.opacity).toBeCloseTo(0.21, 12);
    expect(glass.transparent).toBe(true);

    setSurfaceOpacity(glass, 0);
    expect(glass.opacity).toBe(0);

    setSurfaceOpacity(glass, 1);
    expect(glass.opacity).toBe(0.42);
    expect(glass.transparent).toBe(true);
    // Blended throughout, so no fade step rebuilt the material.
    expect(glass.version).toBe(start);
  });

  it("scales the opacity a material was authored with, not the one a fade left behind", () => {
    const glass = new MeshStandardMaterial({ transparent: true, opacity: 0.38 });
    for (const opacity of [0.9, 0.4, 0.05, 0.6, 1]) setSurfaceOpacity(glass, opacity);
    expect(glass.opacity).toBe(0.38);
    setSurfaceOpacity(glass, 0.5);
    expect(glass.opacity).toBeCloseTo(0.19, 12);
  });

  it("draws materials authored without blending opaque on an opaque surface, as three renders them", () => {
    // `opacity` has no effect without `transparent`, and a transparent
    // material at full opacity (the dome shell) is drawn opaque at rest.
    const ignored = new MeshStandardMaterial({ opacity: 0.3 });
    const dome = new MeshStandardMaterial({ transparent: true });

    setSurfaceOpacity([ignored, dome], 1);
    expect([ignored.opacity, ignored.transparent]).toEqual([1, false]);
    expect([dome.opacity, dome.transparent]).toEqual([1, false]);

    setSurfaceOpacity([ignored, dome], 0.5);
    expect([ignored.opacity, ignored.transparent]).toEqual([0.5, true]);
    expect([dome.opacity, dome.transparent]).toEqual([0.5, true]);
  });
});
