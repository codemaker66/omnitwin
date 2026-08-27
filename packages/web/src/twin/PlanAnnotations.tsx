import { useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3, type Camera } from "three";
import type { PlanRoomLabel } from "./plan-mode.js";

// -----------------------------------------------------------------------------
// PlanAnnotations — room names written onto the drawing.
//
// A plan without annotation is a shape; a plan with room names is a document
// someone can act on. The names come from planRoomLabels, which reads the
// SAME validated-room oracle the walk's dossier does — so the drawing can
// only ever name a room a human confirmed against photography, and stays
// silent everywhere else (twin-rooms.ts's standing rule).
//
// Two halves, in the measure tool's idiom: an in-Canvas projector that turns
// world positions into screen fractions each painted frame, and a DOM overlay
// that draws the type. DOM rather than in-scene text because annotation must
// stay crisp and scale-independent as the plan zooms — the label names the
// room, it is not painted on the floor.
//
// The projector mirrors the measure tool's one-liner deliberately rather than
// sharing it: same arithmetic, different payload (a name, not a measurement
// endpoint), and neither consumer should be able to change the other's
// projection by editing its own.
// -----------------------------------------------------------------------------

/** How far a projected label must move, as a fraction of the stage, before
 *  the overlay re-renders. Sub-pixel churn is a re-render not taken. */
const LABEL_PROJECT_EPSILON = 0.0015;

export interface PlanLabelScreen {
  readonly slug: string;
  readonly name: string;
  /** Stage fractions, 0..1 from the top-left. */
  readonly x: number;
  readonly y: number;
}

const projection = new Vector3();

/** Where a world point sits on the stage, or null when it is behind the
 *  camera or outside the frame (an orthographic plan pans freely, so a label
 *  is often off-stage). */
function projectLabel(
  world: readonly [number, number, number],
  camera: Camera,
): { x: number; y: number } | null {
  projection.set(world[0], world[1], world[2]).project(camera);
  if (projection.z > 1) {
    return null;
  }
  const x = (projection.x + 1) / 2;
  const y = (1 - projection.y) / 2;
  if (x < -0.1 || x > 1.1 || y < -0.1 || y > 1.1) {
    return null;
  }
  return { x, y };
}

/**
 * The in-Canvas half: projects each label every painted frame and reports the
 * set when it has actually moved. Mounted inside the Canvas because only a
 * component under R3F can read the live camera per frame.
 */
export function PlanLabelProjector({
  labels,
  onProject,
}: {
  readonly labels: readonly PlanRoomLabel[];
  readonly onProject: (screens: readonly PlanLabelScreen[]) => void;
}): null {
  const camera = useThree((state) => state.camera);
  const last = useRef<readonly PlanLabelScreen[]>([]);

  useFrame(() => {
    const next: PlanLabelScreen[] = [];
    for (const label of labels) {
      const screen = projectLabel(label.position, camera);
      if (screen !== null) {
        next.push({ slug: label.slug, name: label.name, x: screen.x, y: screen.y });
      }
    }
    const previous = last.current;
    const moved =
      next.length !== previous.length ||
      next.some((screen, index) => {
        const was = previous[index];
        if (was === undefined || was.slug !== screen.slug) {
          return true;
        }
        return (
          Math.abs(screen.x - was.x) > LABEL_PROJECT_EPSILON ||
          Math.abs(screen.y - was.y) > LABEL_PROJECT_EPSILON
        );
      });
    if (moved) {
      last.current = next;
      onProject(next);
    }
  });

  return null;
}

/**
 * The DOM half: the annotation itself. Pointer-transparent to the last
 * pixel — a label sitting over the drawing must never eat a pan drag or a
 * viewpoint click (the .vv-twin-controls pointer contract).
 */
export function PlanAnnotations({
  screens,
}: {
  readonly screens: readonly PlanLabelScreen[];
}): ReactElement {
  return (
    <div className="vv-twin-plan-labels" aria-hidden data-testid="twin-plan-labels">
      {screens.map((screen) => (
        <span
          key={screen.slug}
          className="vv-twin-plan-label"
          style={{ left: `${String(screen.x * 100)}%`, top: `${String(screen.y * 100)}%` }}
        >
          {screen.name}
        </span>
      ))}
    </div>
  );
}
