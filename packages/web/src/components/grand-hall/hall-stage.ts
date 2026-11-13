import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_HEIGHT, HALL_WIDTH } from "./hall-spec.js";

// ---------------------------------------------------------------------------
// The stage: the Grand Hall as one picture
//
// The hall is looked at as a painter or a stage designer draws a room: from
// the door wall's side, square on to the window wall, with the picture plane
// upright. So the window wall is drawn in true elevation, every upright in the
// room is upright on the screen, and the floor runs back to it between the two
// end walls. The door wall is the missing fourth wall. Nothing floats: the
// screen's sides cut the end walls, its foot is the floor's near edge, and the
// only dark is the night above the walls, where the planner sets its words.
//
// Everything here is a measurement of that picture for one canvas, and none of
// it draws. The camera is level and looks through a lens moved down across it
// (lib/lens-shift.ts); the same picture seen by an ordinary camera, tilted, is
// what the orbit is handed when someone takes hold of the room.
// ---------------------------------------------------------------------------

type Vec3 = readonly [number, number, number];

/** The picture's proportion: the anamorphic film frame. A wider canvas is filled; a taller one keeps the rest as night. */
export const STAGE_PICTURE_RATIO = 2.39;
/** A canvas narrower than this for its height is not a wide one: no stage (a phone held upright). */
export const STAGE_MIN_CANVAS_ASPECT = 1.25;
/** A picture wider than this would put the camera below the walls' tops: no stage. */
export const STAGE_MAX_PICTURE_ASPECT = 3;
/**
 * The slope of the camera's sight to the floor's near edge: 1 is 45°, where a
 * round table at the picture's foot is drawn as deep as it is wide. Steeper,
 * an upright picture plane stretches the near floor; shallower, the far
 * tables hide one another.
 */
const NEAR_EDGE_SLOPE = 1;
/** What the picture's top edge meets: the wall's coping, a hand above the ceiling line. */
const WALL_TOP_M = HALL_HEIGHT + 0.12;
/**
 * Walls the camera stands behind are lowered to this on the stage
 * (GrandHallModel): under the floor, so nothing of the fourth wall, its doors
 * or its section is left standing along the picture's foot.
 */
export const STAGE_NEAR_CUT_M = -1;
/** The chandeliers show in the overview below this camera height on the stage: above every stage camera (the highest stands near 11.1 m). */
export const STAGE_CHANDELIER_CEILING_M = 12.5;
/** The picture's foot stands this far above the floor's near edge, clear of the skirting's line. */
const FOOT_LIP_M = 0.03;
/** Plan: the walls are cut here (HALL_CUTS.plan), and the hall keeps this much dark round it. */
const PLAN_WALL_TOP_M = 3.12;
const PLAN_MARGIN_M = 2.2;
/** Plan's lens: long, so the cut walls barely lean. */
const PLAN_FOV_DEG = 36;
/**
 * Plan's camera stands no higher than this. The orbit holds every camera to
 * its own reach (lib/camera-rig.ts, computeDistanceLimits: 1.6 times the
 * hall's length, 33.8 m), and a camera asked to stand beyond it is pulled in
 * short of where its glide was going. Where the picture is a small share of a
 * tall canvas the long lens would ask for more height than that, so the lens
 * widens instead and the hall still fills the picture.
 */
export const PLAN_MAX_HEIGHT_M = 32;
/** Plan looks from just inside the orbit's steepest angle (MIN_POLAR_ANGLE, 0.1). */
const PLAN_LEAN = Math.tan(0.107);

export interface StageLens {
  /** Vertical field of view, degrees. */
  readonly fov: number;
  /** Canvas heights the picture falls below the camera's axis (lib/lens-shift.ts). */
  readonly shiftY: number;
}

export interface HallStageFraming {
  /** Where the camera stands, outside the door wall and above it. */
  readonly position: Vec3;
  /** Held: on the window wall at the camera's own height, so the camera is level. */
  readonly heldTarget: Vec3;
  /** Let go: the middle of the floor, which the orbit turns about and the wheel closes on. */
  readonly freeTarget: Vec3;
  /** How far below level the camera looks at it, radians. */
  readonly freePitch: number;
  /** The sight lines the canvas's bottom and top edges lie on, radians below level. Every lens of the stage keeps both. */
  readonly bottomRay: number;
  readonly topRay: number;
  /** The hall's picture on the canvas, CSS px from the canvas's top: the night is above it. */
  readonly picture: { readonly top: number; readonly height: number };
  /** Plan: from above, the hall filling the picture under the night. */
  readonly plan: { readonly position: Vec3; readonly target: Vec3; readonly lens: StageLens };
}

/**
 * The stage for a canvas `widthPx` by `heightPx` whose top `skyPx` are kept
 * dark for the planner's words. Null where the canvas cannot hold it.
 */
export function hallStageFraming(widthPx: number, heightPx: number, skyPx: number): HallStageFraming | null {
  if (!(widthPx > 0) || !(heightPx > skyPx) || widthPx / heightPx < STAGE_MIN_CANVAS_ASPECT) return null;
  const pictureHeight = Math.min(widthPx / STAGE_PICTURE_RATIO, heightPx - skyPx);
  const aspect = widthPx / pictureHeight;
  if (aspect > STAGE_MAX_PICTURE_ASPECT) return null;

  // The camera stands `back` metres outside the floor's near edge and
  // NEAR_EDGE_SLOPE times as high. With the picture's foot on that edge and
  // its top on the far wall's top, the floor's near corners meet the picture's
  // foot corners at one distance only:
  //   back · aspect · (foot − top) / 2 = half the hall's length.
  const reach = NEAR_EDGE_SLOPE * HALL_WIDTH + WALL_TOP_M;
  const span = (2 * HALL_HALF_LENGTH) / aspect + FOOT_LIP_M;
  const back = (span * HALL_WIDTH) / (reach - span);
  const height = NEAR_EDGE_SLOPE * back;
  const z = HALL_HALF_WIDTH + back;

  // Slopes below level (rise over run) of the sight lines to the picture's foot and top, and to the canvas's top.
  const foot = (height - FOOT_LIP_M) / back;
  const top = (height - WALL_TOP_M) / (back + HALL_WIDTH);
  const sky = top - ((heightPx - pictureHeight) / pictureHeight) * (foot - top);

  // Plan: a long lens whose axis stands at the picture's centre on the canvas
  // (half the night's height below the canvas's own centre), from as high as
  // the cut walls' outline needs to fill the picture's height, or from the
  // orbit's reach through a wider lens where that is nearer.
  const night = heightPx - pictureHeight;
  const share = pictureHeight / heightPx;
  const planSpan = HALL_WIDTH + 2 * PLAN_MARGIN_M;
  const longLensHeight = PLAN_WALL_TOP_M + planSpan / (2 * Math.tan((PLAN_FOV_DEG * Math.PI) / 360) * share);
  const planHeight = Math.min(longLensHeight, PLAN_MAX_HEIGHT_M);
  const planFov = longLensHeight <= PLAN_MAX_HEIGHT_M
    ? PLAN_FOV_DEG
    : (2 * Math.atan(planSpan / (2 * share * (planHeight - PLAN_WALL_TOP_M))) * 180) / Math.PI;

  return {
    position: [0, height, z],
    heldTarget: [0, height, -HALL_HALF_WIDTH],
    freeTarget: [0, 0, 0],
    freePitch: Math.atan2(height, z),
    bottomRay: Math.atan(foot),
    topRay: Math.atan(sky),
    picture: { top: night, height: pictureHeight },
    plan: {
      position: [0, planHeight, planHeight * PLAN_LEAN],
      target: [0, 0, 0],
      lens: { fov: planFov, shiftY: -night / (2 * heightPx) },
    },
  };
}

function lensFor(bottomRay: number, topRay: number, pitch: number): StageLens {
  const low = Math.tan(bottomRay - pitch);
  const high = Math.tan(topRay - pitch);
  return {
    fov: (2 * Math.atan((low - high) / 2) * 180) / Math.PI,
    shiftY: (low + high) / (2 * (low - high)),
  };
}

/**
 * The lens that keeps the stage's picture, top and bottom, for a camera
 * looking `pitch` radians below level: level is the stage held, and
 * `framing.freePitch` is the lens the orbit is handed.
 */
export function stageLens(framing: HallStageFraming, pitch: number): StageLens {
  return lensFor(framing.bottomRay, framing.topRay, pitch);
}

/** A lens part of the way from one to another, as a glide carries the camera between two views. */
export function mixLens(from: StageLens, to: StageLens, share: number): StageLens {
  const t = Math.max(0, Math.min(1, share));
  return { fov: from.fov + (to.fov - from.fov) * t, shiftY: from.shiftY + (to.shiftY - from.shiftY) * t };
}

/**
 * The camera squaring itself up: what it looks at and through for `squared`
 * from 0 (let go: tilted at the floor) to 1 (held: level). The picture's top
 * and bottom stay where they are throughout; only the uprights straighten.
 */
export function stagePoseAt(framing: HallStageFraming, squared: number): { readonly target: Vec3; readonly lens: StageLens } {
  const share = Math.max(0, Math.min(1, squared));
  const pitch = (1 - share) * framing.freePitch;
  const [x, y, z] = framing.position;
  const freeReach = Math.hypot(framing.freeTarget[1] - y, framing.freeTarget[2] - z);
  const heldReach = z - framing.heldTarget[2];
  const reach = freeReach + (heldReach - freeReach) * share;
  return {
    target: [x, y - Math.sin(pitch) * reach, z - Math.cos(pitch) * reach],
    lens: stageLens(framing, pitch),
  };
}
