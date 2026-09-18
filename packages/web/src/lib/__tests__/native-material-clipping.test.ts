import { MeshBasicMaterial, PerspectiveCamera, Plane, Scene, Vector3 } from "three";
import { ClippingGroup } from "three/webgpu";
import ClippingContext from "three/src/renderers/common/ClippingContext.js";
import { describe, expect, it } from "vitest";
import { createNativeMaterialClipping } from "../native-material-clipping.js";

function context(): ClippingContext {
  const context = new ClippingContext();
  context.updateGlobal(new Scene(), new PerspectiveCamera());
  return context;
}

describe("native material clipping", () => {
  it("clips opted-in materials and leaves floor/furniture exclusions untouched", () => {
    const native = context();
    const clipped = new MeshBasicMaterial({ clippingPlanes: [new Plane(new Vector3(0, -1, 0), 7)] });
    const excluded = new MeshBasicMaterial({ clippingPlanes: [] });
    const resolve = createNativeMaterialClipping();
    expect(resolve(excluded, native)).toBe(native);
    const section = resolve(clipped, native);
    expect(section).not.toBe(native);
    expect(section?.unionPlanes).toHaveLength(1);
    expect(section?.unionPlanes[0]?.w).toBe(7);
    expect(native.unionPlanes).toHaveLength(0);
  });

  it("updates moved section planes without allocating a new native context", () => {
    const native = context();
    const plane = new Plane(new Vector3(0, -1, 0), 7);
    const material = new MeshBasicMaterial({ clippingPlanes: [plane] });
    const resolve = createNativeMaterialClipping();
    const first = resolve(material, native);
    plane.constant = 2.4;
    const next = resolve(material, native);
    expect(next).toBe(first);
    expect(next?.unionPlanes[0]?.w).toBe(2.4);
  });

  it("retains parent clipping and applies the material's intersection policy", () => {
    const native = context();
    const parent = new ClippingGroup();
    parent.clippingPlanes = [new Plane(new Vector3(1, 0, 0), 3)];
    const parentContext = native.getGroupContext(parent);
    const material = new MeshBasicMaterial({
      clippingPlanes: [new Plane(new Vector3(0, -1, 0), 7)], clipIntersection: true,
    });
    const clipped = createNativeMaterialClipping()(material, parentContext);
    expect(clipped?.unionPlanes).toHaveLength(1);
    expect(clipped?.intersectionPlanes).toHaveLength(1);
    expect(parentContext.intersectionPlanes).toHaveLength(0);
  });
});
