import type { CatalogueItem } from "./catalogue.js";
import { computeRotatedFootprint } from "./placement.js";

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
