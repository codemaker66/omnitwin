import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Our three patch (patches/three@0.186.0.patch) names the instance-matrix buffer every
// InstancedMesh reads. Unnamed, three r186 names it after its node id, so each mesh's vertex
// shader is its own code and compiles on its own: the first piece of a kind set down, and every
// pool that grows, stalled a frame. Named, they share one program, and a batch warmed while a
// piece is in hand (components/WarmPlacedVariants.tsx) is the one the drop draws. A three upgrade
// or a lost patch fails here rather than bringing the compiles back unnoticed.

const require = createRequire(import.meta.url);

/** The body of three's createInstanceMatrixNode in the file `entry` resolves to. */
function createInstanceMatrixNode(entry: string): string {
  const source = readFileSync(require.resolve(entry), "utf8");
  const start = source.indexOf("function createInstanceMatrixNode(");
  if (start < 0) throw new Error(`createInstanceMatrixNode is not in ${entry}`);
  const end = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

describe("three's instance-matrix buffer", () => {
  it.each(["three/webgpu", "three/src/nodes/accessors/Instance.js"])("is named once for every mesh in %s", (entry) => {
    const body = createInstanceMatrixNode(entry);
    expect(body).toContain("buffer( instanceMatrix.array, 'mat4', matrixCount ).setName( 'instanceMatrices' )");
    expect(body).not.toMatch(/buffer\( instanceMatrix\.array, 'mat4', matrixCount \)\.element\(/);
  });
});
