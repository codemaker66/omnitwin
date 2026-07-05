import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Mesh, Vector3 } from "three";
import type { TwinScanNode } from "@omnitwin/types";
import { e57PointToThree } from "./twin-basis.js";
import { pickTravelTarget, travelKeyToDirection } from "./travel.js";

// -----------------------------------------------------------------------------
// TravelControls — Street View movement for the walk.
//
// Click anywhere: the pointed direction picks the best neighbouring scan node
// (travel cone) and you go there. WASD / arrows: travel relative to where the
// camera faces — W forward, S back, A/D strafe. A soft gold reticle sits on
// the floor at whichever node the pointer currently aims at, so the click's
// destination is always visible before committing (what you see is where you
// go). Drags never travel: WalkControls owns drags; the 4 px guard here
// separates a click from a drag release, mirroring NavMarkers.
//
// Correction plan: docs/superpowers/plans/2026-07-02-twin-walk-correction.md
// (workstream B).
// -----------------------------------------------------------------------------

/** Clicks that moved further than this are drags, not travel intents. */
const CLICK_SLOP_PX = 4;
/** Reticle floats just above the floor plane to avoid z-fighting the ring. */
const RETICLE_FLOOR_OFFSET_M = 1.32;

export interface TravelControlsProps {
  readonly enabled: boolean;
  readonly currentNode: TwinScanNode;
  readonly neighbors: readonly string[];
  readonly nodesById: ReadonlyMap<string, TwinScanNode>;
  readonly onTravel: (id: string) => void;
}

const scratchDir = new Vector3();

export function TravelControls({
  enabled,
  currentNode,
  neighbors,
  nodesById,
  onTravel,
}: TravelControlsProps): React.JSX.Element | null {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const reticleRef = useRef<Mesh | null>(null);
  const aimedTargetRef = useRef<string | null>(null);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const element = gl.domElement;
    const here = e57PointToThree(currentNode.pose.t);

    const pointedDirection = (clientX: number, clientY: number): Vector3 => {
      const rect = element.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
      return scratchDir
        .set(ndcX, ndcY, 0.5)
        .unproject(camera)
        .sub(camera.position)
        .normalize();
    };

    const updateReticle = (targetId: string | null): void => {
      aimedTargetRef.current = targetId;
      const reticle = reticleRef.current;
      if (reticle === null) {
        return;
      }
      if (targetId === null) {
        if (reticle.visible) {
          reticle.visible = false;
          invalidate();
        }
        return;
      }
      const node = nodesById.get(targetId);
      if (node === undefined) {
        return;
      }
      const p = e57PointToThree(node.pose.t);
      reticle.position.set(p[0], p[1] - RETICLE_FLOOR_OFFSET_M, p[2]);
      reticle.visible = true;
      invalidate();
    };

    const onPointerMove = (event: PointerEvent): void => {
      // Reticle only for a hovering mouse — during drags the aim is a look.
      if (event.buttons !== 0) {
        updateReticle(null);
        return;
      }
      const dir = pointedDirection(event.clientX, event.clientY);
      updateReticle(
        pickTravelTarget(here, [dir.x, dir.y, dir.z], neighbors, nodesById),
      );
    };

    const onPointerDown = (event: PointerEvent): void => {
      downPosRef.current = { x: event.clientX, y: event.clientY };
    };

    const onClick = (event: MouseEvent): void => {
      const down = downPosRef.current;
      downPosRef.current = null;
      if (
        down !== null &&
        Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_SLOP_PX
      ) {
        return; // a look-drag release, not a travel intent
      }
      const dir = pointedDirection(event.clientX, event.clientY);
      const target = pickTravelTarget(
        here,
        [dir.x, dir.y, dir.z],
        neighbors,
        nodesById,
      );
      if (target !== null) {
        onTravel(target);
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable ||
          // The minimap listbox owns its own arrow-key navigation.
          active.getAttribute("role") === "listbox")
      ) {
        return;
      }
      const move = travelKeyToDirection(event.key);
      if (move === null) {
        return;
      }
      event.preventDefault();
      camera.getWorldDirection(scratchDir);
      const fx = scratchDir.x;
      const fz = scratchDir.z;
      const flat = Math.hypot(fx, fz);
      if (flat < 1e-6) {
        return;
      }
      // Horizontal camera basis: forward (fx,fz); right = (-fz, fx) (y-up).
      const dirX = (fx / flat) * move.forward + (-fz / flat) * -move.right;
      const dirZ = (fz / flat) * move.forward + (fx / flat) * -move.right;
      const target = pickTravelTarget(here, [dirX, 0, dirZ], neighbors, nodesById);
      if (target !== null) {
        onTravel(target);
      }
    };

    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("click", onClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, gl, camera, invalidate, currentNode, neighbors, nodesById, onTravel]);

  if (!enabled) {
    return null;
  }
  return (
    <mesh ref={reticleRef} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.5, 0.62, 40]} />
      {/* 0.75 — present enough to promise the destination, under the rings'
          full-hover 1.0 so the committed target always reads brightest. */}
      <meshBasicMaterial color="#d7a64b" transparent opacity={0.75} depthWrite={false} />
    </mesh>
  );
}
