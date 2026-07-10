import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// PlacementHint — source-grep tripwire tests
//
// PlacementHint shows contextual shortcut hints during furniture placement
// and invalid-placement feedback. These tests verify structural properties.
// ---------------------------------------------------------------------------

function readSource(): string {
  const raw = readFileSync("src/components/PlacementHint.tsx", "utf-8");
  return raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("PlacementHint", () => {
  it("exports a named function component", () => {
    const code = readSource();
    expect(code).toContain("export function PlacementHint");
  });

  it("reads ghostInvalidReason from placement store", () => {
    const code = readSource();
    expect(code).toContain("ghostInvalidReason");
    expect(code).toContain("usePlacementStore");
  });

  it("reads selectedItemId from catalogue store", () => {
    const code = readSource();
    expect(code).toContain("selectedItemId");
    expect(code).toContain("useCatalogueStore");
  });

  it("has dismiss functionality with localStorage persistence", () => {
    const code = readSource();
    expect(code).toContain("window.localStorage");
    expect(code).toContain("dismissed");
    expect(code).toContain("handleDismiss");
  });

  it("keeps desktop placement shortcuts; mobile uses the planner dock instead", () => {
    const code = readSource();
    expect(code).toContain("Click");
    expect(code).toContain("Rotate");
    expect(code).toContain("Esc");
    expect(code).toContain("isTouch || isNarrow");
  });

  it("uses the shared movable, minimizable floating widget frame", () => {
    const code = readSource();
    expect(code).toContain("FloatingWidgetFrame");
    expect(code).toContain("placement-coach");
    expect(code).toContain("placement-coach-widget__body");
    expect(code).toContain("AVOID_SELECTORS");
    expect(code).toContain("compactLabel=\"Place\"");
  });

  it("shows invalid placement reason without hot-path filter animation", () => {
    const code = readSource();
    expect(code).toContain("shownReason");
    expect(code).not.toContain("filter:");
    expect(code).not.toContain("backdropFilter");
    expect(code).not.toContain("WebkitBackdropFilter");
  });

  it("auto-clears reason after timeout", () => {
    const code = readSource();
    expect(code).toContain("setTimeout");
    expect(code).toContain("clearTimeout");
    expect(code).toContain("reasonTimerRef");
  });

  it("names the active item and reports snap mode", () => {
    const code = readSource();
    expect(code).toContain("getCatalogueItem");
    expect(code).toContain("selectedItem?.name");
    expect(code).toContain("snapEnabled");
    expect(code).toContain("Grid snap is on");
    expect(code).toContain("Free placement is on");
  });

  it("returns null when inactive or dismissed reason-free", () => {
    const code = readSource();
    expect(code).toContain("if (suppressedForViewport || !isActive) return null");
    expect(code).toContain("if (!showShortcutCoach && shownReason === null) return null");
  });
});
