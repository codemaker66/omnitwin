import { createContext } from "react";

/** Re-harvest a hidden template after its asynchronous GLB replaces the fallback. */
export const GltfFurnitureTemplateContext = createContext<(() => void) | undefined>(undefined);
