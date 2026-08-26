import { useCallback, useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Mesh, Vector3 } from "three";
import type { TwinScanNode } from "@omnitwin/types";
import { e57PointToThree } from "./twin-basis.js";
import { prefersReducedMotion } from "./reduced-motion.js";
import { pickTravelTarget, travelKeyToDirection, WASD_CONE_COS } from "./travel.js";
import type { GlideNextPicker } from "./useTwinGlide.js";

// -----------------------------------------------------------------------------
// TravelControls — Street View + game-walk movement for the walk.
//
// Click anywhere: the pointed direction picks the best neighbouring scan node
// (travel cone) and you go there. WASD / arrows: travel relative to where the
// camera faces — W forward, S back, A/D strafe. HOLD a direction and the walk
// chains node-to-node (hold-to-walk): a fresh glide begins the instant the
// previous one settles, so a held key flows you through the room like a game
// rather than tap-once-step-once. A soft gold reticle sits on the floor at
// whichever node the pointer aims at, so the click's destination is always
// visible before committing. Drags never travel: WalkControls owns drags; the
// 4 px guard separates a click from a drag release, mirroring NavMarkers.
//
// Held-key tracking lives in its own effect keyed only on `enabled`, so it
// survives the per-node re-subscription of the pointer effect — a keyup is
// never dropped while walking. The continue-on-settle effect fires the next
// step whenever the walk goes idle with a key still down; because hopTo turns
// `hopping` true synchronously it self-rate-limits to one glide at a time.
// Reduced motion opts out of chaining (hops there are instant — auto-chaining
// would be a runaway) so a keypress is a single discrete step.
//
// Correction plan: docs/superpowers/plans/2026-07-02-twin-walk-correction.md
// (workstream B); hold-to-walk + eased glide 2026-07-05.
// -----------------------------------------------------------------------------

/** Clicks that moved further than this are drags, not travel intents. */
const CLICK_SLOP_PX = 4;
/** Reticle floats just above the floor plane to avoid z-fighting the ring. */
const RETICLE_FLOOR_OFFSET_M = 1.32;

export interface TravelControlsProps {
  readonly enabled: boolean;
  /** True while a hop is in flight — suppresses click-travel and the reticle;
   *  a held key resumes gliding the instant this clears. */
  readonly hopping: boolean;
  readonly currentNode: TwinScanNode;
  readonly neighbors: readonly string[];
  /** Nav-graph partners of ANY node — the extension picker steps off the
   *  route's tail, which mid-glide is not the committed current node. */
  readonly neighborsOf: (id: string) => readonly string[];
  readonly nodesById: ReadonlyMap<string, TwinScanNode>;
  readonly onTravel: (id: string) => void;
  /** Hold-to-walk intent: true while any travel key is down. The glide keeps
   *  extending while held and eases out onto a node on release. */
  readonly onHoldChange: (held: boolean) => void;
  /** Hands the glide the camera-relative travel cone so a held ride can keep
   *  growing its route; returns the unregister. */
  readonly registerNextPicker: (picker: GlideNextPicker) => () => void;
}

const scratchDir = new Vector3();

/** Does focus sit on a control that owns the keyboard (typing / the minimap)? */
function keyboardBusy(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.isContentEditable ||
      active.getAttribute("role") === "listbox")
  );
}

export function TravelControls({
  enabled,
  hopping,
  currentNode,
  neighbors,
  neighborsOf,
  nodesById,
  onTravel,
  onHoldChange,
  registerNextPicker,
}: TravelControlsProps): React.JSX.Element | null {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const reticleRef = useRef<Mesh | null>(null);
  const aimedTargetRef = useRef<string | null>(null);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const heldKeysRef = useRef<string[]>([]);
  const hoppingRef = useRef(hopping);
  hoppingRef.current = hopping;

  // The node departed on the previous step — excluded from hold-to-walk target
  // selection so the wide WASD cone can never bounce you back the way you came.
  // Tracked during render: when currentNode changes, the old id becomes "prev".
  const curNodeIdRef = useRef(currentNode.id);
  const prevNodeIdRef = useRef<string | null>(null);
  if (curNodeIdRef.current !== currentNode.id) {
    prevNodeIdRef.current = curNodeIdRef.current;
    curNodeIdRef.current = currentNode.id;
  }

  // Travel one step in a key's camera-relative direction. Recomputed from the
  // LIVE camera facing + current node each call, so steering while walking
  // works. Held by a ref (below) so the stable key-listener always calls the
  // freshest closure without re-subscribing. Uses the wide WASD cone so a held
  // key follows corridor bends, excluding the node just departed.
  const stepInDirection = useCallback(
    (key: string): void => {
      const move = travelKeyToDirection(key);
      if (move === null) {
        return;
      }
      const here = e57PointToThree(currentNode.pose.t);
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
      const target = pickTravelTarget(
        here,
        [dirX, 0, dirZ],
        neighbors,
        nodesById,
        WASD_CONE_COS,
        prevNodeIdRef.current,
      );
      if (target !== null) {
        onTravel(target);
      }
    },
    [camera, currentNode, neighbors, nodesById, onTravel],
  );
  const stepRef = useRef(stepInDirection);
  stepRef.current = stepInDirection;

  // Pointer effect: reticle preview + click-to-travel. Re-subscribes per node
  // (its closure needs fresh here/neighbors); suppressed mid-hop via the ref.
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
      // Reticle only for a hovering mouse over a still camera — during drags
      // the aim is a look, and mid-hop the destination is already committed.
      if (event.buttons !== 0 || hoppingRef.current) {
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
      if (hoppingRef.current) {
        return; // already gliding — ignore clicks until we arrive
      }
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

    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("click", onClick);
    return () => {
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("click", onClick);
    };
  }, [enabled, gl, camera, invalidate, currentNode, neighbors, nodesById, onTravel]);

  // Held-key tracking + first step. Stable (keyed on `enabled` only) so a
  // keyup is never dropped across the pointer effect's per-node churn. The
  // hold intent reaches the glide the moment the FIRST key lands and clears
  // when the LAST lifts — that edge is what turns "extend the ride" into
  // "ease out onto a node".
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (travelKeyToDirection(event.key) === null || keyboardBusy()) {
        return;
      }
      event.preventDefault();
      if (!heldKeysRef.current.includes(event.key)) {
        if (heldKeysRef.current.length === 0) {
          onHoldChange(true);
        }
        heldKeysRef.current.push(event.key);
      }
      // Fire only on the true first press; OS auto-repeat is ignored — the
      // glide's own extension (and the continue-on-stop effect) drive every
      // subsequent metre.
      if (!event.repeat) {
        stepRef.current(event.key);
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      const before = heldKeysRef.current.length;
      heldKeysRef.current = heldKeysRef.current.filter((k) => k !== event.key);
      if (before > 0 && heldKeysRef.current.length === 0) {
        onHoldChange(false);
      }
    };
    const clearHeld = (): void => {
      if (heldKeysRef.current.length > 0) {
        onHoldChange(false);
      }
      heldKeysRef.current = [];
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    // Focus loss (alt-tab, click-away) must not leave a key "stuck down".
    window.addEventListener("blur", clearHeld);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearHeld);
      clearHeld();
    };
  }, [enabled, onHoldChange]);

  // The extension picker: while a ride is held, the glide asks — from the
  // route's TAIL, not the committed node — for the next scan in the held
  // key's camera-relative direction. Registered whenever travel is enabled;
  // the glide only consults it while held, so idle registration is inert.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const picker: GlideNextPicker = (fromId, prevId) => {
      const key = heldKeysRef.current[heldKeysRef.current.length - 1];
      if (key === undefined) {
        return null;
      }
      const move = travelKeyToDirection(key);
      const from = nodesById.get(fromId);
      if (move === null || from === undefined) {
        return null;
      }
      camera.getWorldDirection(scratchDir);
      const fx = scratchDir.x;
      const fz = scratchDir.z;
      const flat = Math.hypot(fx, fz);
      if (flat < 1e-6) {
        return null;
      }
      const dirX = (fx / flat) * move.forward + (-fz / flat) * -move.right;
      const dirZ = (fz / flat) * move.forward + (fx / flat) * -move.right;
      return pickTravelTarget(
        e57PointToThree(from.pose.t),
        [dirX, 0, dirZ],
        neighborsOf(fromId),
        nodesById,
        WASD_CONE_COS,
        prevId,
      );
    };
    return registerNextPicker(picker);
  }, [enabled, camera, nodesById, neighborsOf, registerNextPicker]);

  // Continue-on-settle: when the walk goes idle with a key still held, begin
  // the next glide in the freshest facing direction. Runs on arrival (current
  // node changes) and whenever `hopping` clears. Opted out under reduced
  // motion (instant hops would chain into a runaway).
  useEffect(() => {
    if (!enabled || hopping || prefersReducedMotion()) {
      return;
    }
    const held = heldKeysRef.current;
    const key = held[held.length - 1];
    if (key !== undefined) {
      stepRef.current(key);
    }
  }, [enabled, hopping, currentNode, neighbors]);

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
