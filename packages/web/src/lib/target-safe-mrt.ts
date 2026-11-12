// ---------------------------------------------------------------------------
// A material's own pass outputs, drawn into any target
//
// three r186 writes only the outputs a draw's target names (MRTNode.setup).
// The scene pass names its own (output, plus normal and velocity as the
// profile asks: components/scene/PlannerRenderPipeline.tsx) and, where it has
// an MRT, merges a material's outputs into it, as before. Drawn where the
// renderer has no MRT, a material's outputs (material.mrtNode) stand alone
// (NodeMaterial.setup): the plan snapshot sent with a layout
// (lib/ortho-capture.ts) and the current-view snapshot
// (lib/native-current-view-capture.ts) draw into a target whose one texture
// has no name, so the panes, the street's light and the floor marks kept
// none of their members, three wrote `struct OutputType { }`, and WebGPU
// refused the pipeline: with the sky on, the plan came back blank (4 Nov
// 2026). Drawn into a target that names none of them, these outputs write
// their colour into its first texture, as a material without outputs of its
// own would. (The snapshots also draw with the renderer's MRT cleared.)
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
