import type { CatalogueItem } from "../lib/catalogue.js";
import { RoundTableMesh } from "./meshes/RoundTableMesh.js";
import { TrestleTableMesh } from "./meshes/TrestleTableMesh.js";
import { ChairMesh } from "./meshes/ChairMesh.js";
import { PlatformMesh } from "./meshes/PlatformMesh.js";

// ---------------------------------------------------------------------------
// FurnitureProxy — routes to the correct mesh component per item type
// ---------------------------------------------------------------------------

interface FurnitureProxyProps {
  /** Catalogue item defining dimensions and colour. */
  readonly item: CatalogueItem;
  /** Position in render space [x, y, z]. Y=0 is floor level. */
  readonly position: readonly [number, number, number];
  /** Rotation around Y axis in radians. */
  readonly rotationY?: number;
  /** Override opacity (0–1). Defaults to 1. */
  readonly opacity?: number;
  /** Override colour (e.g. green/red for placement ghost). */
  readonly colorOverride?: string;
  /** Mesh name for raycasting identification. */
  readonly name?: string;
}

/**
 * Renders the correct mesh component for a catalogue item.
 * Routes based on category + tableShape to pick the right geometry.
 */
export function FurnitureProxy({
  item,
  position,
  rotationY = 0,
  opacity = 1,
  colorOverride,
  name,
}: FurnitureProxyProps): React.ReactElement {
  return (
    <group
      name={name}
      position={[position[0], position[1], position[2]]}
      rotation={[0, rotationY, 0]}
    >
      {renderMesh(item, opacity, colorOverride)}
    </group>
  );
}

function renderMesh(
  item: CatalogueItem,
  opacity: number,
  colorOverride: string | undefined,
): React.ReactElement {
  switch (item.category) {
    case "table":
      if (item.tableShape === "round") {
        return <RoundTableMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
      }
      return <TrestleTableMesh item={item} opacity={opacity} colorOverride={colorOverride} />;

    case "chair":
      return <ChairMesh item={item} opacity={opacity} colorOverride={colorOverride} />;

    case "stage":
      return <PlatformMesh item={item} opacity={opacity} colorOverride={colorOverride} />;

    default:
      return <PlatformMesh item={item} opacity={opacity} colorOverride={colorOverride} />;
  }
}
