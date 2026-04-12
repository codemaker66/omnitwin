// ---------------------------------------------------------------------------
// SceneProvider (#24, part 2/3) — source-grep tripwire
//
// SceneProvider bridges the Three.js scene ref from inside the R3F Canvas
// to the Zustand editor-store so non-Canvas code (SaveSendPanel, ortho
// capture) can access the scene for floor plan rendering.
//
// These tests pin three structural properties:
//   1. SceneProvider exists and calls useThree to get the scene
//   2. SceneProvider writes to editor-store (setState)
//   3. App.tsx mounts <SceneProvider /> inside the Canvas
//
// Behavioural testing would require a real R3F Canvas context; happy-dom
// has no WebGL. Source-grep is the established pattern.
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

describe("SceneProvider wiring (#24, part 2/3)", () => {
  it("SceneProvider calls useThree to get the scene", async () => {
    const { codeOnly } = await readSource("src/components/SceneProvider.tsx");
    expect(codeOnly).toContain("useThree");
    expect(codeOnly).toContain("scene");
  });

  it("SceneProvider writes scene to editor-store", async () => {
    const { codeOnly } = await readSource("src/components/SceneProvider.tsx");
    expect(codeOnly).toContain("useEditorStore.setState");
    expect(codeOnly).toMatch(/setState\(\{[\s\S]*?scene/);
  });

  it("SceneProvider clears scene on unmount", async () => {
    const { codeOnly } = await readSource("src/components/SceneProvider.tsx");
    // The cleanup function must set scene back to null
    expect(codeOnly).toMatch(/return\s*\(\)\s*=>\s*\{[\s\S]*?scene:\s*null/);
  });

  it("App.tsx imports and mounts SceneProvider inside the Canvas", async () => {
    const { codeOnly } = await readSource("src/App.tsx");
    expect(codeOnly).toContain("SceneProvider");
    expect(codeOnly).toContain("<SceneProvider");
  });

  it("editor-store has a scene field typed as Scene | null", async () => {
    const { codeOnly } = await readSource("src/stores/editor-store.ts");
    expect(codeOnly).toMatch(/scene:\s*Scene\s*\|\s*null/);
  });
});
