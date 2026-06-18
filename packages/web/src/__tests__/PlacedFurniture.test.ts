// ---------------------------------------------------------------------------
// PlacedFurniture (#15) — memoization tripwire
//
// Two perf bugs fixed by extracting a React.memo-wrapped child component:
//
// 1. Re-render granularity was component-level. Every placedItems store update
//    caused the parent .map() to reconstruct all N JSX subtrees even though
//    Zustand preserves object identity for unchanged items. With memo, ~(N-1)
//    of N children skip re-render on single-item mutations.
//
// 2. selectionBoxArgs() returned a fresh array every render, causing R3F to
//    dispose and reallocate the BoxGeometry GPU buffer per frame. A useMemo
//    inside the child keeps the args tuple stable.
//
// These properties can't be tested behaviourally because happy-dom has no
// WebGL context — source-grep is the established pattern (see #11/#12/#13/#14).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

async function readSource(relPath: string): Promise<{ raw: string; codeOnly: string }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const raw = await fs.readFile(path.resolve(relPath), "utf-8");
  const codeOnly = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  return { raw, codeOnly };
}

describe("PlacedFurniture (#15) — memoization tripwire", () => {
  const SRC = "src/components/PlacedFurniture.tsx";

  it("defines a PlacedFurnitureItem child wrapped in React.memo", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("PlacedFurnitureItem");
    expect(codeOnly).toContain("memo(");
  });

  it("imports memo from react", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toMatch(/import\s+\{[^}]*\bmemo\b[^}]*\}\s+from\s+["']react["']/);
  });

  it("wraps selectionBoxArgs in useMemo inside the child", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("useMemo(");
    expect(codeOnly).toMatch(/useMemo[\s\S]{0,400}?selectionBoxArgs\(/);
  });

  it("parent passes per-item props by name to PlacedFurnitureItem", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("<PlacedFurnitureItem");
    expect(codeOnly).toContain("placed=");
    expect(codeOnly).toContain("isSelected=");
    expect(codeOnly).toContain("isAnimating=");
    expect(codeOnly).toContain("onAnimationComplete=");
  });

  it("does not contain the unmemoized inline args={selectionBoxArgs(...)} pattern", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).not.toMatch(/args=\{selectionBoxArgs\(/);
  });

  it("renders persisted furniture labels as scene nameplates with camera-reference glow", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("function FurnitureNamePlate");
    expect(codeOnly).toContain("item-nameplate");
    expect(codeOnly).toContain("camera-reference-glow");
    expect(codeOnly).toContain("bookmark.reference?.placedItemId");
    expect(codeOnly).toContain("cameraEnabled={hasCameraReference}");
  });

  it("renders labels as large camera-facing nameplates instead of tiny object strips", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("groupRef.current.lookAt(camera.position)");
    expect(codeOnly).toContain("Math.max(7.2");
    expect(codeOnly).toContain("Math.max(4.8");
    expect(codeOnly).toContain("rotateOffset(tableOffset");
    expect(codeOnly).toContain("grouped seats");
    expect(codeOnly).toContain("Camera point of view active");
    expect(codeOnly).toContain("item-nameplate-anchor-dot");
  });

  it("renders table dressing layers over placed tables", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("TableClothMesh");
    expect(codeOnly).toContain("AnimatedTableCloth");
    expect(codeOnly).toContain("TableSettingMesh");
    expect(codeOnly).toContain("TABLE_CLOTH_COLORS");
    expect(codeOnly).toContain("placed.tableSetting === \"dinner\"");
  });

  it("does not animate persisted clothed tables on initial scene load", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("useRef<ReadonlyMap<string, string> | null>(null)");
    expect(codeOnly).toContain("prev !== null && prev.get(item.id) !== key");
    expect(codeOnly).toContain("if (prev !== null && newlyClothed !== null)");
  });

  it("uses a lean instanced furniture layer for mobile and tablet planner canvases", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("shouldUseLeanPlannerFurniture");
    expect(codeOnly).toContain("LEAN_PLANNER_FURNITURE_MIN_VIEWPORT_WIDTH");
    expect(codeOnly).toContain("function LeanFurnitureLayer");
    expect(codeOnly).toContain("<LeanFurnitureLayer items={placedItems} />");
    expect(codeOnly).toContain("renderModel={!useLeanFurniture && !instancedIds.has(placed.id)}");
  });

  it("keeps the lean mobile/tablet furniture path on unlit materials", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("new MeshBasicMaterial");
    expect(codeOnly).not.toContain("new MeshStandardMaterial");
  });

  it("limits lean mobile/tablet detail layers and nameplates to focused items", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("canRenderLeanItemDetail");
    expect(codeOnly).toContain("!useLeanFurniture || selectedIds.has(placedId) || cameraReferenceItemIds.has(placedId)");
    expect(codeOnly).toContain("renderDetailLayers={canRenderLeanItemDetail(placed.id)}");
    expect(codeOnly).toContain("renderNamePlate={canRenderLeanItemDetail(placed.id)}");
  });

  it("caps mobile/tablet constraint warning skins while preserving selected warnings first", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("MAX_LEAN_CONSTRAINT_VIOLATION_SKINS");
    expect(codeOnly).toContain("visibleConstraintViolationIds");
    expect(codeOnly).toContain("renderedConstraintViolationIds");
    expect(codeOnly).toContain("useLeanFurniture && MAX_LEAN_CONSTRAINT_VIOLATION_SKINS <= 0");
    expect(codeOnly).toContain("selectedIds");
    expect(codeOnly).toContain("hasConstraintViolation={renderedConstraintViolationIds.has(placed.id)}");
  });
});
