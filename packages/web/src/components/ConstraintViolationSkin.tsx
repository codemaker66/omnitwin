import { useMemo, type ReactElement } from "react";
import type { CatalogueItem } from "../lib/catalogue.js";
import { buildViolationCrossMarks } from "../lib/constraint-violation-skin.js";
import { normalizeFurnitureScale } from "../lib/furniture-scale.js";
import { sectionClipPlanes } from "./SectionPlane.js";

interface ConstraintViolationSkinProps {
  readonly item: CatalogueItem;
  readonly y: number;
  readonly scale?: number;
}

export { buildViolationCrossMarks, type ViolationCrossMark } from "../lib/constraint-violation-skin.js";

export function ConstraintViolationSkin({ item, y, scale }: ConstraintViolationSkinProps): ReactElement {
  const resolvedScale = normalizeFurnitureScale(scale);
  const marks = useMemo(
    () => buildViolationCrossMarks(item, 18, resolvedScale),
    [item, resolvedScale],
  );
  const surfaceY = y + Math.max(0.08, item.height * resolvedScale + 0.055);

  return (
    <group name="constraint-violation-skin" position={[0, surfaceY, 0]} renderOrder={12}>
      {marks.map((mark, index) => (
        <group key={`${String(index)}-${mark.x.toFixed(2)}-${mark.z.toFixed(2)}`} position={[mark.x, 0, mark.z]} rotation={[0, Math.PI / 4, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={12}>
            <boxGeometry args={[mark.size, 0.018, 0.012]} />
            <meshBasicMaterial
              color="#ff365c"
              transparent
              opacity={0.68}
              depthTest={false}
              depthWrite={false}
              clippingPlanes={sectionClipPlanes}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} renderOrder={12}>
            <boxGeometry args={[mark.size, 0.018, 0.012]} />
            <meshBasicMaterial
              color="#ff365c"
              transparent
              opacity={0.68}
              depthTest={false}
              depthWrite={false}
              clippingPlanes={sectionClipPlanes}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
