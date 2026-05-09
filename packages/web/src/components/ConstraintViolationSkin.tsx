import { useMemo, type ReactElement } from "react";
import type { CatalogueItem } from "../lib/catalogue.js";
import { computeRotatedFootprint } from "../lib/placement.js";
import { sectionClipPlanes } from "./SectionPlane.js";

interface ConstraintViolationSkinProps {
  readonly item: CatalogueItem;
  readonly y: number;
}

export interface ViolationCrossMark {
  readonly x: number;
  readonly z: number;
  readonly size: number;
}

export function buildViolationCrossMarks(item: CatalogueItem, maxMarks: number = 18): readonly ViolationCrossMark[] {
  const { halfW, halfD } = computeRotatedFootprint(item, 0);
  const spanX = Math.max(0.45, halfW * 2);
  const spanZ = Math.max(0.45, halfD * 2);
  const columns = Math.max(2, Math.min(5, Math.ceil(spanX / 0.72)));
  const rows = Math.max(2, Math.min(4, Math.ceil(spanZ / 0.72)));
  const marks: ViolationCrossMark[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      if (marks.length >= maxMarks) return marks;
      const x = columns === 1 ? 0 : -halfW + ((col + 0.5) / columns) * spanX;
      const z = rows === 1 ? 0 : -halfD + ((row + 0.5) / rows) * spanZ;
      const size = Math.min(0.42, Math.max(0.18, Math.min(spanX / columns, spanZ / rows) * 0.38));
      marks.push({ x, z, size });
    }
  }

  return marks;
}

export function ConstraintViolationSkin({ item, y }: ConstraintViolationSkinProps): ReactElement {
  const marks = useMemo(() => buildViolationCrossMarks(item), [item]);
  const surfaceY = y + Math.max(0.08, item.height + 0.055);

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
          <pointLight
            color="#ff365c"
            intensity={0.04}
            distance={0.75}
            decay={2}
            position={[0, 0.1, 0]}
          />
        </group>
      ))}
    </group>
  );
}
