import { useLayoutEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import type { CatalogueItem } from "../../../lib/catalogue.js";
import { createCraftedFurniture } from "./crafted-registry.js";
import { onCraftedTexturePainted } from "./crafted-textures.js";

interface CraftedFurnitureProps {
  readonly item: Pick<CatalogueItem, "slug" | "width" | "depth" | "height">;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

/** A crafted furniture model, owned by this component and disposed with it. */
export function CraftedFurniture({ item, opacity = 1, colorOverride }: CraftedFurnitureProps): React.ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const instance = useMemo(
    () => createCraftedFurniture(item),
    // Rebuilt only when the catalogue item's identity or size changes.
    [item.slug, item.width, item.depth, item.height],
  );
  useLayoutEffect(() => {
    instance.setAppearance(opacity, colorOverride);
  }, [instance, opacity, colorOverride]);
  useLayoutEffect(() => () => { instance.dispose(); }, [instance]);
  // Its maps are painted off the main thread and may arrive after it first
  // draws; the canvas draws on demand, so each arrival asks it for a frame.
  // Watching from the commit means no arrival falls between the draw and the watch.
  useLayoutEffect(() => onCraftedTexturePainted(invalidate), [invalidate]);
  return <primitive object={instance.object} dispose={null} />;
}
