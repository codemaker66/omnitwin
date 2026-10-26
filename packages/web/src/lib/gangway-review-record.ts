import { GangwayReviewSchema, withGangwayDecisions, type GangwayReview, type GangwayReviewItem, type SpaceDimensions } from "@omnitwin/types";
import { getConfig, patchConfigMetadata, type ConfigMetadataInput } from "../api/configurations.js";
import { gangwayReview, roomExits, roomWallNames } from "./auto-fill.js";
import type { PlacedItem } from "./placement.js";
import { useEditorStore } from "../stores/editor-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useRoomDimensionsStore } from "../stores/room-dimensions-store.js";

// ---------------------------------------------------------------------------
// The layout's gangway review, kept with the layout (Blake's B5; QoL E-03)
//
// The planner derives every pinch under the guidance (lib/auto-fill
// gangwayReview) and the venue's staff decide on them. So that the venue's
// side and the sheet see the items, and the decisions hold, the review is
// stored with the layout in configurations.metadata.gangwayReview: the items
// as derived now, each stored decision laid back over its item by id while it
// still holds (withGangwayDecisions, @omnitwin/types gangway-review).
//
// A signed-in layout writes it a moment after its pinches change, once the
// layout itself is saved (so the items name saved pieces), and before it is
// submitted for review: the submit snapshots the configuration with its
// metadata, so the review goes to the venue with it. The stored review is
// read again just before each write, so the venue's latest decisions are kept.
// A guest's preview stores nothing; its review is derived wherever it opens.
// ---------------------------------------------------------------------------

/** How long the pinches must stay still before the review is written, ms: a drag writes once, after it ends. */
export const GANGWAY_RECORD_DELAY_MS = 3000;

/** The room's pinches as derived now, open, its walls named as its staff name them. */
function derivedItems(placedItems: readonly PlacedItem[], room: SpaceDimensions, roomSlug: string | null): readonly GangwayReviewItem[] {
  const wallNames = roomWallNames(roomSlug);
  return gangwayReview(placedItems, room, roomExits(roomSlug), wallNames === undefined ? {} : { wallNames });
}

/** The review a layout holds: the items as derived now, each stored decision laid back over its item while it holds. */
export function layoutGangwayReview(
  placedItems: readonly PlacedItem[],
  room: SpaceDimensions,
  roomSlug: string | null,
  stored: GangwayReview | null,
): GangwayReview {
  return { items: [...withGangwayDecisions(derivedItems(placedItems, room, roomSlug), stored?.items ?? [])] };
}

/** The review stored with a layout's metadata, or null when there is none or it does not read as one. */
export function storedGangwayReview(metadata: unknown): GangwayReview | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const parsed = GangwayReviewSchema.safeParse((metadata as Record<string, unknown>)["gangwayReview"]);
  return parsed.success ? parsed.data : null;
}

export interface GangwayRecordDeps {
  /** The layout's metadata as stored now. */
  readonly read: (configId: string) => Promise<unknown>;
  readonly write: (configId: string, metadata: ConfigMetadataInput) => Promise<unknown>;
  /** Saves the layout's pieces first, so the items name saved ids; false when the save failed. */
  readonly flush: () => Promise<boolean>;
}

const DEFAULT_DEPS: GangwayRecordDeps = {
  read: async (configId) => (await getConfig(configId)).metadata,
  write: (configId, metadata) => patchConfigMetadata(configId, metadata),
  flush: () => Promise.resolve(true),
};

/** The derived pinches this tab last recorded, per layout: unchanged pinches are not read or written again. */
let recorded: { readonly configId: string; readonly derived: string } | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;
let running: Promise<boolean> = Promise.resolve(true);

/**
 * Writes the open layout's gangway review with its metadata, read fresh so
 * the venue's decisions are kept, when it differs from the review stored. A
 * guest's preview, or no layout, records nothing (true: nothing is owed). A
 * layout with no pinch and none stored writes nothing either. Rejects when
 * the save or the write fails. Runs one at a time.
 */
export function recordGangwayReview(deps: Partial<GangwayRecordDeps> = {}): Promise<boolean> {
  const use = { ...DEFAULT_DEPS, ...deps };
  running = running.catch(() => false).then(() => recordNow(use));
  return running;
}

async function recordNow(deps: GangwayRecordDeps): Promise<boolean> {
  const { configId, isPublicPreview } = useEditorStore.getState();
  if (configId === null || isPublicPreview) return true;
  if (!(await deps.flush())) throw new Error("The layout did not save, so its gangway review was not recorded.");
  const { space } = useEditorStore.getState();
  if (useEditorStore.getState().configId !== configId) return true;
  const items = derivedItems(usePlacementStore.getState().placedItems, useRoomDimensionsStore.getState().dimensions, space?.slug ?? null);
  const stored = storedGangwayReview(await deps.read(configId));
  const review: GangwayReview = { items: [...withGangwayDecisions(items, stored?.items ?? [])] };
  const derived = JSON.stringify(items);
  if (stored === null ? review.items.length === 0 : JSON.stringify(stored) === JSON.stringify(review)) {
    recorded = { configId, derived };
    return true;
  }
  await deps.write(configId, { gangwayReview: review });
  recorded = { configId, derived };
  return true;
}

/**
 * Asks for the open layout's review to be recorded once its pinches have
 * stayed still for GANGWAY_RECORD_DELAY_MS. Pinches unchanged since the last
 * record cost nothing. A failed record is tried again at the next change, and
 * the submit records again before it goes (and stops if that fails).
 */
export function scheduleGangwayReviewRecord(deps: Partial<GangwayRecordDeps>): void {
  if (pending !== null) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    const { configId, isPublicPreview, space } = useEditorStore.getState();
    if (configId === null || isPublicPreview) return;
    const derived = JSON.stringify(derivedItems(usePlacementStore.getState().placedItems, useRoomDimensionsStore.getState().dimensions, space?.slug ?? null));
    if (recorded !== null && recorded.configId === configId && recorded.derived === derived) return;
    recordGangwayReview(deps).catch(() => { recorded = null; });
  }, GANGWAY_RECORD_DELAY_MS);
}

/** Forgets what was recorded and any record waiting. */
export function resetGangwayReviewRecordForTesting(): void {
  if (pending !== null) clearTimeout(pending);
  pending = null;
  recorded = null;
  running = Promise.resolve(true);
}
