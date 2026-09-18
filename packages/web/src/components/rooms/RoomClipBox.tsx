import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { createNativeRoomClip } from "../../lib/native-splat-merge.js";
import { nativeSplatScene } from "../../lib/native-splat-scene.js";

// ---------------------------------------------------------------------------
// Apply an explicitly qualified room-containment box.
//
// A handheld capture contains far more than the room: the corridor walked in
// from, the stair, sometimes a whole other storey. Standing inside the room
// hides that, but it also means you can never step back and look at the room
// as an object — pull the camera out and you are looking at a smear of
// building with a room somewhere inside it.
//
// This primitive multiplies splat alpha by a box SDF for an explicit cutaway.
// Its caller must independently establish that the box contains every surface
// to retain. A generated bundle's extent can come from the scanner's walk
// (tools/xgrids-lcc2/src/cli.ts), which lies inside the walls and is only suitable
// for camera movement bounds. Applying that extent here can erase the walls.
//
// The box is in scene space, centred in x/z with its floor at y = 0. One edit
// covers every tile at once. Public interior walks do not apply this primitive.
// ---------------------------------------------------------------------------

export interface RoomClipBoxProps {
  /** Independently qualified containment extent: width, height, depth, in metres.
   * Scanner-walk or camera-movement bounds are not suitable containment bounds. */
  readonly extentM: readonly [number, number, number];
  /**
   * Padding beyond the qualified containment box. Padding cannot turn a
   * scanner-walk extent into a verified architectural boundary.
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
    const owner = {};
    const runtime = nativeSplatScene(scene);
    runtime.setClip(owner, createNativeRoomClip(extentM, marginM, softEdgeM, keepHeightFraction));
    invalidate();

    return () => {
      runtime.clearClip(owner);
      invalidate();
    };
  }, [extentM, marginM, softEdgeM, keepHeightFraction, scene, invalidate]);

  return null;
}
