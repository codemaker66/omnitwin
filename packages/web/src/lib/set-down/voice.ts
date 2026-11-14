// ---------------------------------------------------------------------------
// One set-down's render input, gathered on the main thread (T-700).
//
// Everything a render needs that only the planner knows: the piece's body at
// its scale, what each foot stands on, where the sound starts and where it is
// heard, how the piece came down, and the room's early reflections. The
// render itself runs elsewhere; this only gathers, and is pure.
// ---------------------------------------------------------------------------

import { toRealWorld, toRenderSpace } from "../../constants/scale.js";
import type { RoomGeometry } from "../../data/room-geometries.js";
import { getCatalogueItem } from "../catalogue.js";
import { findSupportingItem, type PlacedItem } from "../placement.js";
import { bodyFor, type SetDownBody } from "./bodies.js";
import { clampEarToRoom, directPath, type Ear } from "./listener.js";
import { earlyReflections, reflectionRoomFor, type Vec3 } from "./reflections.js";
import type { SetDownInput } from "./render.js";
import type { RoomAcoustics } from "./rooms.js";
import { surfaceKindForSupport, surfaceResponse, type SurfaceResponse } from "./surfaces.js";

/**
 * How a piece came down: dropped in from the drawer, let go from the hand, or
 * set down by a resting hand. Task 11 gives lib/furniture-motion.ts the same
 * union as FurnitureLanding; this becomes an import of it once both are on
 * one branch. Being a string union, the motion's values pass here unchanged.
 */
type FurnitureLanding = "drop-in" | "let-go" | "set-down";

/** A let-go from a still hand settles at half speed, 3 dB under the approved "Move it" (ruling R76). */
const STILL_SETTLE_SPEED = 0.5;
/** "Move it" itself, reached at a 1.5 m/s hand: the speed that earns the motion's full release dip. */
const FULL_SETTLE_SPEED = 1;

/**
 * Where each of the body's feet stands, in render space: turned with the piece
 * about +y as three.js turns it (x' = x cos t + z sin t, z' = -x sin t + z cos t),
 * then moved to the piece.
 */
export function footPositions(item: PlacedItem, body: SetDownBody): readonly { readonly x: number; readonly z: number }[] {
  const cos = Math.cos(item.rotationY);
  const sin = Math.sin(item.rotationY);
  return body.feet.map((foot) => ({
    x: item.x + toRenderSpace(foot.x * cos + foot.z * sin),
    z: item.z + toRenderSpace(-foot.x * sin + foot.z * cos),
  }));
}

/** A let-go's or a resting hand's settle speed: 0.5 + handSpeed / 3, held to 0.5-1 (ruling R76). */
export function settleSpeedFor(handSpeed: number): number {
  const hand = Number.isFinite(handSpeed) ? handSpeed : 0;
  return Math.min(FULL_SETTLE_SPEED, Math.max(STILL_SETTLE_SPEED, STILL_SETTLE_SPEED + hand / 3));
}

/**
 * How a landing renders (ruling R76). A drop-in is the approved "Set it down":
 * a drop at speed 1, since every drop-in meets its support at the same speed.
 * A let-go or a resting hand's set-down is the approved "Move it", a settle,
 * at a speed that follows the hand.
 */
export function landingRender(landing: FurnitureLanding, handSpeed: number): { readonly kind: "drop" | "settle"; readonly speed: number } {
  if (landing === "drop-in") return { kind: "drop", speed: 1 };
  return { kind: "settle", speed: settleSpeedFor(handSpeed) };
}

/**
 * What makes two surfaces the same surface: their kind and the floor heard
 * beneath them (ruling R37; render.ts groups a piece's feet by the same rule).
 */
function surfaceKey(surface: SurfaceResponse): string {
  const beneath = surface.beneath;
  return beneath === null ? surface.kind : [surface.kind, beneath.lowHz, beneath.highHz, beneath.count, beneath.eta, beneath.gainDb].join("|");
}

export interface VoiceInputArgs {
  readonly item: PlacedItem;
  /** Every piece in the room, the landing piece among them or not. */
  readonly placedItems: readonly PlacedItem[];
  /** The space's slug: a surveyed room's floor, or timber on a slab for any other. */
  readonly roomSlug: string | null;
  /** The drawn room, or null when there is none: then there are no early reflections. */
  readonly geometry: RoomGeometry | null;
  readonly acoustics: RoomAcoustics;
  /** Where it is heard from (earFor); kept inside the drawn room here. */
  readonly ear: Ear;
  readonly landing: FurnitureLanding;
  readonly handSpeed: number;
  readonly seed: number;
  readonly sampleRate: number;
}

/**
 * The render input for `item` landing where it stands now.
 * - The body is the piece's own at its scale, or its family's (bodyFor).
 * - Each foot stands on the highest support under it that the piece may rest
 *   on (findSupportingItem, the piece itself excluded), or on the room's
 *   floor; a piece the catalogue does not know stands on the floor, as
 *   placement treats it.
 * - The source is the piece's position, in metres.
 * - The direct sound is rendered at gain 1 (ruling R57): its 1/r fall,
 *   `directGain`, is for the voice's dry gain alone, so the room's send is
 *   never turned down with distance. The direct sound and the reflections are
 *   heard at the same ear, inside the room.
 * - `surfacesKey` names the feet's surfaces, in the feet's order, for caching
 *   renders.
 */
export function voiceInput(args: VoiceInputArgs): {
  readonly input: SetDownInput;
  readonly directGain: number;
  readonly surfacesKey: string;
  readonly slug: string;
} {
  const { item, placedItems, roomSlug, geometry } = args;
  const entry = getCatalogueItem(item.catalogueItemId);
  const slug = entry?.slug ?? item.catalogueItemId;
  const body = bodyFor(slug, item.scale);
  const itself: ReadonlySet<string> = new Set([item.id]);
  const surfaces = footPositions(item, body).map((foot) => {
    const support = entry === undefined ? null : findSupportingItem(foot.x, foot.z, entry, placedItems, itself);
    const supportSlug = support === null ? null : (getCatalogueItem(support.catalogueItemId)?.slug ?? support.catalogueItemId);
    return surfaceResponse(surfaceKindForSupport(supportSlug, roomSlug), roomSlug);
  });
  const source: Vec3 = { x: toRealWorld(item.x), y: item.y, z: toRealWorld(item.z) };
  const ear = clampEarToRoom(args.ear, geometry);
  const direct = directPath(ear, source);
  const reflections = geometry === null ? [] : earlyReflections(reflectionRoomFor(args.acoustics, geometry), source, ear);
  const { kind, speed } = landingRender(args.landing, args.handSpeed);
  return {
    input: {
      body,
      surfaces,
      speed,
      kind,
      clothed: item.clothed,
      direct: { gain: 1, azimuthRad: direct.azimuthRad },
      reflections,
      seed: args.seed,
      sampleRate: args.sampleRate,
    },
    directGain: direct.gain,
    surfacesKey: surfaces.map(surfaceKey).join(","),
    slug,
  };
}
