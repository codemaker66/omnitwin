// ---------------------------------------------------------------------------
// A material's own pass outputs, drawn into any target
//
// three r186 writes only the outputs a draw's target names (MRTNode.setup),
// and a material's own outputs (material.mrtNode) stand alone wherever the
// renderer has none set. The scene pass names its targets (output, normal,
// velocity: components/scene/PlannerRenderPipeline.tsx) and merges a
// material's outputs into its own there, as before. A snapshot draws into a
// target of its own whose one texture has no name (lib/ortho-capture.ts, the
// plan sent with a layout; lib/native-current-view-capture.ts), and the
// hall's reflection capture into PMREM's cube ("PMREM.cubeUv"): those
// outputs kept none of their members, three wrote `struct OutputType { }`,
// and WebGPU refused the pipeline, so with the sky on the plan came back
// blank (4 Nov 2026). Drawn into a target that names none of them, these
// outputs write their colour into its first texture, as a material without
// outputs of its own would.
// ---------------------------------------------------------------------------

import { MRTNode, type Node, type NodeBuilder } from "three/webgpu";

type Outputs = Record<string, Node>;

/**
 * What `own` writes into a target whose textures are named `textures`: `own`
 * itself where the target names any of them, otherwise its colour alone, into
 * the first texture. Without a texture or a colour, three's own behaviour.
 */
export function outputsForTarget(own: Outputs, textures: readonly string[]): Outputs {
  const colour = own["output"];
  const first = textures[0];
  if (colour === undefined || first === undefined || textures.some((name) => Object.hasOwn(own, name))) return own;
  return { [first]: colour };
}

/** Outputs that fall back to their colour where a draw's target names none of them. */
export class TargetSafeMRTNode extends MRTNode {
  override setup(builder: NodeBuilder): Node | null | undefined {
    const own = this.outputNodes;
    const target = builder.renderer.getRenderTarget();
    // Only while three picks the members: the scene pass's merge and the next draw read `own`.
    this.outputNodes = outputsForTarget(own, target === null ? [] : target.textures.map((texture) => texture.name));
    try {
      return super.setup(builder);
    } finally {
      this.outputNodes = own;
    }
  }
}

/** `mrt(outputs)` for a material's own outputs (`material.mrtNode`), safe in any target. */
export function targetSafeMrt(outputs: Outputs): MRTNode {
  return new TargetSafeMRTNode(outputs);
}
