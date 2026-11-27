import type { MeshStandardMaterial } from "three";

// ---------------------------------------------------------------------------
// How a cloth draws at a given opacity. A settled cloth is opaque, drawn in the
// opaque pass with depth writes, so the tabletop never reads through it. Only a
// cloth still arriving (the drape's or the spiral's fade) is see-through, and
// then it neither writes depth nor sorts as opaque. TableClothMesh, the drape
// and the spiral all follow this one rule, so a cloth's hand-off from its
// arrival to the static mesh never changes how it draws.
// ---------------------------------------------------------------------------

/** Whether a cloth at this opacity draws see-through: only one still arriving. */
export function clothSeeThrough(opacity: number): boolean {
  return opacity < 1;
}

/**
 * Sets an arriving cloth's opacity, and with it its pass: blended without depth
 * writes while below 1, opaque at 1. A change of pass marks the material for a
 * rebuild, as the renderers key their pipelines on blending and depth writes.
 */
export function setClothOpacity(material: MeshStandardMaterial, opacity: number): void {
  material.opacity = opacity;
  const seeThrough = clothSeeThrough(opacity);
  if (material.transparent === seeThrough && material.depthWrite === !seeThrough) return;
  material.transparent = seeThrough;
  material.depthWrite = !seeThrough;
  material.needsUpdate = true;
}
