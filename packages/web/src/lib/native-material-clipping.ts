import type { Material, Plane } from "three";
import { ClippingGroup, type WebGPURenderer } from "three/webgpu";
import type ClippingContext from "three/src/renderers/common/ClippingContext.js";

/**
 * Keep the planner's explicit per-material section exclusions using Three's
 * native clipping groups. No scene reparenting and no custom clipping shader.
 * The public renderObject method exposes the current native clipping context.
 *
 * One group serves every material that shares a plane array and policy (every
 * section-clipped surface shares `sectionClipPlanes`). Three keys compiled
 * shaders and pipelines on the clipping context, so a group per material made
 * each clipped material, even an identical selection outline or name plate,
 * compile its own pipeline the moment it appeared.
 */
export function createNativeMaterialClipping(): (
  material: Material,
  context: ClippingContext | null,
) => ClippingContext | null {
  const groups = new WeakMap<Plane[], ClippingGroup[]>();
  return (material, context) => {
    const planes = material.clippingPlanes;
    if (context === null || planes === null || planes.length === 0) return context;
    let shared = groups.get(planes);
    if (shared === undefined) {
      shared = [];
      groups.set(planes, shared);
    }
    let group = shared.find((candidate) => candidate.clipIntersection === material.clipIntersection
      && candidate.clipShadows === material.clipShadows);
    if (group === undefined) {
      group = new ClippingGroup();
      group.clippingPlanes = planes;
      group.clipIntersection = material.clipIntersection;
      group.clipShadows = material.clipShadows;
      shared.push(group);
    }
    return context.getGroupContext(group);
  };
}

export function installNativeMaterialClipping(renderer: Pick<WebGPURenderer, "renderObject">): void {
  const clipping = createNativeMaterialClipping();
  const renderObject = renderer.renderObject.bind(renderer);
  // r186 compileAsync dispatches directly to renderObject, bypassing the
  // setRenderObjectFunction hook used by ordinary draws. Wrap the shared public
  // entry so warmup builds the same clipped shader variants that render uses.
  renderer.renderObject = (object, scene, camera, geometry, material, group, lights, context = null, passId) => {
    renderObject(object, scene, camera, geometry, material, group, lights, clipping(material, context), passId);
  };
}
