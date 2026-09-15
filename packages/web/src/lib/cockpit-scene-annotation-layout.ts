/** Screen coordinates only. These rectangles never alter a world-space anchor. */
export interface AnnotationRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface AnnotationMeasure { readonly id: string; readonly priority: number; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface AnnotationPlacement extends AnnotationRect { readonly id: string }
export interface AnnotationLayout { readonly mode: "packed" | "list"; readonly placements: readonly AnnotationPlacement[]; readonly contentHeight: number }
export const ANNOTATION_GAP = 8;
// Reserve native scrollbar/border space around at least one 44px target.
const MIN_USABLE_AREA = 64;

export function rectanglesOverlap(a: AnnotationRect, b: AnnotationRect, gap = 0): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/** Largest unobstructed rectangle, subtracting the actual visible UI bounds. */
export function annotationSafeArea(viewport: AnnotationRect, obstacles: readonly AnnotationRect[]): AnnotationRect | null {
  let free: AnnotationRect[] = [{ x: viewport.x + 12, y: viewport.y + 12, width: Math.max(0, viewport.width - 24), height: Math.max(0, viewport.height - 24) }];
  for (const obstacle of obstacles) {
    const b = { x: obstacle.x - ANNOTATION_GAP, y: obstacle.y - ANNOTATION_GAP, width: obstacle.width + ANNOTATION_GAP * 2, height: obstacle.height + ANNOTATION_GAP * 2 };
    free = free.flatMap((r) => {
      if (!rectanglesOverlap(r, b)) return [r];
      return [
        { x: r.x, y: r.y, width: b.x - r.x, height: r.height },
        { x: b.x + b.width, y: r.y, width: r.x + r.width - b.x - b.width, height: r.height },
        { x: r.x, y: r.y, width: r.width, height: b.y - r.y },
        { x: r.x, y: b.y + b.height, width: r.width, height: r.y + r.height - b.y - b.height },
      ].filter((part) => part.width >= MIN_USABLE_AREA && part.height >= MIN_USABLE_AREA);
    }).sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 64);
  }
  return free.filter((r) => r.width >= MIN_USABLE_AREA && r.height >= MIN_USABLE_AREA).sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/** Stable severity/id ordering, measured wrapping, and a visible scroll-list fallback. */
export function placeSceneAnnotations(input: readonly AnnotationMeasure[], area: AnnotationRect): AnnotationLayout {
  const sorted = [...input].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const height = sorted.reduce((sum, item) => sum + item.height, 0) + Math.max(0, sorted.length - 1) * ANNOTATION_GAP;
  const placed: AnnotationPlacement[] = [];
  for (const item of sorted) {
    const width = Math.min(item.width, area.width);
    const x = clamp(item.x - width / 2, area.x, area.x + area.width - width);
    const desiredY = clamp(item.y - item.height / 2, area.y, area.y + area.height - item.height);
    const candidates = [desiredY, area.y, area.y + area.height - item.height,
      ...placed.flatMap((r) => [r.y - item.height - ANNOTATION_GAP, r.y + r.height + ANNOTATION_GAP])]
      .filter((y) => y >= area.y && y + item.height <= area.y + area.height)
      .sort((a, b) => Math.abs(a - desiredY) - Math.abs(b - desiredY) || a - b);
    const y = candidates.find((candidate) => !placed.some((r) => rectanglesOverlap(r, { x, y: candidate, width, height: item.height }, ANNOTATION_GAP)));
    if (y === undefined || item.width > area.width) break;
    placed.push({ id: item.id, x, y, width, height: item.height });
  }
  if (placed.length === sorted.length) return { mode: "packed", placements: placed, contentHeight: height };
  // A single ordered column always fits when its measured total height fits.
  // Otherwise all records remain in that same native scroll region.
  const list = height > area.height;
  let y = list ? 0 : area.y + Math.max(0, (area.height - height) / 2);
  const placements = sorted.map((item) => {
    const width = Math.min(item.width, area.width);
    const next = { id: item.id, x: list ? 0 : area.x, y, width, height: item.height };
    y += item.height + ANNOTATION_GAP;
    return next;
  });
  return { mode: list ? "list" : "packed", placements, contentHeight: height };
}
