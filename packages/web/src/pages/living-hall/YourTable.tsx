import { useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
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
} from "three";
import {
  FIRST_TABLE,
  INK_GOLD_BRIGHT,
  shorthandRound,
  strokesToInkGeometry,
} from "./gold-ink.js";
import { TURN_RENDER_ORDER } from "./TurnSheet.js";
import {
  YOUR_TABLE_DEFAULT,
  clampToFloorBounds,
  loadYourTable,
  saveYourTable,
  turnWeight,
} from "./turn.js";
import { useSectionScrollProgress } from "./useSectionScrollProgress.js";

// -----------------------------------------------------------------------------
// YourTable — the one table the visitor moves themselves.
//
// The same shorthand round the fill draws, in the brighter gold — yours.
// It appears with the Turn's sheet, and while the sandbox is active it can
// be dragged (pointer ray to the floor plane) or moved with the arrow keys;
// Escape hands control back. The placement persists (localStorage) — the
// table is still where you left it on your next visit, and the clamp keeps
// it on the observed floor. Cyan ring = clearance guide, a planning aid —
// cyan is the page's derived/simulated colour, never a fact of the plan.
// -----------------------------------------------------------------------------

const KEY_STEP_M = 0.25;
/** Chair-ring radius (~1.28m) + service clearance guide. */
const CLEARANCE_RADIUS_M = 1.45;
const CYAN = 0x62d9da;

export interface YourTableProps {
  readonly active: boolean;
  /** Escape or Done — the page returns focus to the sandbox button. */
  readonly onExit: () => void;
}

export function YourTable({ active, onExit }: YourTableProps): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const progressRef = useSectionScrollProgress(
    "the-plan",
    useCallback(() => {
      invalidate();
    }, [invalidate]),
  );
  const dragging = useRef(false);
  const position = useRef(loadYourTable() ?? YOUR_TABLE_DEFAULT);

  const objects = useMemo(() => {
    const group = new Group();
    const ink = strokesToInkGeometry(shorthandRound(FIRST_TABLE, 0, 0));
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(ink.positions, 3));
    const lines = new LineSegments(
      geometry,
      new LineBasicMaterial({ color: INK_GOLD_BRIGHT, transparent: true, opacity: 0 }),
    );
    lines.renderOrder = TURN_RENDER_ORDER.ink;
    lines.frustumCulled = false;
    const clearance = new Mesh(
      new RingGeometry(CLEARANCE_RADIUS_M - 0.012, CLEARANCE_RADIUS_M, 72),
      new MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0, depthTest: false }),
    );
    clearance.rotation.x = -Math.PI / 2;
    clearance.position.y = FIRST_TABLE.floorY + 0.02;
    clearance.renderOrder = TURN_RENDER_ORDER.ink;
    // Invisible drag handle over the tabletop — generous, honest hit area.
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
    return () => {
      objects.geometry.dispose();
      objects.lines.material.dispose();
      objects.clearance.geometry.dispose();
      objects.clearance.material.dispose();
      objects.handle.geometry.dispose();
      objects.handle.material.dispose();
    };
  }, [applyPosition, objects]);

  // The table fades in with the Turn; the clearance ring only while active.
  useFrame(() => {
    const w = turnWeight(progressRef.current);
    const visible = w > 0.02;
    objects.group.visible = visible;
    objects.lines.material.opacity = Math.min(0.95, w + 0.2);
    objects.clearance.material.opacity = active ? 0.55 * w : 0;
  });

  // Keyboard contract: arrows move, Escape exits. Window-level while active
  // so the visitor never has to aim at the canvas (WCAG 2.5.7 alternative).
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      let dx = 0;
      let dz = 0;
      if (event.key === "ArrowLeft") dx = -KEY_STEP_M;
      else if (event.key === "ArrowRight") dx = KEY_STEP_M;
      else if (event.key === "ArrowUp") dz = -KEY_STEP_M;
      else if (event.key === "ArrowDown") dz = KEY_STEP_M;
      else if (event.key === "Escape") {
        onExit();
        return;
      } else return;
      event.preventDefault();
      position.current = clampToFloorBounds(position.current.x + dx, position.current.z + dz);
      saveYourTable(position.current);
      applyPosition();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active, applyPosition, onExit]);

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
        if (!active) return;
        dragging.current = true;
        (event.target as Element | undefined)?.setPointerCapture(event.pointerId);
        moveToRay(event);
      }}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        if (!active || !dragging.current) return;
        moveToRay(event);
      }}
      onPointerUp={() => {
        if (!dragging.current) return;
        dragging.current = false;
        saveYourTable(position.current);
      }}
    />
  );
}
