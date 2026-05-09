import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import {
  CatmullRomCurve3,
  Color,
  Plane,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import type { Camera, Raycaster } from "three";
import { useMarkupStore, type MarkupColor, type MarkupPoint, type MarkupStroke } from "../stores/markup-store.js";

const FLOOR_PLANE = new Plane(new Vector3(0, 1, 0), 0);
const floorHit = new Vector3();
const ndc = new Vector2();

const STROKE_Y = 0.045;

const MARKUP_PALETTE: Record<MarkupColor, {
  readonly core: string;
  readonly halo: string;
}> = {
  gold: { core: "#f1c861", halo: "#c9a84c" },
  ivory: { core: "#fff2cf", halo: "#f5dfad" },
  ruby: { core: "#ff5d6c", halo: "#a92e3a" },
  cyan: { core: "#7bdcff", halo: "#48a9cf" },
};

function screenToFloorPoint(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: Camera,
  raycaster: Raycaster,
): MarkupPoint | null {
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc.set(x, y), camera);
  const hit = raycaster.ray.intersectPlane(FLOOR_PLANE, floorHit);
  if (hit === null) return null;
  return { x: hit.x, z: hit.z };
}

function createTubeGeometry(stroke: MarkupStroke, radiusMultiplier: number): TubeGeometry | null {
  if (stroke.points.length < 2) return null;
  const points = stroke.points.map((point) => new Vector3(point.x, STROKE_Y, point.z));
  const curve = new CatmullRomCurve3(points, false, "centripetal", 0.32);
  const tubularSegments = Math.max(16, Math.min(220, stroke.points.length * 4));
  return new TubeGeometry(curve, tubularSegments, stroke.width * radiusMultiplier, 8, false);
}

function MarkupStrokeMesh({
  stroke,
  draft = false,
}: {
  readonly stroke: MarkupStroke;
  readonly draft?: boolean;
}): React.ReactElement | null {
  const haloGeometry = useMemo(() => createTubeGeometry(stroke, 2.35), [stroke]);
  const coreGeometry = useMemo(() => createTubeGeometry(stroke, 0.82), [stroke]);
  const color = MARKUP_PALETTE[stroke.color];

  useEffect(() => {
    return () => {
      haloGeometry?.dispose();
      coreGeometry?.dispose();
    };
  }, [haloGeometry, coreGeometry]);

  if (haloGeometry === null || coreGeometry === null) return null;

  return (
    <group name={draft ? `markup-draft-${stroke.id}` : `markup-stroke-${stroke.id}`}>
      <mesh geometry={haloGeometry} renderOrder={18}>
        <meshBasicMaterial
          color={new Color(color.halo)}
          transparent
          opacity={draft ? 0.26 : 0.18}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      <mesh geometry={coreGeometry} renderOrder={19}>
        <meshBasicMaterial
          color={new Color(color.core)}
          transparent
          opacity={draft ? 0.96 : 0.86}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      {stroke.points.map((point, index) => {
        if (index % 8 !== 0 && index !== stroke.points.length - 1) return null;
        return (
          <mesh
            key={`${stroke.id}-spark-${String(index)}`}
            position={[point.x, STROKE_Y + 0.012, point.z]}
            renderOrder={20}
          >
            <sphereGeometry args={[stroke.width * 1.7, 10, 10]} />
            <meshBasicMaterial
              color={new Color(color.core)}
              transparent
              opacity={draft ? 0.88 : 0.44}
              depthWrite={false}
              depthTest={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

export function MarkupLayer(): React.ReactElement {
  const { gl, camera, raycaster, invalidate } = useThree();
  const active = useMarkupStore((state) => state.active);
  const strokes = useMarkupStore((state) => state.strokes);
  const draftStroke = useMarkupStore((state) => state.draftStroke);
  const activePointerIdRef = useRef<number | null>(null);
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  useEffect(() => {
    return useMarkupStore.subscribe(() => {
      invalidateRef.current();
    });
  }, []);

  useEffect(() => {
    const canvas = gl.domElement;
    const previousCursor = canvas.style.cursor;
    if (active) {
      canvas.style.cursor = "crosshair";
    } else if (canvas.style.cursor === "crosshair") {
      canvas.style.cursor = previousCursor;
    }
    return () => {
      if (canvas.style.cursor === "crosshair") {
        canvas.style.cursor = previousCursor;
      }
    };
  }, [active, gl]);

  useEffect(() => {
    if (!active) return;
    const canvas = gl.domElement;

    function floorPointFromEvent(event: PointerEvent): MarkupPoint | null {
      return screenToFloorPoint(
        event.clientX,
        event.clientY,
        canvas.getBoundingClientRect(),
        camera,
        raycaster,
      );
    }

    function onPointerDown(event: PointerEvent): void {
      if (event.button !== 0) return;
      const point = floorPointFromEvent(event);
      if (point === null) return;
      event.preventDefault();
      event.stopPropagation();
      activePointerIdRef.current = event.pointerId;
      useMarkupStore.getState().beginStroke(point);
      invalidateRef.current();
    }

    function onPointerMove(event: PointerEvent): void {
      if (activePointerIdRef.current !== event.pointerId) return;
      const point = floorPointFromEvent(event);
      if (point === null) return;
      event.preventDefault();
      useMarkupStore.getState().appendPoint(point);
      invalidateRef.current();
    }

    function finishPointer(event: PointerEvent): void {
      if (activePointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      activePointerIdRef.current = null;
      useMarkupStore.getState().commitStroke();
      invalidateRef.current();
    }

    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (!useMarkupStore.getState().active) return;
      if (event.code === "Escape") {
        useMarkupStore.getState().cancelStroke();
        invalidateRef.current();
      }
      if (event.code === "KeyZ" && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
        event.preventDefault();
        useMarkupStore.getState().undoStroke();
        invalidateRef.current();
      }
    }

    canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", finishPointer, { passive: false });
    window.addEventListener("pointercancel", finishPointer, { passive: false });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      activePointerIdRef.current = null;
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", finishPointer);
      window.removeEventListener("keydown", onKeyDown);
      useMarkupStore.getState().cancelStroke();
    };
  }, [active, gl, camera, raycaster]);

  return (
    <group name="planner-markup-layer">
      {strokes.map((stroke) => (
        <MarkupStrokeMesh key={stroke.id} stroke={stroke} />
      ))}
      {draftStroke !== null ? <MarkupStrokeMesh stroke={draftStroke} draft /> : null}
    </group>
  );
}
