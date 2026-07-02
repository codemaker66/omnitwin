import { useEffect, useRef, useState, type ReactElement } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import type { Group, MeshBasicMaterial } from "three";
import type { TwinScanNode } from "@omnitwin/types";
import {
  isSpringSettled,
  stepSpring,
  type SpringConfig,
  type SpringState,
} from "../lib/springs.js";
import { e57PointToThree } from "./twin-basis.js";

// -----------------------------------------------------------------------------
// NavMarkers — one flat gold ring on the floor per walkable neighbor.
//
// Each ring sits 1.35 m below its scan node's tripod pose (roughly floor
// level under the neighboring pano) and carries an invisible, larger hit disc
// so clicks are forgiving. Hover runs a spring-driven pulse — scale and
// opacity ride a single 0→1 hover spring (springs, never tweens) — and sets
// the document cursor to a pointer, restored on out and on unmount.
//
// Plan: docs/superpowers/plans/2026-07-02-twin-phase1-walk.md (Task 9).
// -----------------------------------------------------------------------------

/** Flame-gold ring colour (Rite palette --gold). */
export const NAV_MARKER_COLOR = "#d7a64b";
export const NAV_MARKER_IDLE_OPACITY = 0.75;
/** Metres below the scan pose the ring sits — tripod height, roughly. */
export const NAV_MARKER_FLOOR_DROP_M = 1.35;
/** Ring geometry (metres). */
export const NAV_MARKER_INNER_RADIUS = 0.35;
export const NAV_MARKER_OUTER_RADIUS = 0.45;
/** Invisible hit disc radius — forgiveness for imprecise clicks. */
export const NAV_MARKER_HIT_RADIUS = 0.7;

/** Hover pulse spring — quick with a touch of bounce. */
const HOVER_SPRING: SpringConfig = { stiffness: 170, damping: 18 };
/** Scale gain at full hover (1 → 1.15). */
const HOVER_SCALE_GAIN = 0.15;

interface NavMarkerProps {
  readonly node: TwinScanNode;
  readonly onHop: (id: string) => void;
}

function NavMarker({ node, onHop }: NavMarkerProps): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const groupRef = useRef<Group>(null);
  const ringMaterialRef = useRef<MeshBasicMaterial>(null);
  const hoverRef = useRef<{ spring: SpringState; target: number }>({
    spring: { value: 0, velocity: 0 },
    target: 0,
  });
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    hoverRef.current.target = hovered ? 1 : 0;
    invalidate();
    if (!hovered) {
      return undefined;
    }
    document.body.style.cursor = "pointer";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered, invalidate]);

  useFrame((_, delta) => {
    const { spring, target } = hoverRef.current;
    if (isSpringSettled(spring, target)) {
      return;
    }
    stepSpring(spring, target, delta, HOVER_SPRING);
    const pulse = Math.max(spring.value, 0);
    groupRef.current?.scale.setScalar(1 + HOVER_SCALE_GAIN * pulse);
    if (ringMaterialRef.current !== null) {
      ringMaterialRef.current.opacity =
        NAV_MARKER_IDLE_OPACITY + (1 - NAV_MARKER_IDLE_OPACITY) * Math.min(pulse, 1);
    }
    invalidate();
  });

  const position = e57PointToThree(node.pose.t);

  return (
    <group
      ref={groupRef}
      position={[position[0], position[1] - NAV_MARKER_FLOOR_DROP_M, position[2]]}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[NAV_MARKER_INNER_RADIUS, NAV_MARKER_OUTER_RADIUS, 48]} />
        <meshBasicMaterial
          ref={ringMaterialRef}
          color={NAV_MARKER_COLOR}
          transparent
          opacity={NAV_MARKER_IDLE_OPACITY}
          depthWrite={false}
        />
      </mesh>
      {/* Invisible oversized hit disc — the forgiving click target. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onHop(node.id);
        }}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => {
          setHovered(false);
        }}
      >
        <circleGeometry args={[NAV_MARKER_HIT_RADIUS, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

export interface NavMarkersProps {
  readonly neighbors: readonly string[];
  readonly nodesById: ReadonlyMap<string, TwinScanNode>;
  readonly onHop: (id: string) => void;
}

export function NavMarkers({ neighbors, nodesById, onHop }: NavMarkersProps): ReactElement {
  return (
    <group>
      {neighbors.map((id) => {
        const node = nodesById.get(id);
        return node === undefined ? null : <NavMarker key={id} node={node} onHop={onHop} />;
      })}
    </group>
  );
}
