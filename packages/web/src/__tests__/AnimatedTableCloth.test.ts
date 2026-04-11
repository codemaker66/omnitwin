// ---------------------------------------------------------------------------
// AnimatedTableCloth (#17) — ref pattern + GPU lifecycle tripwire
//
// Two coupled bugs fixed by switching from a ref callback to a direct
// useRef + cleanup effect:
//
// 1. The original code used `ref={(mesh) => { if (mesh !== null) {
//    geomRef.current = mesh.geometry; } }}`. The callback ignored the
//    null branch (unmount), leaving geomRef pointing at a disposed
//    BufferGeometry. The arrow form also re-created the function on every
//    parent render, triggering React's "old null + new value" callback
//    sequence even though nothing changed. The whole callback existed
//    only to cache `mesh.geometry`, which is a single property access \u2014
//    no caching needed.
//
//    Fix: direct `useRef<Mesh | null>` on the mesh, read geometry via
//    `meshRef.current?.geometry` in the useFrame loop. R3F manages
//    attachment and clears meshRef.current on unmount automatically.
//
// 2. The `initialGeom` BufferGeometry was created via useMemo but never
//    disposed. Three.js does not garbage-collect GPU resources \u2014 every
//    cloth animation accumulated VRAM until the tab crashed. The fix is
//    a useEffect cleanup keyed on initialGeom that calls dispose().
//
// These properties can't be tested behaviourally because happy-dom has no
// WebGL context \u2014 source-grep is the established pattern (#11/#12/#13/
// #14/#15).
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

describe("AnimatedTableCloth (#17) — ref + GPU lifecycle tripwire", () => {
  const SRC = "src/components/meshes/AnimatedTableCloth.tsx";

  it("imports Mesh from three", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toMatch(/import\s+\{[\s\S]*?\bMesh\b[\s\S]*?\}\s+from\s+["']three["']/);
  });

  it("declares meshRef as a direct useRef<Mesh | null>", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toMatch(/useRef<Mesh\s*\|\s*null>/);
    expect(codeOnly).toContain("meshRef");
  });

  it("binds the mesh ref directly (no callback wrapper)", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("ref={meshRef}");
  });

  it("does NOT use the legacy ref-callback pattern", async () => {
    const { codeOnly } = await readSource(SRC);
    // The original bug: an inline arrow ref that captured mesh.geometry
    // into a separate ref. Comments stripped before this negative check
    // so the test file and the component itself can still mention the
    // legacy pattern in comments for context.
    expect(codeOnly).not.toMatch(/ref=\{\s*\(mesh\)\s*=>/);
    expect(codeOnly).not.toContain("geomRef.current = mesh.geometry");
    expect(codeOnly).not.toContain("geomRef");
  });

  it("reads geometry through meshRef.current?.geometry in the useFrame loop", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("meshRef.current?.geometry");
  });

  it("disposes the BufferGeometry on unmount via a useEffect cleanup", async () => {
    const { codeOnly } = await readSource(SRC);
    // The cleanup effect must call initialGeom.dispose() inside a return
    // function. Pin the structural shape with a multiline regex.
    expect(codeOnly).toMatch(/useEffect\([\s\S]{0,300}?return\s*\(\)\s*=>\s*\{\s*initialGeom\.dispose\(\)/);
  });
});
