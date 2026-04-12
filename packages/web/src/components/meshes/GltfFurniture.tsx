import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Box3, Vector3, MeshStandardMaterial } from "three";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// GltfFurniture — loads a .glb model and scales it to match the catalogue
// item's real-world dimensions. Supports opacity and colour overrides for
// the placement ghost + selection highlight.
//
// Punch list #28: this is the render-side entry point for the 3D model
// asset pipeline. When a catalogue item has a non-null meshUrl, this
// component is used instead of the procedural mesh. When meshUrl is null,
// FurnitureProxy falls back to the existing hand-crafted geometry.
//
// The loaded model is scaled to fit within the catalogue item's bounding
// box (width × height × depth) in render space. This means any .glb file
// can be dropped in without manual scaling — the component normalises it
// to the catalogue dimensions automatically.
// ---------------------------------------------------------------------------

interface GltfFurnitureProps {
  readonly meshUrl: string;
  readonly item: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

export function GltfFurniture({
  meshUrl,
  item,
  opacity = 1,
  colorOverride,
}: GltfFurnitureProps): React.ReactElement {
  const { scene: gltfScene } = useGLTF(meshUrl);

  // Clone the scene so each instance gets its own material references —
  // without this, changing opacity on one instance affects all of them.
  const clone = useMemo(() => {
    const cloned = gltfScene.clone(true);

    // Apply material overrides (colour, opacity, clipping planes)
    cloned.traverse((child) => {
      if ("material" in child && child.material instanceof MeshStandardMaterial) {
        const mat = child.material.clone();
        if (colorOverride !== undefined) {
          mat.color.set(colorOverride);
        }
        mat.transparent = opacity < 1;
        mat.opacity = opacity;
        mat.clippingPlanes = noClipPlanes;
        child.material = mat;
      }
    });

    return cloned;
  }, [gltfScene, colorOverride, opacity]);

  // Scale the model to fit the catalogue item's bounding box.
  // The model's native size may be arbitrary; we normalise it to
  // match width × height × depth in render space.
  const scale = useMemo(() => {
    const bbox = new Box3().setFromObject(clone);
    const size = new Vector3();
    bbox.getSize(size);

    const targetW = toRenderSpace(item.width);
    const targetH = item.height;
    const targetD = toRenderSpace(item.depth);

    // Uniform scale that fits the model within the target box
    const sx = size.x > 0 ? targetW / size.x : 1;
    const sy = size.y > 0 ? targetH / size.y : 1;
    const sz = size.z > 0 ? targetD / size.z : 1;
    const uniformScale = Math.min(sx, sy, sz);

    return uniformScale;
  }, [clone, item.width, item.height, item.depth]);

  // Centre the model at origin, bottom at Y=0
  const yOffset = useMemo(() => {
    const bbox = new Box3().setFromObject(clone);
    return -bbox.min.y * scale;
  }, [clone, scale]);

  return (
    <group scale={[scale, scale, scale]} position={[0, yOffset, 0]}>
      <primitive object={clone} />
    </group>
  );
}
