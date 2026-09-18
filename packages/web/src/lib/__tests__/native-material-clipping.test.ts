import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Plane, Scene, Vector3 } from "three";
import { ClippingGroup, LightsNode, type WebGPURenderer } from "three/webgpu";
import ClippingContext from "three/src/renderers/common/ClippingContext.js";
import { describe, expect, it, vi } from "vitest";
import { createNativeMaterialClipping, installNativeMaterialClipping } from "../native-material-clipping.js";

function context(): ClippingContext {
  const context = new ClippingContext();
  context.updateGlobal(new Scene(), new PerspectiveCamera());
  return context;
}

describe("native material clipping", () => {
  it("uses the same clipping context through direct compilation and ordinary draw dispatch", () => {
    const native = context();
    const material = new MeshBasicMaterial({ clippingPlanes: [new Plane(new Vector3(0, -1, 0), 7)] });
    const mesh = new Mesh(new BoxGeometry(), material);
    const draw = vi.fn<WebGPURenderer["renderObject"]>();
    const renderer = { renderObject: draw };
    installNativeMaterialClipping(renderer);

    // r186 compileAsync selects this public method directly, without consulting
    // setRenderObjectFunction. Render uses the same method by default.
    const compileDispatch = renderer.renderObject;
    const args: Parameters<WebGPURenderer["renderObject"]> = [
      mesh, new Scene(), new PerspectiveCamera(), mesh.geometry, material, null, new LightsNode(), native, null,
    ];
    compileDispatch(...args);
    renderer.renderObject(...args);
    const compiledContext = draw.mock.calls[0]?.[7];
    const renderedContext = draw.mock.calls[1]?.[7];
    expect(compiledContext).not.toBe(native);
    expect(compiledContext?.unionPlanes).toHaveLength(1);
    expect(compiledContext?.unionPlanes[0]?.w).toBe(7);
    expect(renderedContext).toBe(compiledContext);
    expect(draw.mock.calls[1]?.slice(0, 7)).toEqual(args.slice(0, 7));
    expect(native.unionPlanes).toHaveLength(0);
    mesh.geometry.dispose();
    material.dispose();
  });

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
