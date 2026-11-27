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
// The two memoization properties above genuinely cannot be asserted here:
// happy-dom has no WebGL context, so the R3F tree never renders and there is no
// observable behaviour to check. Source-grep is the established pattern for
// those (see #11/#12/#13/#14).
//
// It is NOT the pattern for render DECISIONS. Those are exported pure
// predicates — shouldLimitPlannerFurnitureOverlays, visibleConstraintViolationIds,
// plannerFurnitureRenderPartition, shouldRenderIndividualFurnitureModel — and
// are executed for real in placed-furniture-lean-rules.test.ts and
// PlacedFurniture.generated-proxy.test.ts. Assertions in this file should pin
// WIRING (the JSX calls the predicate, and passes it the right list). Never
// re-spell a predicate's logic here: such an assertion passes even when that
// logic is inverted, because it checks spelling rather than behaviour.
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

  it("raises one camera-facing plate, for the primary selection and never during a marquee", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("groupRef.current.lookAt(camera.position)");
    // Wiring only: the rule is executed in placed-furniture-lean-rules.test.ts
    // and the rendered plates in PlacedFurniture.nameplates.test.tsx.
    expect(codeOnly).toMatch(/primaryNameplateId\(\s*selectedIds,\s*placedItems\s*\)/);
    expect(codeOnly).toContain("useSelectionStore((s) => s.marqueeActive)");
    expect(codeOnly).toContain("nameplatePlaneSize(texture.image.width, texture.image.height)");
  });

  it("renders table dressing layers over placed tables", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("TableClothMesh");
    expect(codeOnly).toContain("AnimatedTableCloth");
    expect(codeOnly).toContain("TableSettingMesh");
    expect(codeOnly).toContain("TABLE_CLOTH_COLORS");
    expect(codeOnly).toContain("placed.tableSetting === \"dinner\"");
  });

  it("renders only applied linen overlays, never a duplicate over intrinsic-cloth furniture", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("appliedTableLinenStyle(catalogueItem, placed)");
    expect(codeOnly).toMatch(/appliedClothStyle\s*!==\s*null[\s\S]{0,500}?<TableClothMesh/);
    expect(codeOnly).not.toContain("placed.clothed && catalogueItem.category === \"table\"");
  });

  it("drapes only the cloths newlyClothedIds names, starting from no previous layout", async () => {
    const { codeOnly } = await readSource(SRC);
    // Wiring only: which ids drape (first load, save, undo, layout switch) is
    // executed in lib/__tests__/newly-clothed.test.ts.
    expect(codeOnly).toContain("useRef<readonly PlacedItem[] | null>(null)");
    expect(codeOnly).toContain("newlyClothedIds(prevItemsRef.current, placedItems)");
    expect(codeOnly).toContain("prevItemsRef.current = placedItems");
  });

  it("keeps compact/motion annotation budgeting separate from model and dressing fidelity", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("shouldLimitPlannerFurnitureOverlays");
    expect(codeOnly).toContain("renderNamePlate={canRenderNameplate(placed.id)}");
    expect(codeOnly).toMatch(/renderModel=\{\s*shouldRenderIndividualFurnitureModel\(/);
    // Mount/width/motion behavior is exercised by PlacedFurniture.fidelity.test.tsx.
  });

  it("caps mobile/tablet constraint warning skins while preserving selected warnings first", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("MAX_LEAN_CONSTRAINT_VIOLATION_SKINS");
    expect(codeOnly).toContain("visibleConstraintViolationIds");
    expect(codeOnly).toContain("renderedConstraintViolationIds");
    // Wiring, not logic: the lean sweep must be scoped to the selection. That
    // is a perf invariant no unit test of the pure helper can see, because it
    // lives in which arguments the call site passes (the whole layout vs the
    // selected items). The cap arithmetic itself is covered in the lean-rules spec.
    expect(codeOnly).toMatch(/leanSweepCandidates\(\s*placedItems,\s*selectedIds/);
    expect(codeOnly).toContain("selectedIds");
    expect(codeOnly).toContain("hasConstraintViolation={renderedConstraintViolationIds.has(placed.id)}");
  });
});
