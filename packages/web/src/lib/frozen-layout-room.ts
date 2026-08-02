import type {
  LayoutSnapshotVenueRuntimeReference,
  SpaceDimensions,
} from "@omnitwin/types";
import { scaleForRendering, toRenderSpace } from "../constants/scale.js";
import type { RoomGeometry } from "../data/room-geometries.js";

export interface FrozenLayoutRoomModel {
  /** Generic, payload-derived room shell centred for the planner renderer. */
  readonly geometry: RoomGeometry;
  /** Frozen snapshot bounds in the render coordinate system. */
  readonly renderDimensions: SpaceDimensions;
  /** Applies the same lower-left-origin -> centred transform to furniture. */
  readonly furnitureOffset: readonly [number, number, number];
  /** Stable diagnostic used by the renderer warm-up and browser regressions. */
  readonly envelopeKey: string;
}

interface OutlineBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function outlineBounds(
  runtime: LayoutSnapshotVenueRuntimeReference,
): OutlineBounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of runtime.floorPlanOutline) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.y);
    maxZ = Math.max(maxZ, point.y);
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Identity of the frozen room coordinate envelope. Spatial morphing is safe
 * only when both endpoints use this exact same envelope; otherwise object
 * coordinates would interpolate while their room origin changes underneath.
 */
export function frozenRoomEnvelopeKey(
  runtime: LayoutSnapshotVenueRuntimeReference,
): string {
  const dimensions = runtime.spaceDimensions;
  const outline = runtime.floorPlanOutline
    .map((point) => `${String(point.x)},${String(point.y)}`)
    .join(";");
  return [
    runtime.venueId,
    runtime.spaceId,
    String(dimensions.width),
    String(dimensions.length),
    String(dimensions.height),
    outline,
  ].join("|");
}

export function frozenRoomEnvelopesMatch(
  left: LayoutSnapshotVenueRuntimeReference,
  right: LayoutSnapshotVenueRuntimeReference,
): boolean {
  return frozenRoomEnvelopeKey(left) === frozenRoomEnvelopeKey(right);
}

/**
 * Adapts immutable snapshot geometry without consulting the current space or
 * latest-by-slug runtime registry. Canonical outlines and object positions
 * share a lower-left origin, while the planner camera assumes a room centred
 * at (0, 0); the returned offset applies that same centring to furniture.
 *
 * Historical splat/package fidelity would require immutable by-ID asset
 * resolution. Until that exists, preview renders the exact frozen outline as
 * a generic shell and deliberately suppresses the current/latest splat.
 */
export function frozenLayoutRoomModel(
  runtime: LayoutSnapshotVenueRuntimeReference,
): FrozenLayoutRoomModel {
  const bounds = outlineBounds(runtime);
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreZ = (bounds.minZ + bounds.maxZ) / 2;
  const wallPolygon = runtime.floorPlanOutline.map(
    (point) => [point.x - centreX, point.y - centreZ] as const,
  );

  return {
    geometry: {
      wallPolygon,
      ceilingHeight: runtime.spaceDimensions.height,
      features: [],
      hasDome: false,
      domeRadius: 0,
    },
    renderDimensions: scaleForRendering(runtime.spaceDimensions),
    furnitureOffset: [
      -toRenderSpace(centreX),
      0,
      -toRenderSpace(centreZ),
    ],
    envelopeKey: frozenRoomEnvelopeKey(runtime),
  };
}

/**
 * Keeps Three geometry and camera-bound identities stable across endpoint
 * changes that reference the same frozen coordinate envelope.
 */
export function retainFrozenLayoutRoomModel(
  previous: FrozenLayoutRoomModel | null,
  runtime: LayoutSnapshotVenueRuntimeReference | null,
): FrozenLayoutRoomModel | null {
  if (runtime === null) return null;
  const envelopeKey = frozenRoomEnvelopeKey(runtime);
  if (previous?.envelopeKey === envelopeKey) return previous;
  return frozenLayoutRoomModel(runtime);
}
