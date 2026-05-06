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
    expect(codeOnly).toContain("furniture-nameplate");
    expect(codeOnly).toContain("furniture-camera-reference-glow");
    expect(codeOnly).toContain("bookmark.reference?.placedItemId");
    expect(codeOnly).toContain("cameraEnabled={hasCameraReference}");
  });
});
