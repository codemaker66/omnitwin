import { useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
} from "three";
import { TRADES_HALL_ROOM_CAPACITIES } from "../../lib/trades-hall-venue-truth.js";
import {
  INK_GOLD,
  INK_GOLD_BRIGHT,
  buildDressingProgram,
  drawnSegments,
  penHead,
  strokesToInkGeometry,
  type DressingEventType,
} from "./gold-ink.js";
import { TURN_RENDER_ORDER } from "./TurnSheet.js";
import { useSectionScrollProgress } from "./useSectionScrollProgress.js";

// -----------------------------------------------------------------------------
// GoldInkTable — the drafting pen performing the storyboard.
//
// One LineSegments whose drawRange is the pen's odometer: scroll through the
// Dressing act and the chosen program draws itself — the first table in full,
// then the floor in the pen's shorthand — at constant speed; scroll back and
// it un-draws. The nib (a 1.5cm bright point, the page's only glint) rides
// the stroke head. World-space (Y-up): mounted OUTSIDE the Z-up splat group.
// The program's seat figures derive from venue truth inside gold-ink.ts;
// nothing here carries a number of its own.
// -----------------------------------------------------------------------------

export const DRESSING_SECTION_ID = "the-dressing";

export interface GoldInkTableProps {
  readonly eventType: DressingEventType;
}

export function GoldInkTable({ eventType }: GoldInkTableProps): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const progressRef = useSectionScrollProgress(
    DRESSING_SECTION_ID,
    useCallback(() => {
      invalidate();
    }, [invalidate]),
  );

  const ink = useMemo(() => {
    const program = buildDressingProgram(
      eventType,
      TRADES_HALL_ROOM_CAPACITIES["reception-room"],
    );
    return strokesToInkGeometry(program.strokes);
  }, [eventType]);

  const objects = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(ink.positions, 3));
    geometry.setDrawRange(0, 0);
    const lines = new LineSegments(
      geometry,
      new LineBasicMaterial({ color: INK_GOLD, transparent: true, opacity: 0.95 }),
    );
    lines.frustumCulled = false; // drawRange animates; keep the whole floor drawable
    lines.renderOrder = TURN_RENDER_ORDER.ink; // ink holds its light through the Turn's scrim
    const nib = new Mesh(
      new SphereGeometry(0.0075, 8, 8),
      new MeshBasicMaterial({ color: INK_GOLD_BRIGHT }),
    );
    nib.visible = false;
    nib.renderOrder = TURN_RENDER_ORDER.ink;
    return { geometry, lines, nib };
  }, [ink]);

  const lastCount = useRef(-1);

  useFrame(() => {
    const count = drawnSegments(ink, progressRef.current);
    if (count === lastCount.current) return;
    lastCount.current = count;
    objects.geometry.setDrawRange(0, count * 2);
    const head = penHead(ink, count);
    const drawing = count > 0 && count < ink.segmentCount;
    objects.nib.visible = drawing && head !== null;
    if (head !== null) objects.nib.position.set(head[0], head[1], head[2]);
  });

  useEffect(() => {
    // New program (event type changed): reapply the odometer immediately.
    lastCount.current = -1;
    invalidate();
    return () => {
      objects.geometry.dispose();
      objects.lines.material.dispose();
      objects.nib.geometry.dispose();
      objects.nib.material.dispose();
    };
  }, [invalidate, objects]);

  return (
    <>
      <primitive object={objects.lines} />
      <primitive object={objects.nib} />
    </>
  );
}
