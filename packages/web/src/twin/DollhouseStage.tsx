import { useEffect, useRef, useState, type ReactElement } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { GLTFLoader } from "three-stdlib";
import type { Group, MeshStandardMaterial } from "three";
import type { TwinScanNode } from "@omnitwin/types";
import {
  isSpringSettled,
  stepSpring,
  type SpringConfig,
  type SpringState,
} from "../lib/springs.js";
import { E57_TO_THREE_QUAT, MESH_OFFSET_M, e57PointToThree } from "./twin-basis.js";

// -----------------------------------------------------------------------------
// DollhouseStage — the orbitable mesh of the hall with posed node dots
// (Twin Phase 2, Task 4).
//
// The optimized GLB (meshopt geometry + WebP textures) loads through drei's
// useGLTF the first time dollhouse mode opens — no eager preload, so
// walk-only visitors never pay the 7 MB at first paint. TwinViewer warms it
// via preloadDollhouse() once the walk has been idle a beat, so the Surface
// dive never flies through an unloaded void. The mesh root carries
// E57_TO_THREE_QUAT + MESH_OFFSET_M (twin-basis, the single calibration
// surface); the node dots live OUTSIDE that group at e57PointToThree(t), so
// mesh and dots agree exactly when the basis conversion is right — which is
// what the visual alignment gate in twin-visual-check judges.
//
// Each dot is a gold sphere with a spring-driven hover pulse (springs, never
// tweens) and the same 4 px event.delta drag-guard as NavMarkers; the current
// node's dot breathes an emissive pulse, which also keeps the demand-mode
// canvas painting while the dollhouse is up (OrbitControls damping rides the
// same frames). Clicking a dot calls onDive(id) — Task 6 turns that into the
// spring flight.
//
// Plan: docs/superpowers/plans/2026-07-02-twin-phase2-dollhouse.md (Task 4).
// -----------------------------------------------------------------------------

/** Dot geometry (metres) — sized to read at dollhouse orbit distances. */
export const DOLLHOUSE_DOT_RADIUS_M = 0.18;
/** Invisible hit sphere — the forgiving click target (NavMarkers pattern). */
export const DOLLHOUSE_DOT_HIT_RADIUS_M = 0.45;
/** Flame-gold dot colour (Rite palette --gold). */
export const DOLLHOUSE_DOT_COLOR = "#d7a64b";
/** Idle emissive strength for non-current dots. */
export const DOLLHOUSE_DOT_IDLE_EMISSIVE = 0.35;
/** Current-node pulse: emissiveIntensity swings base ± amplitude. */
export const DOLLHOUSE_DOT_PULSE_BASE = 0.9;
export const DOLLHOUSE_DOT_PULSE_AMPLITUDE = 0.55;
/** Pulse angular speed (rad/s) — a calm ~0.36 Hz breath. */
export const DOLLHOUSE_DOT_PULSE_SPEED = 2.25;

/** Hover pulse spring — quick with a touch of bounce (NavMarkers tuning). */
const HOVER_SPRING: SpringConfig = { stiffness: 170, damping: 18 };
/** Scale gain at full hover (1 → 1.25 — dots are small at orbit distance). */
const HOVER_SCALE_GAIN = 0.25;
/** Pointer travel beyond this is a drag, not a click (px, NavMarkers value). */
const DRAG_GUARD_PX = 4;

/**
 * The NavMarkers drag-guard, exported pure: R3F's `event.delta` is the
 * pointer travel in px since pointerdown — an orbit-drag that ends over a dot
 * must not dive. Runs `onCleanClick` only for click-sized wobble. The param
 * is the minimal slice of ThreeEvent the guard reads, so tests exercise it
 * without synthesising a full raycast event.
 */
export function diveClickGuard(
  event: Pick<ThreeEvent<MouseEvent>, "delta" | "stopPropagation">,
  onCleanClick: () => void,
): void {
  event.stopPropagation();
  if (event.delta > DRAG_GUARD_PX) {
    return;
  }
  onCleanClick();
}

/** Shared loader config for the render and preload paths alike. */
function configureDollhouseLoader(loader: GLTFLoader): void {
  loader.setMeshoptDecoder(MeshoptDecoder);
}

/**
 * Warm the dollhouse GLB (fetch + meshopt decode into drei's cache) so a
 * Surface dive started from walk mode never flies through an unloaded void.
 * TwinViewer schedules this once the walk has been idle a beat.
 */
export function preloadDollhouse(meshUrl: string): void {
  useGLTF.preload(meshUrl, true, true, configureDollhouseLoader);
}

interface DollhouseMeshProps {
  readonly meshUrl: string;
}

/**
 * The optimized GLB inside the basis-conversion group. GLTFLoader needs the
 * meshopt decoder (EXT_meshopt_compression) — the extendLoader pins the
 * decoder shipped with our exact three version; drei's `useMeshopt` flag
 * stays on as well so the loader is covered even if drei reorders its
 * extension hooks. WebP textures decode natively; no KTX2/basis transcoder.
 */
function DollhouseMesh({ meshUrl }: DollhouseMeshProps): ReactElement {
  const gltf = useGLTF(meshUrl, true, true, configureDollhouseLoader);
  // Markers ride Object3D.name — NEVER data-* props: R3F pierces dashed prop
  // names as nested paths (data-x → object.data.x) and crashes on real nodes.
  return (
    <group name="twin-mesh-root" quaternion={E57_TO_THREE_QUAT} position={MESH_OFFSET_M}>
      <primitive object={gltf.scene} />
    </group>
  );
}

interface DollhouseDotProps {
  readonly node: TwinScanNode;
  readonly isCurrent: boolean;
  readonly onDive: (id: string) => void;
}

function DollhouseDot({ node, isCurrent, onDive }: DollhouseDotProps): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const gl = useThree((state) => state.gl);
  const groupRef = useRef<Group>(null);
  const materialRef = useRef<MeshStandardMaterial>(null);
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
    // Inline style on the canvas itself — it must outrank the stylesheet's
    // resting `cursor: grab` (document.body would lose that fight).
    const element = gl.domElement;
    element.style.cursor = "pointer";
    return () => {
      element.style.cursor = "";
    };
  }, [hovered, invalidate, gl]);

  useFrame((state, delta) => {
    const { spring, target } = hoverRef.current;
    if (!isSpringSettled(spring, target)) {
      stepSpring(spring, target, delta, HOVER_SPRING);
      groupRef.current?.scale.setScalar(1 + HOVER_SCALE_GAIN * Math.max(spring.value, 0));
      invalidate();
    }
    if (isCurrent && materialRef.current !== null) {
      // The breath: an ambient emissive swing on the node you are standing
      // on. Its invalidate() keeps the demand loop painting in dollhouse
      // mode, which OrbitControls damping relies on too.
      materialRef.current.emissiveIntensity =
        DOLLHOUSE_DOT_PULSE_BASE +
        DOLLHOUSE_DOT_PULSE_AMPLITUDE *
          Math.sin(state.clock.elapsedTime * DOLLHOUSE_DOT_PULSE_SPEED);
      invalidate();
    }
  });

  const position = e57PointToThree(node.pose.t);

  return (
    <group ref={groupRef} position={position} name={`twin-dot-${node.id}`}>
      <mesh>
        <sphereGeometry args={[DOLLHOUSE_DOT_RADIUS_M, 24, 16]} />
        <meshStandardMaterial
          ref={materialRef}
          color={DOLLHOUSE_DOT_COLOR}
          emissive={DOLLHOUSE_DOT_COLOR}
          emissiveIntensity={isCurrent ? DOLLHOUSE_DOT_PULSE_BASE : DOLLHOUSE_DOT_IDLE_EMISSIVE}
        />
      </mesh>
      {/* Invisible oversized hit sphere — the forgiving click target. */}
      <mesh
        name="twin-dot-hit"
        onClick={(event: ThreeEvent<MouseEvent>) => {
          diveClickGuard(event, () => {
            onDive(node.id);
          });
        }}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => {
          setHovered(false);
        }}
      >
        <sphereGeometry args={[DOLLHOUSE_DOT_HIT_RADIUS_M, 12, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

export interface DollhouseStageProps {
  /** Bundle URL of the optimized GLB, e.g. `/twin/trades-hall/mesh/dollhouse.glb`. */
  readonly meshUrl: string;
  readonly nodes: readonly TwinScanNode[];
  /** The node the walk is standing on — its dot carries the pulse. */
  readonly currentId: string;
  /** Dot click (drag-guarded) — Task 6 wires this into the dive flight. */
  readonly onDive: (id: string) => void;
}

export function DollhouseStage({
  meshUrl,
  nodes,
  currentId,
  onDive,
}: DollhouseStageProps): ReactElement {
  return (
    <group>
      {/* Matterport bakes its lighting into the textures; the ambient wash
          simply exposes them, the low directional adds facade legibility. */}
      <ambientLight intensity={2.2} />
      <directionalLight position={[12, 30, 18]} intensity={0.8} />
      <DollhouseMesh meshUrl={meshUrl} />
      <group>
        {nodes.map((node) => (
          <DollhouseDot
            key={node.id}
            node={node}
            isCurrent={node.id === currentId}
            onDive={onDive}
          />
        ))}
      </group>
    </group>
  );
}
