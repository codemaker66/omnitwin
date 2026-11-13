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
import { TABLE_CLOTH_OPACITY } from "../../lib/table-dressing.js";
import { clothSeeThrough } from "./cloth-material.js";

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
  opacity = TABLE_CLOTH_OPACITY,
  colorOverride,
}: TableClothMeshProps): React.ReactElement {
  // A settled cloth is opaque, so the tabletop never reads through it; only a
  // cloth still arriving is see-through (cloth-material.ts).
  const seeThrough = clothSeeThrough(opacity);
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
        transparent={seeThrough}
        opacity={opacity}
        depthWrite={!seeThrough}
        clippingPlanes={noClipPlanes}
      />
    </mesh>
  );
}
