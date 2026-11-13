import { useMemo, type ReactElement } from "react";
import { RENDER_SCALE } from "../../constants/scale.js";
import { chosenMarks, type ChosenMark } from "../../lib/chosen-mark.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";

// ---------------------------------------------------------------------------
// ChosenMarks — the line on the floor round what is chosen (lib/chosen-mark).
//
// One thin pale line lying on the floor, so the furniture standing on it
// covers it as it would a line of tape: the mark is in the room, not on the
// screen. It is the night's own pale ink (the top bar's words), unlit, so it
// reads the same in every light.
// ---------------------------------------------------------------------------

/** The line's width on the floor, metres: about two pixels from the stage's camera. */
const LINE_M = 0.035;
/** Above the floor by less than a chair's glide, clear of the floor's own depth. */
const LIFT_M = 0.012;
/** The top bar's ink on the night (--hud-night-ink). */
const LINE_COLOUR = "#ece7dd";
const RING_SEGMENTS = 128;

function Line({ width, depth, x, z }: { readonly width: number; readonly depth: number; readonly x: number; readonly z: number }): ReactElement {
  return (
    <mesh position={[x, 0, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => undefined}>
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial color={LINE_COLOUR} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

function Mark({ mark }: { readonly mark: ChosenMark }): ReactElement {
  const line = LINE_M * RENDER_SCALE;
  const position: readonly [number, number, number] = [mark.x * RENDER_SCALE, LIFT_M, mark.z * RENDER_SCALE];
  if (mark.kind === "ring") {
    const radius = mark.radius * RENDER_SCALE;
    return (
      <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} raycast={() => undefined}>
        <ringGeometry args={[radius - line / 2, radius + line / 2, RING_SEGMENTS]} />
        <meshBasicMaterial color={LINE_COLOUR} toneMapped={false} depthWrite={false} />
      </mesh>
    );
  }
  const halfW = mark.halfW * RENDER_SCALE;
  const halfD = mark.halfD * RENDER_SCALE;
  return (
    <group position={position}>
      <Line width={2 * halfW + line} depth={line} x={0} z={-halfD} />
      <Line width={2 * halfW + line} depth={line} x={0} z={halfD} />
      <Line width={line} depth={2 * halfD - line} x={-halfW} z={0} />
      <Line width={line} depth={2 * halfD - line} x={halfW} z={0} />
    </group>
  );
}

export function ChosenMarks(): ReactElement | null {
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const placedItems = usePlacementStore((state) => state.placedItems);
  const marks = useMemo(() => chosenMarks(selectedIds, placedItems), [selectedIds, placedItems]);
  if (marks.length === 0) return null;
  return (
    <group name="chosen-marks">
      {marks.map((mark) => <Mark key={mark.key} mark={mark} />)}
    </group>
  );
}
