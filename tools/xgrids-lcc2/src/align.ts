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


// ---------------------------------------------------------------------------
// Where the viewer stands, and how far they may go.
// ---------------------------------------------------------------------------

/**
 * A room frame built from BOTH instruments, each used where it is strong.
 *
 * The mesh sees the floor and the walk does not — the operator carried the
 * scanner at eye level, so no pose is ever on the ground. The walk sees the
 * room and the mesh does not — a capture's geometry runs on down the corridor,
 * while a person stays in the room they are scanning.
 *
 * Measured against the venue's published sizes, the walk is the better plan:
 * the Grand Hall goes from 85% out to 5%, the Saloon from 41% to 7%. So the
 * floor comes from the mesh and everything horizontal comes from the walk.
 */
export interface WalkAlignedFrame {
  /** Room centre and extent in scene metres, floor at y = 0. */
  readonly centre: readonly [number, number];
  readonly extentM: Vec3;
  /** Where to put the viewer: a pose the scanner actually occupied. */
  readonly spawn: { readonly position: Vec3; readonly yaw: number };
  /** The box the viewer may move within, in scene metres. */
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
  /** How high the scanner was carried, in metres above the mesh floor. */
  readonly eyeHeightM: number;
}

/** Rooms are not taller than this; a walk implying more has left the room. */
const MAX_WALK_HEIGHT_M = 16;

/**
 * Combines the mesh floor with the walked region.
 *
 * `spawnSource` and the walk region arrive in XGRIDS Z-up metres; everything
 * returned is scene Y-up metres with the floor at zero, matching the transform
 * the runtime applies. Under the Z-up to Y-up rotation source (x, y, z) becomes
 * scene (x, z, -y), which is why depth flips sign here.
 */
export function walkAlignedFrame(
  meshFrame: RoomFrame,
  walkMin: Vec3,
  walkMax: Vec3,
  walkMedianZ: number,
  spawnSource: Vec3,
  spawnYaw: number,
): WalkAlignedFrame {
  const floorZ = meshFrame.floorZ;
  const eyeHeightM = Math.min(Math.max(walkMedianZ - floorZ, 0.8), 3);

  // Horizontal centre from the walk; the mesh's centre includes the corridor.
  const centreX = (walkMin[0] + walkMax[0]) / 2;
  const centreY = (walkMin[1] + walkMax[1]) / 2;

  const toScene = (source: Vec3): Vec3 => [
    source[0] - centreX,
    source[2] - floorZ,
    -(source[1] - centreY),
  ];

  const a = toScene(walkMin);
  const b = toScene(walkMax);
  const min: Vec3 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
  const max: Vec3 = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];

  // Ceiling from the mesh, which can see it; the walk only knows head height.
  const ceiling = Math.min(meshFrame.ceilingZ - floorZ, MAX_WALK_HEIGHT_M);

  // Stand at eye height, not at the raw offset from a floor the mesh may have
  // misjudged. The Grand Hall's capture spans more than one level, so its mesh
  // floor sits far below the room and the unclamped offset put the viewer 6.8 m
  // up, floating near the ceiling. Eye height is already clamped to something a
  // person could be, so the spawn uses it and stays consistent with it.
  const spawnScene = toScene(spawnSource);
  const spawn: WalkAlignedFrame["spawn"] = {
    position: [spawnScene[0], eyeHeightM, spawnScene[2]],
    yaw: spawnYaw,
  };

  return {
    centre: [centreX, centreY],
    extentM: [max[0] - min[0], Math.max(ceiling, eyeHeightM + 0.5), max[2] - min[2]],
    spawn,
    bounds: {
      // The viewer moves horizontally at head height; the vertical band is the
      // headroom a person has, not the walk's own jitter.
      min: [min[0], Math.max(0.4, eyeHeightM - 0.6), min[2]],
      max: [max[0], eyeHeightM + 0.6, max[2]],
    },
    eyeHeightM,
  };
}

/**
 * The frame with its floor lifted to where the served Gaussians put it.
 *
 * The mesh's lowest dense edge is not always the floor: in five rooms it sat
 * 0.5-0.6 m under the boards (2026-09-04), so visitors stood knee-deep and
 * furniture sank. The viewer draws Gaussians, and their densest slab is the
 * floor a visitor stands on; the offset is that slab's height above the mesh
 * floor, measured by scripts/sog-floor-census.py. The ceiling stays where the
 * mesh saw it; the horizontal frame is untouched.
 */
export function withFloorOffset(frame: RoomFrame, offsetM: number): RoomFrame {
  if (offsetM === 0) return frame;
  const floorZ = frame.floorZ + offsetM;
  const min: Vec3 = [frame.min[0], frame.min[1], floorZ];
  return {
    ...frame,
    min,
    center: [frame.center[0], frame.center[1], (floorZ + frame.max[2]) / 2],
    extent: [frame.extent[0], frame.extent[1], frame.max[2] - floorZ],
    floorZ,
  };
}

/**
 * The transform that places a capture so the walked room is centred and its
 * floor rests on zero. Still never a scale.
 */
export function walkAlignedTransform(
  meshFrame: RoomFrame,
  centre: readonly [number, number],
): SceneTransform {
  return {
    position: [-centre[0], -meshFrame.floorZ, centre[1]],
    rotation: [Z_UP_TO_Y_UP_ROTATION_X, 0, 0],
    scale: 1,
  };
}
