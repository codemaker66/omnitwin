import type { RoomFrame, Vec3 } from "./obj-bounds.js";

// ---------------------------------------------------------------------------
// Room frame -> scene transform.
//
// XGRIDS captures are metric and Z-up (`scale: [1,1,1]` in every manifest we
// ingest). The planner scene is Y-up and, since T-473, also real metres. So the
// transform is a rotation and a translation — and deliberately NOT a scale.
//
// A scale factor here would mean one of two things, both of which should stop
// the pipeline rather than be absorbed: the capture is not metric, or we are
// fitting a room to a stage it does not fit. The Reception Room's existing
// hand-tuned `scale: 0.63` is exactly that absorbed error, and it is why the
// room carries a "not a signed room-local alignment" caveat to this day.
// ---------------------------------------------------------------------------

/** Z-up -> Y-up is a -90 degree rotation about X. */
export const Z_UP_TO_Y_UP_ROTATION_X = -Math.PI / 2;

export interface SceneTransform {
  /** Scene-space translation applied after rotation, in metres. */
  readonly position: Vec3;
  /** Euler XYZ rotation, in radians. */
  readonly rotation: Vec3;
  /** Always 1: captures are metric and the scene is metric. */
  readonly scale: 1;
}

/**
 * Places a measured room so its floor sits on the stage floor (y = 0) and its
 * centre sits over the origin.
 *
 * Under the Z-up -> Y-up rotation, source (x, y, z) maps to scene (x, z, -y).
 * The translation therefore cancels the room centre on scene X and Z, and
 * lifts the room so its floor — not its centre — lands on y = 0.
 */
export function sceneTransformForRoomFrame(frame: RoomFrame): SceneTransform {
  const [cx, cy] = frame.center;
  return {
    position: [-cx, -frame.floorZ, cy],
    rotation: [Z_UP_TO_Y_UP_ROTATION_X, 0, 0],
    scale: 1,
  };
}

/** Room extent expressed in scene axes (width, height, depth), in metres. */
export function sceneExtentForRoomFrame(frame: RoomFrame): Vec3 {
  const [ex, ey, ez] = frame.extent;
  return [ex, ez, ey];
}

export type AlignmentVerdict = "agrees" | "disagrees" | "unpublished";

export interface AlignmentCheck {
  readonly verdict: AlignmentVerdict;
  /** Worst per-axis relative error against the published extent, or null. */
  readonly worstRelativeError: number | null;
  readonly detail: string;
}

/** Beyond this a derived extent is not the published room. */
const ALIGNMENT_TOLERANCE = 0.25;

/**
 * Cross-checks a derived room frame against the venue's published dimensions.
 *
 * Published figures are marketing copy, not survey data, so this tolerates a
 * quarter. It exists to catch the failures that matter — the wrong capture
 * mapped to a room, a non-metric export, a measurement that swallowed a
 * corridor — not to certify the alignment. Nothing here signs anything.
 *
 * Width and depth are compared as an unordered pair: which of the two
 * horizontal axes a capture calls "width" is an accident of how the operator
 * walked in, and a room measured 90 degrees around is still the right room.
 */
export function checkAgainstPublished(
  frame: RoomFrame,
  publishedExtentM: readonly [number, number, number] | null,
): AlignmentCheck {
  if (publishedExtentM === null) {
    return {
      verdict: "unpublished",
      worstRelativeError: null,
      detail: "No published dimensions for this room; derived extent stands unchecked.",
    };
  }

  const [sw, sh, sd] = sceneExtentForRoomFrame(frame);
  // publishedExtentM is the venue's own width x depth x HEIGHT ordering.
  const [pw, pd, ph] = publishedExtentM;

  const relative = (derived: number, published: number): number =>
    published <= 0 ? Infinity : Math.abs(derived - published) / published;

  // Try both horizontal pairings and keep the better one.
  const asMeasured = Math.max(relative(sw, pw), relative(sd, pd));
  const swapped = Math.max(relative(sw, pd), relative(sd, pw));
  const horizontal = Math.min(asMeasured, swapped);
  const worst = Math.max(horizontal, relative(sh, ph));

  const derivedText = `${sw.toFixed(1)}x${sd.toFixed(1)}x${sh.toFixed(1)}`;
  const publishedText = `${pw.toFixed(1)}x${pd.toFixed(1)}x${ph.toFixed(1)}`;

  if (worst <= ALIGNMENT_TOLERANCE) {
    return {
      verdict: "agrees",
      worstRelativeError: worst,
      detail: `Derived ${derivedText} m agrees with published ${publishedText} m (worst axis ${(worst * 100).toFixed(0)}%).`,
    };
  }

  return {
    verdict: "disagrees",
    worstRelativeError: worst,
    detail:
      `Derived ${derivedText} m disagrees with published ${publishedText} m ` +
      `(worst axis ${(worst * 100).toFixed(0)}%). Check the capture-to-room mapping before wiring this room.`,
  };
}
