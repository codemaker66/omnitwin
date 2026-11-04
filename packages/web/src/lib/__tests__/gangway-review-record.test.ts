// The layout's gangway review kept with the layout (lib/gangway-review-record; QoL E-03): the
// items as derived, the venue's stored decisions kept by id while they hold, written only when
// the review changes, never for a guest's preview, and before a submit.
import type { GangwayReview } from "@omnitwin/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Space } from "../../api/spaces.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import {
  GANGWAY_RECORD_DELAY_MS,
  layoutGangwayReview,
  recordGangwayReview,
  resetGangwayReviewRecordForTesting,
  scheduleGangwayReviewRecord,
  storedGangwayReview,
} from "../gangway-review-record.js";
import type { PlacedItem } from "../placement.js";
import { cardParamsFor, stampSetup } from "../setup-cards.js";

const HALL = GRAND_HALL_RENDER_DIMENSIONS;
/** The outermost chair's reach from a 6 ft round's centre: its ring radius and half a chair's depth. */
const CHAIR_REACH = 0.915 + 0.05 + 0.58;
const GRAND_HALL_SPACE: Space = {
  id: "space-grand-hall", venueId: "venue-1", name: "Grand Hall", slug: "grand-hall",
  widthM: "21", lengthM: "10.5", heightM: "7",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
};

let counter = 0;
function ids(): string {
  counter += 1;
  return `rec-${String(counter)}`;
}

/**
 * A round whose outermost chair stands `gap` metres from the fireplace wall: a pinch when the gap is under
 * 1.1 m. The fireplace end is one of the Grand Hall's designated gangways with its doors kept clear (with the
 * door wall and a middle spine; the window wall is not), and the round stands off the spine.
 */
function offFireplaceWall(gap: number): readonly PlacedItem[] {
  const params = cardParamsFor("round");
  if (params === null) throw new Error("no round");
  return stampSetup(params, { x: -HALL.width / 2 + gap + CHAIR_REACH, z: -2.6 }, 0, ids).map((piece) => ({ ...piece, groupId: "group-fireplace" }));
}

/** A round whose outermost chair stands `gap` metres from the window wall, where Fill lays no gangway once the doors are kept clear. */
function offWindowWall(gap: number): readonly PlacedItem[] {
  const params = cardParamsFor("round");
  if (params === null) throw new Error("no round");
  return stampSetup(params, { x: 0, z: -HALL.length / 2 + gap + CHAIR_REACH }, 0, ids).map((piece) => ({ ...piece, groupId: "group-window" }));
}

/** A fake API: the layout's stored metadata, and every write it took. */
function fakeApi(initial: Record<string, unknown> | null = null): {
  readonly read: (configId: string) => Promise<unknown>;
  readonly write: (configId: string, metadata: { readonly gangwayReview?: GangwayReview | null }) => Promise<unknown>;
  readonly writes: { readonly configId: string; readonly review: GangwayReview | null | undefined }[];
  readonly reads: () => number;
} {
  let metadata: Record<string, unknown> | null = initial;
  let reads = 0;
  const writes: { readonly configId: string; readonly review: GangwayReview | null | undefined }[] = [];
  return {
    read: () => { reads += 1; return Promise.resolve(metadata); },
    write: (configId, next) => {
      writes.push({ configId, review: next.gangwayReview });
      metadata = { ...(metadata ?? {}), gangwayReview: next.gangwayReview };
      return Promise.resolve({ id: configId });
    },
    writes,
    reads: () => reads,
  };
}

beforeEach(() => {
  counter = 0;
  resetGangwayReviewRecordForTesting();
  useRoomDimensionsStore.setState({ dimensions: HALL });
  useEditorStore.setState({ configId: "cfg-1", isPublicPreview: false, space: GRAND_HALL_SPACE });
  usePlacementStore.setState({ placedItems: [...offFireplaceWall(0.8)] });
});

afterEach(() => {
  vi.useRealTimers();
  resetGangwayReviewRecordForTesting();
});

describe("the review a layout holds", () => {
  it("names the pinch as the hall's staff do, open", () => {
    const review = layoutGangwayReview(usePlacementStore.getState().placedItems, HALL, "grand-hall", null);
    expect(review.items).toHaveLength(1);
    expect(review.items[0]).toMatchObject({ gangway: "the fireplace wall", status: "open" });
    expect(review.items[0]?.sides).toContain("the fireplace wall");
  });

  it("keeps the venue's decision on the same pinch, and reopens it once the pinch narrows past the tolerance", () => {
    const [open] = layoutGangwayReview(usePlacementStore.getState().placedItems, HALL, "grand-hall", null).items;
    if (open === undefined) throw new Error("no pinch");
    const decided: GangwayReview = { items: [{ ...open, status: "approved", reviewer: "Hallkeeper", decidedAt: "2026-10-26T09:00:00.000Z" }] };
    expect(layoutGangwayReview(usePlacementStore.getState().placedItems, HALL, "grand-hall", decided).items[0]?.status).toBe("approved");
    const narrower = offFireplaceWall(0.7).map((piece, i) => ({ ...piece, id: usePlacementStore.getState().placedItems[i]?.id ?? piece.id }));
    expect(layoutGangwayReview(narrower, HALL, "grand-hall", decided).items[0]?.status).toBe("open");
  });

  it("reads a stored review back, and nothing that is not one", () => {
    const review = layoutGangwayReview(usePlacementStore.getState().placedItems, HALL, "grand-hall", null);
    expect(storedGangwayReview({ instructions: {}, gangwayReview: review })).toEqual(review);
    expect(storedGangwayReview({ gangwayReview: { items: [{ id: "" }] } })).toBeNull();
    expect(storedGangwayReview(null)).toBeNull();
  });
});

describe("recording it with the layout", () => {
  it("writes the review once, then nothing while it stays the same", async () => {
    const api = fakeApi({ instructions: { specialInstructions: "Ceilidh" } });
    await recordGangwayReview(api);
    expect(api.writes).toHaveLength(1);
    expect(api.writes[0]?.review?.items).toHaveLength(1);
    await recordGangwayReview(api);
    expect(api.writes).toHaveLength(1);
  });

  it("keeps the venue's decision when it records again", async () => {
    const [open] = layoutGangwayReview(usePlacementStore.getState().placedItems, HALL, "grand-hall", null).items;
    if (open === undefined) throw new Error("no pinch");
    const api = fakeApi({ gangwayReview: { items: [{ ...open, status: "denied", reviewer: "Duty manager", decidedAt: "2026-10-26T09:00:00.000Z" }] } });
    // A second pinch elsewhere joins the review; the venue's decision on the first stays.
    usePlacementStore.setState({ placedItems: [...usePlacementStore.getState().placedItems, ...offFireplaceWall(0.8).map((piece) => ({ ...piece, z: piece.z + 4.8, groupId: "group-two" }))] });
    await recordGangwayReview(api);
    const written = api.writes[0]?.review?.items ?? [];
    expect(written.find((item) => item.id === open.id)?.status).toBe("denied");
    expect(written.filter((item) => item.status === "open")).toHaveLength(1);
  });

  it("writes nothing for a guest's preview, or a layout with no pinch and none stored", async () => {
    const api = fakeApi();
    useEditorStore.setState({ isPublicPreview: true });
    await recordGangwayReview(api);
    expect(api.reads()).toBe(0);
    useEditorStore.setState({ isPublicPreview: false });
    usePlacementStore.setState({ placedItems: [] });
    await recordGangwayReview(api);
    expect(api.writes).toHaveLength(0);
  });

  it("clears a stored review whose pinches have all gone", async () => {
    const api = fakeApi();
    await recordGangwayReview(api);
    usePlacementStore.setState({ placedItems: [] });
    await recordGangwayReview(api);
    expect(api.writes.map((write) => write.review?.items.length)).toEqual([1, 0]);
  });

  it("refuses when the layout did not save, and writes nothing", async () => {
    const api = fakeApi();
    await expect(recordGangwayReview({ ...api, flush: () => Promise.resolve(false) })).rejects.toThrow(/did not save/u);
    expect(api.writes).toHaveLength(0);
  });

  it("records a moment after the pinches stop changing, once however many changes came", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const flush = vi.fn(() => Promise.resolve(true));
    for (let i = 0; i < 3; i += 1) scheduleGangwayReviewRecord({ ...api, flush });
    await vi.advanceTimersByTimeAsync(GANGWAY_RECORD_DELAY_MS - 1);
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(api.writes).toHaveLength(1);
    // Pinches unchanged since that record cost nothing: no save, no read.
    scheduleGangwayReviewRecord({ ...api, flush });
    await vi.advanceTimersByTimeAsync(GANGWAY_RECORD_DELAY_MS);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(api.reads()).toBe(1);
  });
});

describe("the review judges the gangways Fill lays, its doors kept clear", () => {
  it("finds no pinch where Fill lays no gangway once the Grand Hall's doors are kept clear", () => {
    // With the doors kept clear Fill's gangways run along the fireplace and door walls and down the middle
    // (auto-fill-doors), not along the windows: a round 0.8 m off the window wall pinches no gangway it lays.
    expect(layoutGangwayReview(offWindowWall(0.8), HALL, "grand-hall", null).items).toEqual([]);
    // The fireplace end is one of its gangways, so the same round there is a pinch.
    expect(layoutGangwayReview(offFireplaceWall(0.8), HALL, "grand-hall", null).items).toHaveLength(1);
  });
});
