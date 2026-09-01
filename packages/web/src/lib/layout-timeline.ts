import {
  CanonicalLayoutSnapshotV0Schema,
} from "@omnitwin/types";
import { toRenderSpace } from "../constants/scale.js";
import type { PlacedItem, TableClothStyle, TableSettingStyle } from "./placement.js";

const placedItemsByCanonicalPayload = new WeakMap<object, readonly PlacedItem[] | null>();

export interface TimelineSegment {
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly progress: number;
}

function snapshotClothStyle(value: unknown, clothed: boolean): TableClothStyle | null {
  if (!clothed) return null;
  return value === "white" ? "white" : "black";
}

function snapshotTableSetting(value: unknown): TableSettingStyle | null {
  return value === "dinner" ? "dinner" : null;
}

/**
 * Converts an independently validated canonical keyframe payload into the
 * planner's render-space furniture type. Keeping this overload payload-first
 * lets the room timeline endpoint remain a strict immutable read model rather
 * than masquerading as the legacy phase-snapshot response.
 */
export function placedItemsFromCanonicalSnapshot(
  payload: unknown,
): readonly PlacedItem[] | null {
  const cacheKey = typeof payload === "object" && payload !== null ? payload : null;
  if (cacheKey !== null && placedItemsByCanonicalPayload.has(cacheKey)) {
    return placedItemsByCanonicalPayload.get(cacheKey) ?? null;
  }
  const parsed = CanonicalLayoutSnapshotV0Schema.safeParse(payload);
  if (!parsed.success) {
    if (cacheKey !== null) placedItemsByCanonicalPayload.set(cacheKey, null);
    return null;
  }
  const items = [...parsed.data.objects]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((object): PlacedItem => {
      const metadata = object.metadata;
      const clothed = metadata?.["clothed"] === true;
      const displayLabel = metadata?.["displayLabel"];
      return {
        id: object.objectId,
        catalogueItemId: object.assetDefinition.assetDefinitionId,
        label: typeof displayLabel === "string" ? displayLabel : "",
        x: toRenderSpace(object.position.x),
        y: object.position.y,
        z: toRenderSpace(object.position.z),
        rotationY: object.rotation.y,
        scale: object.scale,
        embeddedAssetDefinition: object.assetDefinition,
        clothed,
        clothStyle: snapshotClothStyle(metadata?.["clothStyle"], clothed),
        tableSetting: snapshotTableSetting(metadata?.["tableSetting"]),
        groupId: object.groupId,
      };
    });
  if (cacheKey !== null) placedItemsByCanonicalPayload.set(cacheKey, items);
  return items;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function timelineSegment(cursor: number, frameCount: number): TimelineSegment {
  if (frameCount <= 1) return { fromIndex: 0, toIndex: 0, progress: 0 };
  const maximum = frameCount - 1;
  const clamped = clamp(Number.isFinite(cursor) ? cursor : 0, 0, maximum);
  const fromIndex = Math.floor(clamped);
  const toIndex = Math.min(maximum, Math.ceil(clamped));
  return {
    fromIndex,
    toIndex,
    progress: toIndex === fromIndex ? 0 : clamped - fromIndex,
  };
}

function distanceSquared(left: PlacedItem, right: PlacedItem): number {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const dz = right.z - left.z;
  return dx * dx + dy * dy + dz * dz;
}

function lerp(left: number, right: number, progress: number): number {
  return left + (right - left) * progress;
}

function lerpAngle(left: number, right: number, progress: number): number {
  const fullTurn = Math.PI * 2;
  let delta = (right - left) % fullTurn;
  if (delta > Math.PI) delta -= fullTurn;
  if (delta < -Math.PI) delta += fullTurn;
  return left + delta * progress;
}

export interface TimelineItemTransitionPair {
  readonly from: PlacedItem;
  readonly to: PlacedItem;
}

/** Immutable correspondence built once when a same-event transition begins. */
export interface TimelineItemTransitionPlan {
  readonly fromItems: readonly PlacedItem[];
  readonly toItems: readonly PlacedItem[];
  readonly pairs: readonly TimelineItemTransitionPair[];
  readonly unmatchedFrom: readonly PlacedItem[];
  readonly unmatchedTo: readonly PlacedItem[];
  /** Diagnostic proving the nearest-SKU search cost is paid at plan time only. */
  readonly pairSearchComparisons: number;
}

/** Above this count the renderer samples the immutable plan directly into instance buffers. */
export const TIMELINE_IMPERATIVE_MORPH_THRESHOLD = 240;

export function timelineTransitionUsesImperativeMorph(
  plan: Pick<TimelineItemTransitionPlan, "fromItems" | "toItems">,
): boolean {
  return Math.max(plan.fromItems.length, plan.toItems.length)
    > TIMELINE_IMPERATIVE_MORPH_THRESHOLD;
}

export function buildTimelineItemTransitionPlan(
  fromItems: readonly PlacedItem[],
  toItems: readonly PlacedItem[],
): TimelineItemTransitionPlan {
  const usedToIds = new Set<string>();
  const pairedFromIds = new Set<string>();
  const toById = new Map(toItems.map((item) => [item.id, item] as const));
  const pairs: TimelineItemTransitionPair[] = [];
  let pairSearchComparisons = 0;

  for (const from of fromItems) {
    const stable = toById.get(from.id);
    if (stable === undefined) continue;
    pairs.push({ from, to: stable });
    pairedFromIds.add(from.id);
    usedToIds.add(stable.id);
  }

  for (const from of fromItems) {
    if (pairedFromIds.has(from.id)) continue;
    let nearest: PlacedItem | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of toItems) {
      if (usedToIds.has(candidate.id) || candidate.catalogueItemId !== from.catalogueItemId) continue;
      pairSearchComparisons += 1;
      const candidateDistance = distanceSquared(from, candidate);
      if (
        candidateDistance < nearestDistance
        || (candidateDistance === nearestDistance && candidate.id.localeCompare(nearest?.id ?? "") < 0)
      ) {
        nearest = candidate;
        nearestDistance = candidateDistance;
      }
    }
    if (nearest === null) continue;
    pairs.push({ from, to: nearest });
    pairedFromIds.add(from.id);
    usedToIds.add(nearest.id);
  }

  return {
    fromItems,
    toItems,
    pairs,
    unmatchedFrom: fromItems.filter((item) => !pairedFromIds.has(item.id)),
    unmatchedTo: toItems.filter((item) => !usedToIds.has(item.id)),
    pairSearchComparisons,
  };
}

function interpolatePair(pair: TimelineItemTransitionPair, progress: number): PlacedItem {
  const metadataSource = progress < 0.5 ? pair.from : pair.to;
  return {
    ...metadataSource,
    id: pair.from.id,
    catalogueItemId: metadataSource.catalogueItemId,
    x: lerp(pair.from.x, pair.to.x, progress),
    y: lerp(pair.from.y, pair.to.y, progress),
    z: lerp(pair.from.z, pair.to.z, progress),
    rotationY: lerpAngle(pair.from.rotationY, pair.to.rotationY, progress),
    scale: lerp(pair.from.scale ?? 1, pair.to.scale ?? 1, progress),
  };
}

/** Deterministic per-sample work count for regression/performance assertions. */
export function timelineTransitionInterpolationOperationCount(
  plan: TimelineItemTransitionPlan,
  progress: number,
): number {
  const clamped = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  if (clamped === 0 || clamped === 1) return 0;
  return plan.pairs.length
    + (clamped < 0.5 ? plan.unmatchedFrom.length : plan.unmatchedTo.length);
}

/** O(n) sampling of a precomputed transition plan. */
export function interpolateTimelineItemTransitionPlan(
  plan: TimelineItemTransitionPlan,
  progress: number,
): readonly PlacedItem[] {
  const clamped = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  if (clamped === 0) return plan.fromItems;
  if (clamped === 1) return plan.toItems;
  const interpolated = plan.pairs.map((pair) => interpolatePair(pair, clamped));
  return clamped < 0.5
    ? [...interpolated, ...plan.unmatchedFrom]
    : [...interpolated, ...plan.unmatchedTo];
}

/**
 * Presentational-only layout morph. Stable object IDs pair first, then a
 * deterministic nearest-neighbour pass runs within each SKU. Objects without
 * a correspondence strike/materialize at the midpoint; no intermediate
 * object is written to an editor or API store.
 */
export function interpolateTimelineItems(
  fromItems: readonly PlacedItem[],
  toItems: readonly PlacedItem[],
  progress: number,
): readonly PlacedItem[] {
  return interpolateTimelineItemTransitionPlan(
    buildTimelineItemTransitionPlan(fromItems, toItems),
    progress,
  );
}

/**
 * Applies the event-boundary transition policy used by the scene preview.
 * Objects may spatially correspond only within one event. Crossing into a
 * different event (or opting into reduced motion) swaps the complete saved
 * keyframe at the midpoint so unrelated plans never appear to glide into one
 * another.
 */
export function interpolateTimelineFrameItems({
  fromEventId,
  toEventId,
  fromItems,
  toItems,
  progress,
  reducedMotion = false,
}: {
  readonly fromEventId: string;
  readonly toEventId: string;
  readonly fromItems: readonly PlacedItem[];
  readonly toItems: readonly PlacedItem[];
  readonly progress: number;
  readonly reducedMotion?: boolean;
}): readonly PlacedItem[] {
  const clamped = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  if (reducedMotion || fromEventId !== toEventId) {
    return clamped < 0.5 ? fromItems : toItems;
  }
  return interpolateTimelineItems(fromItems, toItems, clamped);
}
