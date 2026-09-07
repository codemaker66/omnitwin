import { useContext, useLayoutEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { createGltfFurnitureInstance } from "../../lib/gltf-furniture-instance.js";
import { GltfFurnitureTemplateContext } from "./GltfFurnitureTemplateContext.js";

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
  const { scene } = useGLTF(meshUrl);
  const onTemplateReady = useContext(GltfFurnitureTemplateContext);
  const instance = useMemo(
    () => createGltfFurnitureInstance(scene, item),
    [scene, item.slug, item.width, item.height, item.depth],
  );

  useLayoutEffect(() => {
    instance.setAppearance(opacity, colorOverride);
  }, [instance, opacity, colorOverride]);

  useLayoutEffect(() => {
    onTemplateReady?.();
    return () => { instance.dispose(); };
  }, [instance, onTemplateReady]);

  // Materials belong to this instance; cached geometry/textures remain shared.
  return <primitive object={instance.object} dispose={null} />;
}
