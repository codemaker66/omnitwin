import { e57PointToThree } from "../twin-basis.js";
import {
  TAG_EXAMPLE_ACCESS_BODY,
  TAG_EXAMPLE_ACCESS_TITLE,
  TAG_EXAMPLE_AV_BODY,
  TAG_EXAMPLE_AV_TITLE,
  TAG_EXAMPLE_FEATURE_BODY,
  TAG_EXAMPLE_FEATURE_TITLE,
  TAG_EXAMPLE_POWER_BODY,
  TAG_EXAMPLE_POWER_TITLE,
  TAG_KIND_ACCESS_LABEL,
  TAG_KIND_AV_LABEL,
  TAG_KIND_FEATURE_LABEL,
  TAG_KIND_POWER_LABEL,
  TAG_KIND_SERVICE_LABEL,
} from "./tag-copy.js";

// -----------------------------------------------------------------------------
// tag-model — the room note (Matterport calls it a Mattertag), as pure maths.
//
// A note is a point in the building with something to say about it. This module
// owns everything that can be decided without a renderer: where a note's anchor
// lands on the glass, whether it is in front of you at all, whether the mesh is
// between you and it, how big and how solid its pin should read, and — the part
// that is not maths but is still geometry — whether the pin would land beneath a
// piece of HUD chrome. TagLayer.tsx draws the answers and nothing else.
//
// NO three.js IMPORT, deliberately, exactly as measure-math.ts avoids one. The
// projection here is eight lines of dot products; pulling in a renderer to get
// them would make the whole feature untestable without a canvas and would hide
// the one piece of arithmetic most worth reading.
//
// THE AXIS CONVENTION IS NOT REDERIVED HERE. Anchors are authored in E57 capture
// metres — the frame the venue's own drawings and the forge both speak — and
// reach three-space through `e57PointToThree`, the pinned map in twin-basis.ts.
// Writing `[x, z, -y]` inline would be a second copy of a convention that has
// exactly one correct spelling, and a sign flip in it is invisible: every note
// would still draw, just mirrored through the floor or spun a quarter turn, so
// a "Power drop" on the north wall would quietly appear on the south one. The
// suite pins this with a case that fails on a flipped sign rather than trusting
// the call site to be read carefully.
//
// NOTE IDENTITY IS AUTHORED, NEVER INFERRED — the same law twin-rooms.ts states
// for rooms, for the same reason. `visibleFrom` is an explicit allowlist of
// viewpoints, not a radius. It is tempting to show every note within n metres:
// it is also wrong, because a note two metres away may be through a wall, and a
// pin floating on the far side of a closed door tells the guest the product does
// not know where anything is. A note appears where a human said it appears.
// -----------------------------------------------------------------------------

/** A point or direction in a right-handed 3-space, metres. Tuple, not a class,
 *  so this module needs no renderer and every value is trivially literal in a
 *  test. */
export type TagVec3 = readonly [number, number, number];

/** The five categories a venue planner actually asks about standing in a room.
 *  Closed on purpose: the glyph set, the colour ramp and the accessible name
 *  prefix are all keyed off it, so a sixth kind is a deliberate change to three
 *  files rather than a free-text field that renders as a blank pin. */
export type TagKind = "power" | "av" | "access" | "service" | "feature";

/** The human label for each kind, joined from tag-copy so no surface invents a
 *  second name for the same category. */
export const TAG_KIND_LABELS: Readonly<Record<TagKind, string>> = Object.freeze({
  power: TAG_KIND_POWER_LABEL,
  av: TAG_KIND_AV_LABEL,
  access: TAG_KIND_ACCESS_LABEL,
  service: TAG_KIND_SERVICE_LABEL,
  feature: TAG_KIND_FEATURE_LABEL,
});

/**
 * Optional media on a note. A closed union rather than an open `media?: unknown`
 * so the card can never be handed something it has no branch for.
 *
 * `alt` is required on an image, with no default and no empty-string escape:
 * a decorative photograph is a coherent idea, but a photograph attached to a
 * factual note about a building is never decorative, and the one place a
 * missing alt is guaranteed to hurt is the surface a planner uses to decide
 * where the caterers come in.
 */
export type TagMedia =
  | { readonly kind: "image"; readonly src: string; readonly alt: string }
  | { readonly kind: "link"; readonly href: string; readonly label: string };

/**
 * WHERE REAL CONTENT COMES FROM — this field is the whole answer, and it is a
 * required discriminant rather than an optional flag so that authoring a note
 * without deciding is a type error rather than a silent promotion to fact.
 *
 *   "example"        Shipped by us to demonstrate the mechanism. The card
 *                    renders a badge and a disclosure sentence for these, and
 *                    TagLayer has no route that renders the body without them.
 *   "venue-supplied" Written by the venue about their own building. Renders
 *                    plain, because it is theirs and it is true.
 *
 * There is deliberately no third value for "derived from the model". Nothing in
 * this capture can produce a fact about a socket or a rigging point, so a note
 * claiming that provenance would be a fabrication wearing a label.
 */
export type TagProvenance = "example" | "venue-supplied";

/** One note: a point in the building with something to say about it. */
export interface TwinTag {
  /** Stable id. Used as the React key, the open/closed key the host holds, and
   *  the occlusion-sample key — so it must survive a re-fetch of the note set. */
  readonly id: string;
  readonly kind: TagKind;
  readonly provenance: TagProvenance;
  /** The anchor in E57 CAPTURE metres (Z-up), the frame the venue's drawings
   *  and the forge both speak. Converted through twin-basis, never by hand. */
  readonly anchorE57: TagVec3;
  /** Outward surface normal at the anchor, in E57 metres, or null when the note
   *  hangs in space rather than on a face. Drives the grazing fade only: a note
   *  on a wall you are sliding along edge-on is a note you cannot read, and a
   *  pin that stays at full strength there reads as pasted on the lens. Null
   *  means "always face-on", which is the honest default for a note with no
   *  authored face. */
  readonly facingE57: TagVec3 | null;
  readonly title: string;
  readonly body: string;
  readonly media?: TagMedia;
  /** The viewpoint this note reads best from — offered as a walk target when
   *  the guest is standing somewhere else. */
  readonly bestViewedFrom: string;
  /** The viewpoints this note may appear from, as an explicit allowlist. Never
   *  a radius; see the module header. Must contain `bestViewedFrom`. */
  readonly visibleFrom: readonly string[];
}

/** Stage size in CSS pixels — what the keep-out arithmetic needs and the only
 *  thing this module knows about the DOM. */
export interface TagStage {
  readonly widthPx: number;
  readonly heightPx: number;
}

/** An axis-aligned box in stage pixels, origin top-left. */
export interface TagRect {
  readonly id: string;
  readonly xPx: number;
  readonly yPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * The camera, as the six numbers a projection needs.
 *
 * `rightThree` is NOT a prop: it is derived as forward × up, and `up` is then
 * re-derived as right × forward so the basis this module projects with is
 * orthonormal even when the host hands over a roughly-right up vector. Three
 * hand-supplied axes is three chances for the host to pass an inconsistent
 * basis, and an inconsistent basis mirrors the layer without failing anything.
 */
export interface TagCamera {
  /** Camera position, three.js world metres. */
  readonly positionThree: TagVec3;
  /** Unit vector the camera looks along, three.js world. */
  readonly forwardThree: TagVec3;
  /** Approximate world up, three.js world. Orthonormalised here. */
  readonly upThree: TagVec3;
  /** VERTICAL field of view, radians — three's `PerspectiveCamera.fov` is
   *  vertical and in DEGREES, so the host converts once at the boundary rather
   *  than this module guessing which it was handed. */
  readonly fovYRad: number;
  /** Stage width ÷ height. */
  readonly aspect: number;
}

/** Why a note is, or is not, on the glass right now. Every rejection has its own
 *  name so a test can assert the REASON, not merely the absence — the two are
 *  very different bugs and a boolean cannot tell them apart. */
export type TagVisibility =
  | "visible"
  /** Not authored for this viewpoint. */
  | "not-here"
  /** Behind the camera. Must never draw: a note behind you rendered in front of
   *  you is the projection lying about the building. */
  | "behind-camera"
  /** In front, but outside the frame. */
  | "off-stage"
  /** Would land under a piece of HUD chrome. */
  | "under-hud"
  /** The mesh is between the camera and the anchor. */
  | "occluded"
  /** Seen so close to edge-on that its face is unreadable. */
  | "grazing";

/** A note, placed. `stageX`/`stageY` are FRACTIONS of the stage (0,0 top-left)
 *  so the layer draws in percentages and a resize needs no re-projection. */
export interface TagPlacement {
  readonly tag: TwinTag;
  readonly visibility: TagVisibility;
  /** Fraction across the stage. Meaningless unless `visibility` is "visible" or
   *  "under-hud"/"grazing" — the two rejections that still have a position. */
  readonly stageX: number;
  readonly stageY: number;
  /** Metres along the camera's forward axis. Negative behind the camera. */
  readonly depthM: number;
  /** Pin scale multiplier — presence with distance. */
  readonly scale: number;
  /** Pin opacity from the grazing fade, 0…1. */
  readonly opacity: number;
}

// — vector helpers. Tuples in, tuples out; no allocation-heavy class anywhere. —

function sub(a: TagVec3, b: TagVec3): TagVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: TagVec3, b: TagVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: TagVec3, b: TagVec3): TagVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Unit vector, or null for a zero-length input. Null rather than a silent
 *  [0,0,0]: a degenerate basis must be caught at its source, not propagated as
 *  a plausible-looking direction that projects everything to the centre. */
function normalise(v: TagVec3): TagVec3 | null {
  const length = Math.sqrt(dot(v, v));
  if (!(length > 1e-9)) {
    return null;
  }
  return [v[0] / length, v[1] / length, v[2] / length];
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Hermite smoothstep. Used for the grazing fade so the pin dissolves rather
 *  than switching off at a threshold — a hard cut reads as a rendering fault. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The anchor in three.js world metres.
 *
 * One line, exported anyway: it is the single seam between authored capture
 * coordinates and render space, and a named function is what lets the suite pin
 * the convention (and what stops the next reader inlining `[x, z, -y]` at a
 * fourth call site).
 */
export function tagAnchorThree(tag: TwinTag): TagVec3 {
  return e57PointToThree(tag.anchorE57);
}

/**
 * The outward normal in three.js world metres, or null when the note has none.
 *
 * `e57PointToThree` is LINEAR, so it carries directions as faithfully as points,
 * and using the same map here is what keeps a wall's normal agreeing with the
 * wall's position. twin-basis records the one place this reasoning does NOT
 * hold — the scanner-frame direction map M — and a surface normal authored in
 * E57 WORLD metres is not that case.
 */
export function tagFacingThree(tag: TwinTag): TagVec3 | null {
  if (tag.facingE57 === null) {
    return null;
  }
  return normalise(e57PointToThree(tag.facingE57));
}

/** The notes authored for a viewpoint. An allowlist read, never a distance
 *  test — see the module header. */
export function tagsVisibleFromNode(
  tags: readonly TwinTag[],
  nodeId: string,
): readonly TwinTag[] {
  return tags.filter((tag) => tag.visibleFrom.includes(nodeId));
}

/**
 * An authoring fault in a note, as a sentence, or null when it is well-formed.
 *
 * Not a schema and not a thrown error: this is a developer-facing lint for the
 * note set, run by the suite over everything we ship. It exists because the two
 * mistakes it catches are both invisible at runtime — a note whose best view is
 * not among its visible viewpoints simply never offers its walk button, and a
 * zero-length normal fades the pin to nothing at every angle. Both look like
 * "the feature is a bit broken" rather than "this note is wrong".
 */
export function findTagAuthoringFault(tag: TwinTag): string | null {
  if (tag.visibleFrom.length === 0) {
    return `Tag "${tag.id}" is visible from no viewpoint, so it can never render.`;
  }
  if (!tag.visibleFrom.includes(tag.bestViewedFrom)) {
    return `Tag "${tag.id}" names a best view (${tag.bestViewedFrom}) outside its own visibleFrom list.`;
  }
  if (tag.facingE57 !== null && normalise(tag.facingE57) === null) {
    return `Tag "${tag.id}" has a zero-length facing normal, which would fade its pin away at every angle.`;
  }
  if (tag.title.trim() === "" || tag.body.trim() === "") {
    return `Tag "${tag.id}" has an empty title or body.`;
  }
  return null;
}

// — projection —

/** Where an anchor lands, and how far away it is. */
export interface TagProjection {
  /** Fraction across the stage, 0…1 at the frame edges — but NOT clamped, so a
   *  caller can tell "just off the left edge" from "far behind you". */
  readonly stageX: number;
  readonly stageY: number;
  /** Metres along forward. Negative means behind the camera. */
  readonly depthM: number;
  readonly behindCamera: boolean;
}

/**
 * Closer than this to the eye and the projection is meaningless — the division
 * by depth explodes and a note half a centimetre in front of the lens would
 * smear across the whole frame. Treated as behind the camera.
 */
export const TAG_NEAR_M = 0.08;

/**
 * Project a world point onto the stage.
 *
 * The standard pinhole projection, written out rather than borrowed:
 *
 *   rel   = point − eye
 *   z     = rel · forward            (depth along the view axis)
 *   x     = rel · right
 *   y     = rel · up
 *   ndcX  = (x / z) / (tan(fovY/2) · aspect)
 *   ndcY  = (y / z) / tan(fovY/2)
 *   stage = ((ndcX + 1)/2, (1 − ndcY)/2)
 *
 * The y flip in the last line is the whole reason this is not symmetric: NDC is
 * y-up and a stage fraction is y-down, so a note near the CEILING must come back
 * with a SMALL stageY. That flip is pinned by its own test, because getting it
 * backwards produces a layer that works perfectly except that every note is
 * mirrored about the horizon — which reads as a camera bug, not a maths bug.
 *
 * A degenerate camera basis (zero-length forward or a forward parallel to up)
 * returns `behindCamera`, i.e. draws nothing. Drawing at a guessed position
 * would put notes on the wrong part of a real room.
 */
export function projectToStage(pointThree: TagVec3, camera: TagCamera): TagProjection {
  const forward = normalise(camera.forwardThree);
  const roughUp = normalise(camera.upThree);
  const behind: TagProjection = {
    stageX: 0.5,
    stageY: 0.5,
    depthM: Number.NEGATIVE_INFINITY,
    behindCamera: true,
  };
  if (forward === null || roughUp === null) {
    return behind;
  }
  // Orthonormalise: right ⟂ both, then up ⟂ right and forward. In three's
  // right-handed frame with forward = −Z and up = +Y this yields right = +X,
  // which is what makes a note to the camera's right come back with stageX > ½.
  const right = normalise(cross(forward, roughUp));
  if (right === null) {
    // forward ∥ up — the host handed over a basis with no horizontal axis.
    return behind;
  }
  const up = cross(right, forward);

  const rel = sub(pointThree, camera.positionThree);
  const depthM = dot(rel, forward);
  if (depthM < TAG_NEAR_M) {
    return { stageX: 0.5, stageY: 0.5, depthM, behindCamera: true };
  }

  const halfHeight = Math.tan(camera.fovYRad / 2);
  const ndcY = dot(rel, up) / (depthM * halfHeight);
  const ndcX = dot(rel, right) / (depthM * halfHeight * camera.aspect);

  return {
    stageX: (ndcX + 1) / 2,
    stageY: (1 - ndcY) / 2,
    depthM,
    behindCamera: false,
  };
}

// — presence with distance —

/** The depth a pin reads at its natural size. Roughly the far side of a
 *  conversation: near enough that the pin is clearly in the room with you. */
export const TAG_SCALE_REFERENCE_M = 4;
export const TAG_SCALE_MIN = 0.42;
export const TAG_SCALE_MAX = 1.15;

/**
 * How big a pin's DISC reads at a given depth. Not its hit target — see below.
 *
 * NOT the true 1/depth of perspective, and the departure is deliberate: a pin
 * that scaled honestly would be 19% of its near size at the far end of the Grand
 * Hall, which is a smudge. The CUBE ROOT compresses the range so distance is
 * still felt (a far pin is visibly smaller and sits behind a near one) across
 * the whole depth of a real room.
 *
 * WHY CUBE ROOT AND NOT SQUARE ROOT, which is what this shipped with first. A
 * square root reaches the floor at 4 / 0.62² ≈ 10.4 m, so in a 21 m hall every
 * note beyond the halfway point rendered at exactly the same size and the far
 * half of the room went flat — the depth cue silently switching off in the
 * largest room the venue has. The cube root holds the floor off until ~54 m,
 * which is past the longest sight line in the building.
 *
 * WHY THE FLOOR MAY BE THIS LOW AT ALL. The floor is not a tappability
 * constraint, because tappability is not this function's job: TagLayer gives
 * every pin a constant 44 px hit target and scales only the disc drawn inside
 * it (tags.css, `.vv-twin-tag-pin`). Decoupling them is what lets the disc read
 * honestly small at distance without the control becoming impossible to press —
 * the two requirements that were in direct conflict while one number served
 * both. The floor now exists only so a very distant pin stays visible at all.
 */
export function tagScaleForDepth(depthM: number): number {
  if (!(depthM > 0)) {
    return TAG_SCALE_MIN;
  }
  return clamp(Math.cbrt(TAG_SCALE_REFERENCE_M / depthM), TAG_SCALE_MIN, TAG_SCALE_MAX);
}

/** Below this cosine the face is edge-on enough to be unreadable; above the
 *  second, it is face-on. Between them the pin fades rather than switching. */
export const TAG_GRAZE_HIDDEN_COS = 0.15;
export const TAG_GRAZE_FULL_COS = 0.45;

/**
 * Pin opacity for a note on a face, given where it is being looked at from.
 *
 * `cosIncidence` is the normal dotted with the unit direction from the anchor
 * BACK to the eye: 1 when you are square on to the face, 0 when you are sliding
 * along it, negative when you are behind it. A note with no authored face
 * returns 1 — always face-on — which is the honest default rather than a fade
 * derived from a normal nobody supplied.
 */
export function tagGrazingOpacity(cosIncidence: number): number {
  return smoothstep(TAG_GRAZE_HIDDEN_COS, TAG_GRAZE_FULL_COS, cosIncidence);
}

/**
 * How much nearer than the note a solid surface has to be before the note is
 * called occluded. Notes sit ON walls, so the sample and the anchor agree to
 * within the thickness of the plaster; without a margin every wall-mounted note
 * would occlude itself.
 */
export const TAG_OCCLUSION_MARGIN_M = 0.25;

/**
 * True when the host's depth sample says something solid is between the eye and
 * the note.
 *
 * `sampledDepthM` is the distance to the first surface along the ray to the
 * anchor, or null when the host cannot sample (no mesh loaded, ray missed). Null
 * means NOT occluded: with no evidence the note is behind something, hiding it
 * would silently empty the layer wherever the collider has a hole, and a feature
 * that disappears without explanation is worse than one that occasionally shows
 * a pin through a pillar.
 */
export function isOccluded(depthM: number, sampledDepthM: number | null): boolean {
  if (sampledDepthM === null) {
    return false;
  }
  return sampledDepthM < depthM - TAG_OCCLUSION_MARGIN_M;
}

// -----------------------------------------------------------------------------
// HUD KEEP-OUT — the reason a pin never lands under another control.
//
// Every rect below was MEASURED off the running /tour route with
// getBoundingClientRect at the three viewports the layout is reconciled at
// (1440×900, 390×844, 844×390), in the WORST-CASE HUD state: standing at a
// verified viewpoint, so the room dossier is open, with the coach hint still
// up. Worst case is the right case — chrome that is sometimes absent is chrome
// a pin may not hide under when it is present.
//
// Two tables, not three: the twin's stylesheets break at `max-width: 700px`, so
// a landscape phone (844×390) is laid out with the REGULAR insets and only its
// stage height differs. That is why the landscape collision the last panel hit
// is caught here by the same table the desktop uses, evaluated at a short stage.
//
// A pin that lands in one of these rects is not moved. It is DROPPED, and that
// is a considered choice: nudging a pin aside would put a note about a power
// drop somewhere the power drop is not, and in a product whose entire claim is
// "this is where things are in the building", a pin in the wrong place is worse
// than no pin. The anchor returns the moment the camera moves — see the
// residual note in TagLayer.tsx about what that costs a keyboard user.
//
// The host may override the whole table via `placeTags`'s `hudRects` option
// when it has live measurements (the dossier's height varies with its content,
// and these figures are one snapshot of it).
// -----------------------------------------------------------------------------

/** Which stage edge a HUD rect is pinned to. */
type HudAnchor =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "bottom-centre";

interface HudSpec {
  readonly id: string;
  readonly anchor: HudAnchor;
  readonly insetXPx: number;
  readonly insetYPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** The stage width at or below which the twin's stylesheets use phone insets.
 *  Mirrors the `max-width: 700px` breakpoint in twin.css and every
 *  component-adjacent sheet beside it. */
export const TAG_COMPACT_MAX_WIDTH_PX = 700;

/** Measured at 1440×900 and re-measured at 844×390 — identical insets, as the
 *  700px breakpoint predicts. */
const HUD_REGULAR: readonly HudSpec[] = [
  { id: "node-label", anchor: "top-left", insetXPx: 18, insetYPx: 18, widthPx: 300, heightPx: 31 },
  { id: "dossier", anchor: "top-left", insetXPx: 18, insetYPx: 62, widthPx: 340, heightPx: 237 },
  { id: "mode", anchor: "top-right", insetXPx: 18, insetYPx: 18, widthPx: 240, heightPx: 37 },
  { id: "surface", anchor: "top-right", insetXPx: 18, insetYPx: 62, widthPx: 103, heightPx: 33 },
  { id: "controls", anchor: "top-right", insetXPx: 18, insetYPx: 106, widthPx: 112, heightPx: 131 },
  { id: "quick", anchor: "bottom-left", insetXPx: 18, insetYPx: 56, widthPx: 243, heightPx: 165 },
  { id: "disclosure", anchor: "bottom-left", insetXPx: 18, insetYPx: 14, widthPx: 416, heightPx: 33 },
  { id: "minimap", anchor: "bottom-right", insetXPx: 18, insetYPx: 18, widthPx: 222, heightPx: 254 },
  { id: "coach", anchor: "bottom-centre", insetXPx: 0, insetYPx: 64, widthPx: 360, heightPx: 37 },
];

/** Measured at 390×844. */
const HUD_COMPACT: readonly HudSpec[] = [
  { id: "node-label", anchor: "top-left", insetXPx: 12, insetYPx: 12, widthPx: 160, heightPx: 26 },
  { id: "dossier", anchor: "top-left", insetXPx: 12, insetYPx: 56, widthPx: 260, heightPx: 250 },
  { id: "mode", anchor: "top-right", insetXPx: 12, insetYPx: 12, widthPx: 190, heightPx: 33 },
  { id: "surface", anchor: "top-right", insetXPx: 12, insetYPx: 52, widthPx: 87, heightPx: 29 },
  { id: "controls", anchor: "top-right", insetXPx: 12, insetYPx: 88, widthPx: 96, heightPx: 73 },
  { id: "quick", anchor: "bottom-left", insetXPx: 12, insetYPx: 88, widthPx: 220, heightPx: 43 },
  { id: "disclosure", anchor: "bottom-left", insetXPx: 12, insetYPx: 10, widthPx: 366, heightPx: 33 },
  { id: "minimap", anchor: "bottom-right", insetXPx: 12, insetYPx: 58, widthPx: 150, heightPx: 166 },
  { id: "coach", anchor: "bottom-centre", insetXPx: 0, insetYPx: 64, widthPx: 360, heightPx: 37 },
];

function resolveSpec(spec: HudSpec, stage: TagStage): TagRect {
  const xPx =
    spec.anchor === "top-left" || spec.anchor === "bottom-left"
      ? spec.insetXPx
      : spec.anchor === "bottom-centre"
        ? (stage.widthPx - spec.widthPx) / 2
        : stage.widthPx - spec.insetXPx - spec.widthPx;
  const yPx =
    spec.anchor === "top-left" || spec.anchor === "top-right"
      ? spec.insetYPx
      : stage.heightPx - spec.insetYPx - spec.heightPx;
  return { id: spec.id, xPx, yPx, widthPx: spec.widthPx, heightPx: spec.heightPx };
}

/** Every occupied HUD rect at this stage size, in stage pixels. */
export function hudKeepOutRects(stage: TagStage): readonly TagRect[] {
  const specs = stage.widthPx <= TAG_COMPACT_MAX_WIDTH_PX ? HUD_COMPACT : HUD_REGULAR;
  return specs.map((spec) => resolveSpec(spec, stage));
}

/** A pin's own radius in stage pixels at scale 1 — the pin is a circle, so the
 *  keep-out test inflates each HUD rect by this much rather than testing the
 *  centre point alone. A pin whose EDGE tucks under the minimap is still a pin
 *  under the minimap. */
export const TAG_PIN_RADIUS_PX = 17;

/** True when a pin centred at these stage fractions would touch HUD chrome. */
export function isUnderHud(
  stageX: number,
  stageY: number,
  stage: TagStage,
  rects: readonly TagRect[] = hudKeepOutRects(stage),
): boolean {
  const xPx = stageX * stage.widthPx;
  const yPx = stageY * stage.heightPx;
  return rects.some(
    (rect) =>
      xPx >= rect.xPx - TAG_PIN_RADIUS_PX &&
      xPx <= rect.xPx + rect.widthPx + TAG_PIN_RADIUS_PX &&
      yPx >= rect.yPx - TAG_PIN_RADIUS_PX &&
      yPx <= rect.yPx + rect.heightPx + TAG_PIN_RADIUS_PX,
  );
}

// -----------------------------------------------------------------------------
// THE CARD'S CLEAR BOX — the one rectangle on the stage no HUD element reaches.
//
// The open card is the only part of this feature that cannot be dropped when it
// collides: a guest who pressed a pin must get the note. So instead of dropping
// it, the card is CLAMPED into the box below, which is disjoint from every rect
// in the keep-out table by construction — and, more to the point, by test:
// tag-model.test.ts asserts the disjointness at all three reconciled viewports
// rather than leaving it as a claim in a comment. That test is the thing that
// would have caught the panel which shipped over Share and Fullscreen.
//
// Regular insets clear the dossier on the left (right edge 358) and, on the
// right, the minimap (left edge 1200 at 1440 wide; 604 at 844 wide) — the top
// inset of 63 drops the box below the mode switcher, which is why the box may
// run further right than the mode control's own left edge without touching it.
//
// Compact is a different shape entirely: the phone's left and right columns
// leave no central corridor, but they both END, so the box is the full-width
// band between the dossier's bottom (306) and the minimap's top (620).
// -----------------------------------------------------------------------------

interface ClearInsets {
  readonly leftPx: number;
  readonly rightPx: number;
  readonly topPx: number;
  readonly bottomPx: number;
}

const CLEAR_REGULAR: ClearInsets = { leftPx: 366, rightPx: 248, topPx: 63, bottomPx: 108 };
const CLEAR_COMPACT: ClearInsets = { leftPx: 20, rightPx: 20, topPx: 314, bottomPx: 232 };

/**
 * The rectangle the open card must stay inside.
 *
 * Degenerate stages (a viewport smaller than the insets themselves) collapse to
 * a zero-size box rather than an inverted one, so a clamp against it still
 * returns a point on the stage instead of a NaN or a negative width.
 */
export function tagCardClearBox(stage: TagStage): TagRect {
  const insets = stage.widthPx <= TAG_COMPACT_MAX_WIDTH_PX ? CLEAR_COMPACT : CLEAR_REGULAR;
  const widthPx = Math.max(0, stage.widthPx - insets.leftPx - insets.rightPx);
  const heightPx = Math.max(0, stage.heightPx - insets.topPx - insets.bottomPx);
  return { id: "card-clear-box", xPx: insets.leftPx, yPx: insets.topPx, widthPx, heightPx };
}

/** Where the card's top-left corner goes, in stage pixels, for a card of this
 *  size opened from a pin at these stage fractions.
 *
 *  The card wants to sit just below its pin and centred on it — the position
 *  that reads as "this belongs to that" — and is then clamped into the clear
 *  box. Clamping rather than flipping keeps the motion predictable: the card
 *  always grows from the same corner, so the spring never appears to launch
 *  from a different place depending on where you stood. */
export function tagCardPosition(
  stageX: number,
  stageY: number,
  cardWidthPx: number,
  cardHeightPx: number,
  stage: TagStage,
): { readonly xPx: number; readonly yPx: number } {
  const box = tagCardClearBox(stage);
  const wantedX = stageX * stage.widthPx - cardWidthPx / 2;
  const wantedY = stageY * stage.heightPx + TAG_PIN_RADIUS_PX + 10;
  return {
    xPx: clamp(wantedX, box.xPx, Math.max(box.xPx, box.xPx + box.widthPx - cardWidthPx)),
    yPx: clamp(wantedY, box.yPx, Math.max(box.yPx, box.yPx + box.heightPx - cardHeightPx)),
  };
}

// — placement —

export interface TagPlacementOptions {
  /** Live-measured HUD rects, when the host has them. Defaults to the measured
   *  table above. */
  readonly hudRects?: readonly TagRect[];
  /** Distance to the first solid surface along the ray to each note's anchor,
   *  by tag id. Absent or null → no evidence → not occluded. */
  readonly occlusionDepthsM?: ReadonlyMap<string, number | null>;
}

/**
 * Place every note authored for this viewpoint, nearest LAST.
 *
 * The sort is the painter's order the layer relies on: DOM order is paint order,
 * so emitting far notes first means a near pin overlaps a far one rather than
 * being hidden behind it. Sorting the other way is not a crash, it is a layer
 * where the thing next to you hides behind the thing across the room — which
 * reads as depth being broken.
 *
 * Notes rejected for any reason are RETURNED, carrying their reason, rather than
 * filtered out here. The layer filters; the tests assert reasons. A function
 * that silently dropped them would make "why is my note missing" undebuggable.
 */
export function placeTags(
  tags: readonly TwinTag[],
  nodeId: string,
  camera: TagCamera,
  stage: TagStage,
  options: TagPlacementOptions = {},
): readonly TagPlacement[] {
  const rects = options.hudRects ?? hudKeepOutRects(stage);

  const placed = tags.map((tag): TagPlacement => {
    if (!tag.visibleFrom.includes(nodeId)) {
      return {
        tag,
        visibility: "not-here",
        stageX: 0.5,
        stageY: 0.5,
        depthM: Number.NEGATIVE_INFINITY,
        scale: TAG_SCALE_MIN,
        opacity: 0,
      };
    }

    const anchor = tagAnchorThree(tag);
    const projection = projectToStage(anchor, camera);
    const scale = tagScaleForDepth(projection.depthM);

    // The grazing fade needs the direction from the note back to the eye.
    const facing = tagFacingThree(tag);
    const toEye = normalise(sub(camera.positionThree, anchor));
    const opacity =
      facing === null || toEye === null ? 1 : tagGrazingOpacity(dot(facing, toEye));

    const base = {
      tag,
      stageX: projection.stageX,
      stageY: projection.stageY,
      depthM: projection.depthM,
      scale,
      opacity,
    };

    if (projection.behindCamera) {
      return { ...base, visibility: "behind-camera", opacity: 0 };
    }
    if (
      projection.stageX < 0 ||
      projection.stageX > 1 ||
      projection.stageY < 0 ||
      projection.stageY > 1
    ) {
      return { ...base, visibility: "off-stage" };
    }
    if (isOccluded(projection.depthM, options.occlusionDepthsM?.get(tag.id) ?? null)) {
      return { ...base, visibility: "occluded" };
    }
    if (opacity <= 0) {
      return { ...base, visibility: "grazing" };
    }
    if (isUnderHud(projection.stageX, projection.stageY, stage, rects)) {
      return { ...base, visibility: "under-hud" };
    }
    return { ...base, visibility: "visible" };
  });

  // Copy before sorting: `tags` is the caller's array and `.map` already gave us
  // our own, but making the intent explicit keeps a future refactor from sorting
  // a borrowed list in place. Far first, near last.
  return [...placed].sort((a, b) => b.depthM - a.depthM);
}

/** The placements a layer should actually draw. */
export function drawableTags(placements: readonly TagPlacement[]): readonly TagPlacement[] {
  return placements.filter((placement) => placement.visibility === "visible");
}

// -----------------------------------------------------------------------------
// THE EXAMPLE SET — the mechanism, demonstrated, and marked as such everywhere.
//
// Four notes around scan_028, a viewpoint whose room identity twin-rooms.ts has
// validated against ground-truth photography. Their anchors are offsets from
// that viewpoint's own manifest pose, so they land in plausible parts of the
// room rather than at invented coordinates — but they are PLACEMENTS, not
// survey positions, and every one of them carries `provenance: "example"`, which
// is what makes the card render its badge and its disclosure sentence.
//
// Not one of these notes states a fact about Trades Hall. Their bodies describe
// the kind of thing the venue writes there (tag-copy.ts explains why at length).
// The set exists so a reader can see what a populated walkthrough looks like and
// so the layer has something to render in a test and a screenshot; it is not
// content, and swapping it for the venue's own notes is a change to this array
// and nothing else.
// -----------------------------------------------------------------------------

/** scan_028's pose translation in the live manifest, E57 metres. Named rather
 *  than inlined so the offsets below read as offsets. */
const EXAMPLE_ORIGIN_E57: TagVec3 = [14.89, -3.54, 1.53];

function offsetFromOrigin(dx: number, dy: number, dz: number): TagVec3 {
  return [
    EXAMPLE_ORIGIN_E57[0] + dx,
    EXAMPLE_ORIGIN_E57[1] + dy,
    EXAMPLE_ORIGIN_E57[2] + dz,
  ];
}

export const EXAMPLE_TAGS: readonly TwinTag[] = Object.freeze([
  {
    id: "example-power",
    kind: "power",
    provenance: "example",
    // Low on the long wall, at skirting height.
    anchorE57: offsetFromOrigin(0.6, -4.5, -1.2),
    facingE57: [0, 1, 0],
    title: TAG_EXAMPLE_POWER_TITLE,
    body: TAG_EXAMPLE_POWER_BODY,
    bestViewedFrom: "scan_028",
    visibleFrom: ["scan_028", "scan_046"],
  },
  {
    id: "example-av",
    kind: "av",
    provenance: "example",
    // Above head height and set back along the hall, so it reads as a natural
    // glance up (~35° of elevation) rather than a crick in the neck. Placed
    // directly overhead it was invisible at every heading without pitching the
    // camera almost vertical — a demo nobody would find.
    anchorE57: offsetFromOrigin(-4.5, -0.1, 3.2),
    facingE57: [0, 0, -1],
    title: TAG_EXAMPLE_AV_TITLE,
    body: TAG_EXAMPLE_AV_BODY,
    bestViewedFrom: "scan_028",
    visibleFrom: ["scan_028"],
  },
  {
    id: "example-access",
    kind: "access",
    provenance: "example",
    // Along the room's long axis, at door-handle height.
    anchorE57: offsetFromOrigin(3.6, -0.05, -0.5),
    facingE57: [-1, 0, 0],
    title: TAG_EXAMPLE_ACCESS_TITLE,
    body: TAG_EXAMPLE_ACCESS_BODY,
    bestViewedFrom: "scan_028",
    visibleFrom: ["scan_028"],
  },
  {
    id: "example-feature",
    kind: "feature",
    provenance: "example",
    // On the opposite long wall.
    anchorE57: offsetFromOrigin(-1.9, 4.5, -0.4),
    facingE57: [0, -1, 0],
    title: TAG_EXAMPLE_FEATURE_TITLE,
    body: TAG_EXAMPLE_FEATURE_BODY,
    bestViewedFrom: "scan_028",
    visibleFrom: ["scan_028"],
  },
] as const satisfies readonly TwinTag[]);
