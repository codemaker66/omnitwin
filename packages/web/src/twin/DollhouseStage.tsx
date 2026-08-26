import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { GLTFLoader } from "three-stdlib";
import {
  Mesh as ThreeMesh,
  Plane,
  Vector3,
  type Group,
  type MeshStandardMaterial,
} from "three";
import type { TwinScanNode } from "@omnitwin/types";
import {
  isSpringSettled,
  stepSpring,
  type SpringConfig,
  type SpringState,
} from "../lib/springs.js";
import { E57_TO_THREE_QUAT, MESH_OFFSET_M, e57PointToThree } from "./twin-basis.js";
import {
  cloneSceneWithCutawayPlanes,
  disposeCutawayScene,
  setInertCutawayPlane,
  updateVerticalCutawayPlane,
} from "./dollhouse-cutaway.js";
import { applyDollhouseCaps, meshRootWorldMatrix } from "./dollhouse-peel.js";
import { pruneDollhouseShell } from "./dollhouse-shell.js";

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
  readonly cutawayPlanes: readonly Plane[] | null;
}

/**
 * The optimized GLB inside the basis-conversion group. GLTFLoader needs the
 * meshopt decoder (EXT_meshopt_compression) — the extendLoader pins the
 * decoder shipped with our exact three version; drei's `useMeshopt` flag
 * stays on as well so the loader is covered even if drei reorders its
 * extension hooks. WebP textures decode natively; no KTX2/basis transcoder.
 */
function DollhouseMesh({ meshUrl, cutawayPlanes }: DollhouseMeshProps): ReactElement {
  const gltf = useGLTF(meshUrl, true, true, configureDollhouseLoader);
  // Two load-time repairs on the cached scene, once, before anything clones it —
  // geometry is shared by reference, so the cutaway clone and every later mount
  // inherit both. Each is flagged idempotent on the geometry.
  //   1. Prune: the capture tore where it looked through glass; those shreds
  //      made the window bays read as broken from outside.
  //   2. Caps: split each chunk so overheads that used to backface-cull into
  //      view-dependent holes (the dome's sweeping gold arc, the annex plates
  //      over the storey void) draw DoubleSide instead, while the high flat
  //      lids stay cullable so every room is still seen into from above. The
  //      caps classify in the WORLD frame, which does not exist yet on the
  //      cached scene — meshRootWorldMatrix() supplies the twin-basis group
  //      transform the JSX below will mount it under. Order matters: the prune
  //      rewrites the index the split then partitions.
  const shellScene = useMemo(() => {
    pruneDollhouseShell(gltf.scene);
    applyDollhouseCaps(gltf.scene, undefined, meshRootWorldMatrix());
    return gltf.scene;
  }, [gltf.scene]);
  const preparedScene = useMemo(
    () =>
      cutawayPlanes === null
        ? { scene: shellScene, materials: [] }
        : cloneSceneWithCutawayPlanes(shellScene, cutawayPlanes),
    [shellScene, cutawayPlanes],
  );
  useEffect(
    () => () => {
      disposeCutawayScene(preparedScene);
    },
    [preparedScene],
  );
  // Markers ride Object3D.name — NEVER data-* props: R3F pierces dashed prop
  // names as nested paths (data-x → object.data.x) and crashes on real nodes.
  return (
    <group name="twin-mesh-root" quaternion={E57_TO_THREE_QUAT} position={MESH_OFFSET_M}>
      <primitive object={preparedScene.scene} />
    </group>
  );
}

interface DollhouseCutawayControllerProps {
  readonly plane: Plane;
  readonly floorPlane: Plane;
  /** The plan's horizontal section — everything ABOVE its cut is removed. */
  readonly ceilingPlane: Plane;
  readonly enabled: boolean;
  readonly target: readonly [number, number, number];
  readonly witnesses: readonly Vector3[];
  readonly insetM: number;
  readonly minimumY?: number;
  /** Three-space y of the plan section cut; undefined leaves the plane inert.
   *  Independent of `enabled` — the plan's section runs while the dollhouse's
   *  camera-facing cutaway is off, and vice versa. */
  readonly sectionCutY?: number;
}

function DollhouseCutawayController({
  plane,
  floorPlane,
  ceilingPlane,
  enabled,
  target,
  witnesses,
  insetM,
  minimumY,
  sectionCutY,
}: DollhouseCutawayControllerProps): null {
  const gl = useThree((state) => state.gl);
  const wasEnabled = useRef(false);
  const targetPoint = useMemo(
    () => new Vector3(target[0], target[1], target[2]),
    [target[0], target[1], target[2]],
  );

  useLayoutEffect(() => {
    const previous = gl.localClippingEnabled;
    gl.localClippingEnabled = true;
    return () => {
      gl.localClippingEnabled = previous;
    };
  }, [gl]);

  useFrame(({ camera }) => {
    // The plan section: keep y <= cutY (three retains the plane's positive
    // side; n=(0,-1,0), c=cutY ⇒ distance = cutY − y). A horizontal cut has
    // no camera dependence, so this is a plain assignment per frame.
    if (sectionCutY === undefined || !Number.isFinite(sectionCutY)) {
      setInertCutawayPlane(ceilingPlane);
    } else {
      ceilingPlane.setComponents(0, -1, 0, sectionCutY);
    }
    if (!enabled) {
      if (wasEnabled.current) {
        setInertCutawayPlane(plane);
        setInertCutawayPlane(floorPlane);
        wasEnabled.current = false;
      }
      return;
    }
    wasEnabled.current = true;
    if (minimumY === undefined || !Number.isFinite(minimumY)) {
      setInertCutawayPlane(floorPlane);
    } else {
      floorPlane.setComponents(0, 1, 0, -minimumY);
    }
    updateVerticalCutawayPlane(plane, {
      cameraPosition: camera.position,
      target: targetPoint,
      witnesses,
      insetM,
    });
  }, -0.5);

  return null;
}

interface DollhouseDotProps {
  readonly node: TwinScanNode;
  readonly isCurrent: boolean;
  readonly onDive: (id: string) => void;
  readonly clippingPlanes: Plane[] | null;
}

function DollhouseDot({
  node,
  isCurrent,
  onDive,
  clippingPlanes,
}: DollhouseDotProps): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const gl = useThree((state) => state.gl);
  const groupRef = useRef<Group>(null);
  const hitRef = useRef<ThreeMesh>(null);
  const materialRef = useRef<MeshStandardMaterial>(null);
  const hoverRef = useRef<{ spring: SpringState; target: number }>({
    spring: { value: 0, velocity: 0 },
    target: 0,
  });
  const [hovered, setHovered] = useState(false);
  const position = e57PointToThree(node.pose.t);
  const cutawayPoint = useMemo(
    () => new Vector3(position[0], position[1], position[2]),
    [position[0], position[1], position[2]],
  );

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
    // Plane-derived visibility, unconditionally: an inert plane sits a
    // million metres away, so at rest every dot passes and the check costs a
    // handful of dot products. This is what hides dots behind the camera
    // cutaway AND above the plan's storey section with one rule.
    const visible =
      clippingPlanes === null ||
      clippingPlanes.every(
        (plane) => plane.distanceToPoint(cutawayPoint) >= DOLLHOUSE_DOT_RADIUS_M,
      );
    const group = groupRef.current;
    if (group !== null && group.visible !== visible) {
      group.visible = visible;
      const hit = hitRef.current;
      if (hit !== null) {
        if (visible) {
          hit.layers.set(0);
        } else {
          hit.layers.mask = 0;
        }
      }
      if (!visible) {
        hoverRef.current.target = 0;
        if (hovered) {
          setHovered(false);
        }
      }
      invalidate();
    }
    if (!visible) {
      return;
    }
    const { spring, target } = hoverRef.current;
    if (!isSpringSettled(spring, target)) {
      stepSpring(spring, target, delta, HOVER_SPRING);
      groupRef.current?.scale.setScalar(1 + HOVER_SCALE_GAIN * Math.max(spring.value, 0));
      invalidate();
    }
    if (isCurrent && materialRef.current !== null) {
      // The breath: an ambient emissive swing on the node you are standing
      // on. Its invalidate() keeps the pulse itself animating under the
      // demand loop — and ONLY the pulse: OrbitControls damping self-
      // sustains through drei's own change→invalidate wiring, so plan
      // mode filtering this dot off another storey costs nothing but the
      // breath (review-verified against drei's OrbitControls source).
      materialRef.current.emissiveIntensity =
        DOLLHOUSE_DOT_PULSE_BASE +
        DOLLHOUSE_DOT_PULSE_AMPLITUDE *
          Math.sin(state.clock.elapsedTime * DOLLHOUSE_DOT_PULSE_SPEED);
      invalidate();
    }
  });

  return (
    <group ref={groupRef} position={position} name={`twin-dot-${node.id}`}>
      <mesh>
        <sphereGeometry args={[DOLLHOUSE_DOT_RADIUS_M, 24, 16]} />
        <meshStandardMaterial
          ref={materialRef}
          clippingPlanes={clippingPlanes}
          color={DOLLHOUSE_DOT_COLOR}
          emissive={DOLLHOUSE_DOT_COLOR}
          emissiveIntensity={isCurrent ? DOLLHOUSE_DOT_PULSE_BASE : DOLLHOUSE_DOT_IDLE_EMISSIVE}
        />
      </mesh>
      {/* Invisible oversized hit sphere — the forgiving click target. */}
      <mesh
        ref={hitRef}
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
  /** Optional venue-scoped camera-facing section treatment. */
  readonly cutaway?: {
    readonly enabled: boolean;
    readonly target: readonly [number, number, number];
    readonly insetM: number;
    readonly minimumY?: number;
  };
  /** The plan's horizontal storey section — removes everything above cutY. */
  readonly planSection?: {
    readonly cutY: number;
  };
  /** Render only this storey's dots (the plan's active level). Undefined
   *  renders every dot, as the dollhouse always has. */
  readonly dotFloor?: number;
}

export function DollhouseStage({
  meshUrl,
  nodes,
  currentId,
  onDive,
  cutaway,
  planSection,
  dotFloor,
}: DollhouseStageProps): ReactElement {
  const cutawayPlane = useMemo(() => {
    const plane = new Plane();
    setInertCutawayPlane(plane);
    return plane;
  }, []);
  const floorPlane = useMemo(() => {
    const plane = new Plane();
    setInertCutawayPlane(plane);
    return plane;
  }, []);
  const ceilingPlane = useMemo(() => {
    const plane = new Plane();
    setInertCutawayPlane(plane);
    return plane;
  }, []);
  // One material-clone pass covers both treatments: the planes begin inert
  // and only the controller ever moves them, so configuring either the
  // camera cutaway or the plan section clones once and clips live.
  const clippingConfigured = cutaway !== undefined || planSection !== undefined;
  const clippingPlanes = useMemo(
    () => (clippingConfigured ? [cutawayPlane, floorPlane, ceilingPlane] : null),
    [clippingConfigured, cutawayPlane, floorPlane, ceilingPlane],
  );
  const cutawayWitnesses = useMemo(
    () =>
      nodes.map((node) => {
        const position = e57PointToThree(node.pose.t);
        return new Vector3(position[0], position[1], position[2]);
      }),
    [nodes],
  );

  return (
    <group>
      {/* Matterport bakes its lighting into the textures; the ambient wash
          simply exposes them, the low directional adds facade legibility. */}
      <ambientLight intensity={2.2} />
      <directionalLight position={[12, 30, 18]} intensity={0.8} />
      <DollhouseMesh meshUrl={meshUrl} cutawayPlanes={clippingPlanes} />
      {clippingConfigured && (
        <DollhouseCutawayController
          plane={cutawayPlane}
          floorPlane={floorPlane}
          ceilingPlane={ceilingPlane}
          enabled={cutaway?.enabled === true}
          target={cutaway?.target ?? [0, 0, 0]}
          witnesses={cutawayWitnesses}
          insetM={cutaway?.insetM ?? 0}
          {...(cutaway?.minimumY === undefined ? {} : { minimumY: cutaway.minimumY })}
          {...(planSection === undefined ? {} : { sectionCutY: planSection.cutY })}
        />
      )}
      <group>
        {nodes
          .filter((node) => dotFloor === undefined || node.floor === dotFloor)
          .map((node) => (
            <DollhouseDot
              key={node.id}
              node={node}
              isCurrent={node.id === currentId}
              onDive={onDive}
              clippingPlanes={clippingPlanes}
            />
          ))}
      </group>
    </group>
  );
}
