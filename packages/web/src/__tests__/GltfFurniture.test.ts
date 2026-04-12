// ---------------------------------------------------------------------------
// GltfFurniture / model pipeline (#28) — source-grep tripwire
//
// The asset pipeline lets catalogue items optionally specify a .glb model
// URL. When meshUrl is non-null, GltfFurniture loads the model via drei's
// useGLTF. When null, the existing procedural mesh renders as the fallback.
//
// These tests pin four structural properties:
//   1. CatalogueItem has the meshUrl field
//   2. All catalogue items have meshUrl (even if null — proves the field
//      was added to every entry, not just the interface)
//   3. FurnitureProxy checks meshUrl and renders GltfFurniture when non-null
//   4. GltfFurniture uses useGLTF for model loading
//
// Behavioural testing would require a real WebGL context and a .glb file.
// Source-grep is the right tool here.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { CATALOGUE_ITEMS } from "../lib/catalogue.js";

async function readSource(relPath: string): Promise<{ raw: string; codeOnly: string }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const raw = await fs.readFile(path.resolve(relPath), "utf-8");
  const codeOnly = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  return { raw, codeOnly };
}

describe("CatalogueItem meshUrl field (#28)", () => {
  it("CatalogueItem interface declares meshUrl: string | null", async () => {
    const { codeOnly } = await readSource("src/lib/catalogue.ts");
    expect(codeOnly).toMatch(/meshUrl:\s*string\s*\|\s*null/);
  });

  it("every catalogue item has a meshUrl field", () => {
    for (const item of CATALOGUE_ITEMS) {
      expect(item).toHaveProperty("meshUrl");
    }
  });

  it("all current items have meshUrl: null (procedural fallback)", () => {
    for (const item of CATALOGUE_ITEMS) {
      expect(item.meshUrl).toBeNull();
    }
  });
});

describe("FurnitureProxy glTF routing (#28)", () => {
  it("imports GltfFurniture", async () => {
    const { codeOnly } = await readSource("src/components/FurnitureProxy.tsx");
    expect(codeOnly).toContain("GltfFurniture");
    expect(codeOnly).toMatch(/import[\s\S]*?GltfFurniture[\s\S]*?from/);
  });

  it("checks item.meshUrl before rendering", async () => {
    const { codeOnly } = await readSource("src/components/FurnitureProxy.tsx");
    expect(codeOnly).toContain("item.meshUrl");
  });

  it("wraps GltfFurniture in Suspense with procedural fallback", async () => {
    const { codeOnly } = await readSource("src/components/FurnitureProxy.tsx");
    expect(codeOnly).toContain("<Suspense");
    expect(codeOnly).toContain("fallback={procedural}");
  });

  it("renders procedural mesh directly when meshUrl is null", async () => {
    const { codeOnly } = await readSource("src/components/FurnitureProxy.tsx");
    // The ternary: meshUrl !== null ? <Suspense>...<GltfFurniture/> : procedural
    expect(codeOnly).toMatch(/meshUrl\s*!==\s*null\s*\?/);
  });
});

describe("GltfFurniture component (#28)", () => {
  it("uses drei useGLTF for model loading", async () => {
    const { codeOnly } = await readSource("src/components/meshes/GltfFurniture.tsx");
    expect(codeOnly).toContain("useGLTF");
    expect(codeOnly).toMatch(/import[\s\S]*?useGLTF[\s\S]*?from[\s\S]*?@react-three\/drei/);
  });

  it("scales the model to fit catalogue dimensions", async () => {
    const { codeOnly } = await readSource("src/components/meshes/GltfFurniture.tsx");
    expect(codeOnly).toContain("Box3");
    expect(codeOnly).toContain("toRenderSpace");
    expect(codeOnly).toContain("uniformScale");
  });

  it("clones the scene for per-instance material overrides", async () => {
    const { codeOnly } = await readSource("src/components/meshes/GltfFurniture.tsx");
    expect(codeOnly).toContain("gltfScene.clone(");
  });

  it("applies clipping planes to loaded materials", async () => {
    const { codeOnly } = await readSource("src/components/meshes/GltfFurniture.tsx");
    expect(codeOnly).toContain("noClipPlanes");
    expect(codeOnly).toContain("clippingPlanes");
  });
});
