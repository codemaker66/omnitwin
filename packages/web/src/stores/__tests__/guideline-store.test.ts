import { describe, it, expect, beforeEach } from "vitest";
import { useGuidelineStore } from "../guideline-store.js";
import { useRoomDimensionsStore } from "../room-dimensions-store.js";
import type { WallHit } from "../../lib/guideline.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { RENDER_SCALE } from "../../constants/scale.js";

const { width } = GRAND_HALL_RENDER_DIMENSIONS;

function resetStore(): void {
  useGuidelineStore.setState({
    active: false,
    guidelines: [],
    nextId: 1,
  });
}

describe("guideline-store", () => {
  beforeEach(resetStore);

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  describe("initial state", () => {
    it("starts inactive", () => {
      expect(useGuidelineStore.getState().active).toBe(false);
    });

    it("starts with no guidelines", () => {
      expect(useGuidelineStore.getState().guidelines).toEqual([]);
    });

    it("starts with nextId = 1", () => {
      expect(useGuidelineStore.getState().nextId).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // activate / deactivate / toggle
  // -----------------------------------------------------------------------

  describe("activate / deactivate / toggle", () => {
    it("activate sets active to true", () => {
      useGuidelineStore.getState().activate();
      expect(useGuidelineStore.getState().active).toBe(true);
    });

    it("deactivate sets active to false", () => {
      useGuidelineStore.getState().activate();
      useGuidelineStore.getState().deactivate();
      expect(useGuidelineStore.getState().active).toBe(false);
    });

    it("toggle flips active state", () => {
      useGuidelineStore.getState().toggle();
      expect(useGuidelineStore.getState().active).toBe(true);
      useGuidelineStore.getState().toggle();
      expect(useGuidelineStore.getState().active).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // placeGuideline
  // -----------------------------------------------------------------------

  describe("placeGuideline", () => {
    const wallHit: WallHit = { axis: "x", position: 0, wallCoord: 5 };

    it("does nothing when inactive", () => {
      useGuidelineStore.getState().placeGuideline(wallHit);
      expect(useGuidelineStore.getState().guidelines).toHaveLength(0);
    });

    it("places a guideline when active", () => {
      useGuidelineStore.getState().activate();
      useGuidelineStore.getState().placeGuideline(wallHit);

      const guidelines = useGuidelineStore.getState().guidelines;
      expect(guidelines).toHaveLength(1);
      expect(guidelines[0]?.id).toBe(1);
      expect(guidelines[0]?.axis).toBe("x");
      expect(guidelines[0]?.fixedCoord).toBe(5);
      expect(guidelines[0]?.realDistance).toBeCloseTo(width / RENDER_SCALE);
    });

    it("spans the room the planner has loaded, wall to wall", () => {
      // The Grand Hall's scanned interior, as usePlannerRoomDimensions sets it
      // (now also the default room), and the Saloon, which is not the default:
      // a guideline that read the default would fail the second.
      const rooms = [
        { dims: { width: 21.135, length: 10.59, height: 6.7 }, halfX: 10.5675, halfZ: 5.295 },
        { dims: { width: 12, length: 7, height: 5.4 }, halfX: 6, halfZ: 3.5 },
      ];
      try {
        for (const { dims, halfX, halfZ } of rooms) {
          resetStore();
          useRoomDimensionsStore.getState().setDimensions(dims);
          useGuidelineStore.getState().activate();
          // Points inside both rooms.
          useGuidelineStore.getState().placeGuideline({ axis: "x", position: 0, wallCoord: 2 });
          useGuidelineStore.getState().placeGuideline({ axis: "z", position: 0, wallCoord: -3 });
          const [across, along] = useGuidelineStore.getState().guidelines;
          expect(across?.start[0]).toBeCloseTo(-halfX, 9);
          expect(across?.end[0]).toBeCloseTo(halfX, 9);
          expect(across?.realDistance).toBeCloseTo(dims.width, 9);
          expect(along?.start[2]).toBeCloseTo(-halfZ, 9);
          expect(along?.end[2]).toBeCloseTo(halfZ, 9);
          expect(along?.realDistance).toBeCloseTo(dims.length, 9);
        }
      } finally {
        useRoomDimensionsStore.getState().setDimensions(GRAND_HALL_RENDER_DIMENSIONS);
      }
    });

    it("increments nextId after each placement", () => {
      useGuidelineStore.getState().activate();
      useGuidelineStore.getState().placeGuideline(wallHit);
      useGuidelineStore.getState().placeGuideline({ axis: "z", position: 0, wallCoord: -3 });

      expect(useGuidelineStore.getState().guidelines).toHaveLength(2);
      expect(useGuidelineStore.getState().guidelines[0]?.id).toBe(1);
      expect(useGuidelineStore.getState().guidelines[1]?.id).toBe(2);
      expect(useGuidelineStore.getState().nextId).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // removeGuideline
  // -----------------------------------------------------------------------

  describe("removeGuideline", () => {
    it("removes a guideline by ID", () => {
      useGuidelineStore.getState().activate();
      useGuidelineStore.getState().placeGuideline({ axis: "x", position: 0, wallCoord: 1 });
      useGuidelineStore.getState().placeGuideline({ axis: "z", position: 0, wallCoord: 2 });

      useGuidelineStore.getState().removeGuideline(1);
      const remaining = useGuidelineStore.getState().guidelines;
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe(2);
    });

    it("does nothing if ID does not exist", () => {
      useGuidelineStore.getState().activate();
      useGuidelineStore.getState().placeGuideline({ axis: "x", position: 0, wallCoord: 1 });

      useGuidelineStore.getState().removeGuideline(999);
      expect(useGuidelineStore.getState().guidelines).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // clearAll
  // -----------------------------------------------------------------------

  describe("clearAll", () => {
    it("removes all guidelines", () => {
      useGuidelineStore.getState().activate();
      useGuidelineStore.getState().placeGuideline({ axis: "x", position: 0, wallCoord: 1 });
      useGuidelineStore.getState().placeGuideline({ axis: "z", position: 0, wallCoord: 2 });
      useGuidelineStore.getState().placeGuideline({ axis: "x", position: 0, wallCoord: 3 });

      useGuidelineStore.getState().clearAll();
      expect(useGuidelineStore.getState().guidelines).toEqual([]);
    });

    it("does not affect active state", () => {
      useGuidelineStore.getState().activate();
      useGuidelineStore.getState().clearAll();
      expect(useGuidelineStore.getState().active).toBe(true);
    });
  });
});
