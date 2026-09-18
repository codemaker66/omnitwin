import type { Material } from "three";
import { ClippingGroup, type WebGPURenderer } from "three/webgpu";
import type ClippingContext from "three/src/renderers/common/ClippingContext.js";

/**
 * Keep the planner's explicit per-material section exclusions using Three's
 * native clipping groups. No scene reparenting and no custom clipping shader.
 * The public render-object hook exposes the current native clipping context.
 */
export function createNativeMaterialClipping(): (
  material: Material,
  context: ClippingContext | null,
) => ClippingContext | null {
  const groups = new WeakMap<Material, ClippingGroup>();
  return (material, context) => {
    if (context === null || material.clippingPlanes === null || material.clippingPlanes.length === 0) {
      return context;
    }
    let group = groups.get(material);
    if (group === undefined) {
      group = new ClippingGroup();
      groups.set(material, group);
    }
    group.clippingPlanes = material.clippingPlanes;
    group.clipIntersection = material.clipIntersection;
    group.clipShadows = material.clipShadows;
    return context.getGroupContext(group);
  };
}

export function installNativeMaterialClipping(renderer: WebGPURenderer): void {
  const clipping = createNativeMaterialClipping();
  renderer.setRenderObjectFunction((object, scene, camera, geometry, material, group, lights, context, passId) => {
    renderer.renderObject(object, scene, camera, geometry, material, group, lights, clipping(material, context), passId);
  });
}
