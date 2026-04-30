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
    expect(code).toContain("localStorage");
    expect(code).toContain("dismissed");
    expect(code).toContain("handleDismiss");
  });

  it("keeps desktop keyboard shortcuts; mobile uses the planner dock instead", () => {
    const code = readSource();
    expect(code).toContain("Click");
    expect(code).toContain("Rotate");
    expect(code).toContain("Esc");
    expect(code).toContain("isTouch || isNarrow");
  });

  it("has enter/exit animations", () => {
    const code = readSource();
    expect(code).toContain("omni-hint-in");
    expect(code).toContain("omni-hint-out");
  });

  it("shows invalid placement reason with shake animation", () => {
    const code = readSource();
    expect(code).toContain("omni-hint-shake");
    expect(code).toContain("shownReason");
  });

  it("auto-clears reason after timeout", () => {
    const code = readSource();
    expect(code).toContain("setTimeout");
    expect(code).toContain("clearTimeout");
    expect(code).toContain("reasonTimerRef");
  });

  it("returns null when not mounted (no unnecessary DOM)", () => {
    const code = readSource();
    expect(code).toContain("if (!mounted) return null");
  });
});
