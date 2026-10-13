import { useLayoutEffect, useMemo } from "react";
import type { CatalogueItem } from "../../../lib/catalogue.js";
import { createCraftedFurniture } from "./crafted-registry.js";

interface CraftedFurnitureProps {
  readonly item: Pick<CatalogueItem, "slug" | "width" | "depth" | "height">;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

/** A crafted furniture model, owned by this component and disposed with it. */
export function CraftedFurniture({ item, opacity = 1, colorOverride }: CraftedFurnitureProps): React.ReactElement {
  const instance = useMemo(
    () => createCraftedFurniture(item),
    // Rebuilt only when the catalogue item's identity or size changes.
    [item.slug, item.width, item.depth, item.height],
  );
  useLayoutEffect(() => {
    instance.setAppearance(opacity, colorOverride);
  }, [instance, opacity, colorOverride]);
  useLayoutEffect(() => () => { instance.dispose(); }, [instance]);
  return <primitive object={instance.object} dispose={null} />;
}
