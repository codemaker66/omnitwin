import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import {
  SplatEdit,
  SplatEditRgbaBlendMode,
  SplatEditSdf,
  SplatEditSdfType,
} from "@sparkjsdev/spark";

// ---------------------------------------------------------------------------
// Clip a captured room to its own measured box.
//
// A handheld capture contains far more than the room: the corridor walked in
// from, the stair, sometimes a whole other storey. Standing inside the room
// hides that, but it also means you can never step back and look at the room
// as an object — pull the camera out and you are looking at a smear of
// building with a room somewhere inside it.
//
// So instead of avoiding the outside, remove it. Spark can multiply a splat's
// alpha by an SDF region, so an inverted box over the measured room erases
// everything beyond the walls. The camera is then free to pull back into a
// dollhouse view, and what it frames is only ever this room.
//
// The edit is added to the scene rather than to a mesh: the room's box is
// known in scene space (the generated transform centres every room on the
// origin with its floor at y = 0), and one edit then covers every tile at once.
// ---------------------------------------------------------------------------

export interface RoomClipBoxProps {
  /** Room extent in scene axes: width, height, depth, in metres. */
  readonly extentM: readonly [number, number, number];
  /**
   * Grown slightly past the measured walls so the clip does not shave the
   * wall surface itself, which is the part people actually look at.
   */
  readonly marginM?: number;
  /** Feathering on the cut, in metres, so the boundary is not a razor edge. */
  readonly softEdgeM?: number;
  /**
   * Fraction of the room's height to keep, measured from the floor.
   *
   * 1 keeps the ceiling, which is right when standing inside. Looking in from
   * outside it is wrong: a scanner only ever saw the underside of a ceiling, so
   * from above the room is a closed lid of noise. Cutting the top off is what
   * turns a sealed box into a dollhouse you can see into.
   */
  readonly keepHeightFraction?: number;
}

export function RoomClipBox({
  extentM,
  marginM = 0.35,
  softEdgeM = 0.12,
  keepHeightFraction = 1,
}: RoomClipBoxProps): null {
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const [width, fullHeight, depth] = extentM;
    if (!(width > 0 && fullHeight > 0 && depth > 0)) return;
    const height = fullHeight * Math.min(Math.max(keepHeightFraction, 0.1), 1);

    // invert: the region acted on is everything OUTSIDE the box.
    // opacity 0 with MULTIPLY: alpha there becomes zero, so it is gone.
    const sdf = new SplatEditSdf({
      type: SplatEditSdfType.BOX,
      invert: true,
      opacity: 0,
    });
    // Sit the box on the floor and let its top land at the kept height, so
    // trimming the ceiling never lifts the floor with it.
    const halfHeight = height / 2;
    sdf.position.set(0, halfHeight, 0);
    sdf.scale.set(
      width / 2 + marginM,
      halfHeight + (keepHeightFraction >= 1 ? marginM : 0),
      depth / 2 + marginM,
    );

    const edit = new SplatEdit({
      name: "room-clip",
      rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY,
      softEdge: softEdgeM,
      sdfs: [sdf],
    });
    edit.add(sdf);
    scene.add(edit);
    invalidate();

    return () => {
      scene.remove(edit);
      edit.remove(sdf);
      invalidate();
    };
  }, [extentM, marginM, softEdgeM, keepHeightFraction, scene, invalidate]);

  return null;
}
