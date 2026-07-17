import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
} from "three";
import {
  SparkSplatLayer,
  type SparkSplatErrorEvent,
} from "../../components/scene/SparkSplatLayer.js";
import {
  FIRST_TABLE,
  INK_GOLD_BRIGHT,
  shorthandRound,
  strokesToInkGeometry,
} from "../living-hall/gold-ink.js";
import {
  YOUR_TABLE_DEFAULT,
  clampToFloorBounds,
  loadYourTable,
  saveYourTable,
} from "../living-hall/turn.js";
import {
  RECEPTION_TILE_MANIFEST,
  receptionTileUrls,
} from "../living-hall/reception-dolly-path.js";

// -----------------------------------------------------------------------------
// FreshWalk — the captured Reception Room, awake on the homepage.
//
// Loaded lazily: this module (and with it three + Spark) costs nothing until
// the visitor asks to step in. The camera stands at a REAL capture viewpoint
// (pose 1856 of the scan — the splat is only photoreal where the scanner
// stood; the crane law) and never translates: dragging turns the head, with
// clamped yaw/pitch, eased — or pinned directly under reduced motion, because
// pointer-following must never be gated behind PRM. One gold-ink table can
// be dragged on the observed floor or nudged by keyboard, and it lands in
// the same localStorage spot the Living Hall uses — one room, one memory.
// -----------------------------------------------------------------------------

/** Pose 1856 of the capture walk, verbatim; gaze authored toward the
 *  visitor's table. Position must stay on the capture path. */
const WALK_STATION = {
  position: [1.497, -0.116, 6.9],
  look: [-2.0, -0.55, 9.0],
} as const;

const YAW_LIMIT = 0.95;
const PITCH_LIMIT = 0.32;
const LOOK_EASE_RATE = 7;
const KEY_STEP_M = 0.25;
const CLEARANCE_RADIUS_M = 1.45;
const CYAN = 0x62d9da;
const UP = new Vector3(0, 1, 0);

interface WalkInteraction {
  tableDrag: boolean;
}

function LookRig({ interaction }: { readonly interaction: WalkInteraction }): null {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const yaw = useRef({ target: 0, current: 0 });
  const pitch = useRef({ target: 0, current: 0 });
  const looking = useRef(false);
  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const base = useMemo(() => {
    const position = new Vector3(...WALK_STATION.position);
    const direction = new Vector3(...WALK_STATION.look).sub(position).normalize();
    return { position, direction };
  }, []);
  const scratch = useMemo(
    () => ({ dir: new Vector3(), right: new Vector3(), look: new Vector3() }),
    [],
  );

  useEffect(() => {
    const element = gl.domElement;
    const onDown = (event: PointerEvent): void => {
      // The table's own drag claims the pointer first (r3f attaches earlier);
      // while it holds, the head stays still.
      if (interaction.tableDrag) return;
      looking.current = true;
      element.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent): void => {
      if (!looking.current || interaction.tableDrag) return;
      const next = yaw.current.target - event.movementX * 0.0032;
      yaw.current.target = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, next));
      const nextPitch = pitch.current.target - event.movementY * 0.0022;
      pitch.current.target = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, nextPitch));
      invalidate();
    };
    const onUp = (): void => {
      looking.current = false;
    };
    element.style.touchAction = "none";
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onUp);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onUp);
    };
  }, [gl, interaction, invalidate]);

  useFrame((_state, delta) => {
    const ease = reducedMotion ? 1 : Math.min(1, delta * LOOK_EASE_RATE);
    yaw.current.current += (yaw.current.target - yaw.current.current) * ease;
    pitch.current.current += (pitch.current.target - pitch.current.current) * ease;

    scratch.dir.copy(base.direction).applyAxisAngle(UP, yaw.current.current);
    scratch.right.crossVectors(scratch.dir, UP).normalize();
    scratch.dir.applyAxisAngle(scratch.right, pitch.current.current);
    scratch.look.copy(base.position).addScaledVector(scratch.dir, 4);
    camera.position.copy(base.position);
    camera.lookAt(scratch.look);

    if (
      Math.abs(yaw.current.target - yaw.current.current) > 0.0005 ||
      Math.abs(pitch.current.target - pitch.current.current) > 0.0005
    ) {
      invalidate();
    }
  });

  return null;
}

interface WalkTableProps {
  readonly interaction: WalkInteraction;
  readonly nudgeRef: { current: ((dx: number, dz: number) => void) | null };
}

function WalkTable({ interaction, nudgeRef }: WalkTableProps): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const position = useRef(loadYourTable() ?? YOUR_TABLE_DEFAULT);

  const objects = useMemo(() => {
    const group = new Group();
    const ink = strokesToInkGeometry(shorthandRound(FIRST_TABLE, 0, 0));
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(ink.positions, 3));
    const lines = new LineSegments(
      geometry,
      new LineBasicMaterial({ color: INK_GOLD_BRIGHT, transparent: true, opacity: 0.95 }),
    );
    lines.frustumCulled = false;
    const clearance = new Mesh(
      new RingGeometry(CLEARANCE_RADIUS_M - 0.012, CLEARANCE_RADIUS_M, 72),
      new MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.4, depthTest: false }),
    );
    clearance.rotation.x = -Math.PI / 2;
    clearance.position.y = FIRST_TABLE.floorY + 0.02;
    const handle = new Mesh(
      new CylinderGeometry(FIRST_TABLE.radius + 0.25, FIRST_TABLE.radius + 0.25, 1.2, 24),
      new MeshBasicMaterial({ visible: false }),
    );
    handle.position.y = FIRST_TABLE.tabletopY + 0.3;
    group.add(lines, clearance, handle);
    return { group, geometry, lines, clearance, handle };
  }, []);

  const applyPosition = useCallback(() => {
    objects.group.position.set(position.current.x, 0, position.current.z);
    invalidate();
  }, [invalidate, objects]);

  useEffect(() => {
    applyPosition();
    nudgeRef.current = (dx: number, dz: number) => {
      position.current = clampToFloorBounds(
        position.current.x + dx,
        position.current.z + dz,
      );
      saveYourTable(position.current);
      applyPosition();
    };
    return () => {
      nudgeRef.current = null;
      objects.geometry.dispose();
      objects.lines.material.dispose();
      objects.clearance.geometry.dispose();
      objects.clearance.material.dispose();
      objects.handle.geometry.dispose();
      objects.handle.material.dispose();
    };
  }, [applyPosition, nudgeRef, objects]);

  const moveToRay = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const { origin, direction } = event.ray;
      if (Math.abs(direction.y) < 1e-4) return;
      const t = (FIRST_TABLE.floorY - origin.y) / direction.y;
      if (t <= 0) return;
      position.current = clampToFloorBounds(
        origin.x + direction.x * t,
        origin.z + direction.z * t,
      );
      applyPosition();
    },
    [applyPosition],
  );

  return (
    <primitive
      object={objects.group}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        interaction.tableDrag = true;
        objects.clearance.material.opacity = 0.75;
        (event.target as Element | undefined)?.setPointerCapture(event.pointerId);
        moveToRay(event);
      }}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        if (!interaction.tableDrag) return;
        moveToRay(event);
      }}
      onPointerUp={() => {
        if (!interaction.tableDrag) return;
        interaction.tableDrag = false;
        objects.clearance.material.opacity = 0.4;
        saveYourTable(position.current);
        invalidate();
      }}
    />
  );
}

export interface FreshWalkProps {
  readonly onLive: () => void;
  readonly onFailed: () => void;
  readonly onProgress: (loadedBytes: number, totalBytes: number) => void;
}

const TOTAL_BYTES = RECEPTION_TILE_MANIFEST.reduce((sum, tile) => sum + tile.bytes, 0);

export default function FreshWalk({
  onLive,
  onFailed,
  onProgress,
}: FreshWalkProps): ReactElement {
  const urls = useMemo(() => receptionTileUrls(), []);
  const loadedRef = useRef(new Set<string>());
  const failedRef = useRef(false);
  const interaction = useRef<WalkInteraction>({ tableDrag: false });
  const nudgeRef = useRef<((dx: number, dz: number) => void) | null>(null);
  const [live, setLive] = useState(false);

  // SparkSplatLayer re-creates its mesh — disposing and REFETCHING the
  // tile — whenever onLoad/onError change identity. The handlers below
  // must therefore stay identity-stable for the component's whole life,
  // whatever the parent passes; latest callbacks live in refs. (Unstable
  // handlers put the room into permanent dispose/refetch churn on slow
  // networks: state reached "live" while Spark never painted a frame.)
  const onLiveRef = useRef(onLive);
  const onFailedRef = useRef(onFailed);
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onLiveRef.current = onLive;
    onFailedRef.current = onFailed;
    onProgressRef.current = onProgress;
  }, [onFailed, onLive, onProgress]);

  const handleLoad = useCallback((event: { url: string }) => {
    loadedRef.current.add(event.url);
    const loadedBytes = RECEPTION_TILE_MANIFEST.filter((tile) =>
      loadedRef.current.has(`/splats/reception/${tile.file}`),
    ).reduce((sum, tile) => sum + tile.bytes, 0);
    onProgressRef.current(loadedBytes, TOTAL_BYTES);
    if (loadedRef.current.size >= RECEPTION_TILE_MANIFEST.length) {
      setLive(true);
      onLiveRef.current();
    }
  }, []);

  const handleError = useCallback((_event: SparkSplatErrorEvent) => {
    // One missing tile is an incomplete room — fail honestly, once.
    if (failedRef.current) return;
    failedRef.current = true;
    onFailedRef.current();
  }, []);

  return (
    <div
      className="fr-walk-canvas"
      tabIndex={0}
      onKeyDown={(event) => {
        let dx = 0;
        let dz = 0;
        if (event.key === "ArrowLeft") dx = -KEY_STEP_M;
        else if (event.key === "ArrowRight") dx = KEY_STEP_M;
        else if (event.key === "ArrowUp") dz = -KEY_STEP_M;
        else if (event.key === "ArrowDown") dz = KEY_STEP_M;
        else if (event.key === "Escape") {
          event.currentTarget.blur();
          return;
        } else return;
        event.preventDefault();
        nudgeRef.current?.(dx, dz);
      }}
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{
          fov: 62,
          near: 0.05,
          far: 150,
          position: [...WALK_STATION.position],
        }}
        gl={{ antialias: false, powerPreference: "high-performance" }}
      >
        <group rotation={[-Math.PI / 2, 0, 0]}>
          {urls.map((url, index) => (
            <SparkSplatLayer
              key={url}
              url={url}
              includeRendererHost={index === 0}
              onLoad={handleLoad}
              onError={handleError}
            />
          ))}
        </group>
        {live && <WalkTable interaction={interaction.current} nudgeRef={nudgeRef} />}
        <LookRig interaction={interaction.current} />
      </Canvas>
    </div>
  );
}
