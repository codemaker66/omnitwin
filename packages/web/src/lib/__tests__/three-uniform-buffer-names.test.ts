import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Our three patch (patches/three@0.186.0.patch) names each uniform buffer by the order its shader
// declares it. Unpatched, three r186 names it after its node id, so every InstancedMesh's vertex
// shader is its own code (its instance-matrix buffer is a node of its own) and compiles on its own:
// the first piece of a kind set down, and every pool that grows, stalled a frame. Numbered per
// shader, meshes drawn with one material share one program, a shader holding two buffers (the
// table candles, the contact shadows) still names them apart, and a batch warmed while a piece is
// in hand (components/WarmPlacedVariants.tsx) is the one the drop draws. A three upgrade or a lost
// patch fails here rather than bringing the compiles back unnoticed.

const require = createRequire(import.meta.url);

const PATCHED = "uniformNode.name = name ? name : 'NodeBuffer_' + ( this.nodeBufferDeclarations = ( this.nodeBufferDeclarations || 0 ) + 1 );";
const UNPATCHED = "uniformNode.name = name ? name : 'NodeBuffer_' + uniformNode.id;";

describe("three's WGSL uniform buffer names", () => {
  it.each(["three/webgpu", "three/src/renderers/webgpu/nodes/WGSLNodeBuilder.js"])("are numbered per shader in %s", (entry) => {
    const source = readFileSync(require.resolve(entry), "utf8");
    expect(source.split(PATCHED)).toHaveLength(2);
    expect(source).not.toContain(UNPATCHED);
  });
});
