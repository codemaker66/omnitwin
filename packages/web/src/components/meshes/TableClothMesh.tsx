import { useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, DoubleSide } from "three";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import {
  computeRoundClothGeometry,
  computeRectClothGeometry,
  CLOTH_COLOR,
} from "../../lib/cloth-geometry.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// TableClothMesh — floor-length draped cloth with fabric fold pleats
// ---------------------------------------------------------------------------

interface TableClothMeshProps {
  readonly tableItem: CatalogueItem;
  readonly opacity?: number;
  readonly colorOverride?: string;
}

/**
 * Renders a floor-length table cloth with fabric fold pleats.
 *
 * Round tables get a circular disc top + cylindrical skirt.
 * Rectangular tables get a flat top + skirt on all four sides.
 * Both have natural-looking pleat folds that increase toward the floor.
 */
export function TableClothMesh({
  tableItem,
  opacity = 0.78,
  colorOverride,
}: TableClothMeshProps): React.ReactElement {
  const isRound = tableItem.tableShape === "round";
  const color = colorOverride ?? CLOTH_COLOR;
  const geometry = useMemo(() => {
    const geom = new BufferGeometry();
    let result;

    if (isRound) {
      const renderRadius = toRenderSpace(tableItem.width) / 2;
      result = computeRoundClothGeometry(renderRadius, tableItem.height);
    } else {
      const renderWidth = toRenderSpace(tableItem.width);
      const renderDepth = toRenderSpace(tableItem.depth);
      result = computeRectClothGeometry(renderWidth, renderDepth, tableItem.height);
    }

    geom.setAttribute("position", new Float32BufferAttribute(result.positions, 3));
    geom.setAttribute("normal", new Float32BufferAttribute(result.normals, 3));
    geom.setAttribute("uv", new Float32BufferAttribute(result.uvs, 2));
    geom.setIndex(new Uint32BufferAttribute(result.indices, 1));

    return geom;
  }, [isRound, tableItem.width, tableItem.depth, tableItem.height]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        roughness={0.88}
        metalness={0.02}
        side={DoubleSide}
        transparent
        opacity={opacity}
        depthWrite={false}
        clippingPlanes={noClipPlanes}
      />
    </mesh>
  );
}
