import { describe, expect, it } from "vitest";
import {
  CAPACITY_FORMATS,
  TRADES_HALL_ROOM_CAPACITIES,
} from "../../../lib/trades-hall-venue-truth.js";
import { roomPlan } from "../room-plan.js";

// ---------------------------------------------------------------------------
// room-plan — the whole point is that the drawing IS the published number.
// Every room x format must draw exactly its capacity, deterministically,
// inside the plate.
// ---------------------------------------------------------------------------

const slugs = Object.keys(TRADES_HALL_ROOM_CAPACITIES) as (keyof
  typeof TRADES_HALL_ROOM_CAPACITIES)[];

describe("roomPlan", () => {
  it("draws exactly the published capacity for every room and format", () => {
    for (const slug of slugs) {
      for (const format of CAPACITY_FORMATS) {
        const capacity = TRADES_HALL_ROOM_CAPACITIES[slug][format.key];
        const plan = roomPlan(format.key, capacity);
        expect(plan.dots, `${slug} ${format.key}`).toHaveLength(capacity);
        expect(plan.count).toBe(capacity);
      }
    }
  });

  it("seats dinner in rounds of ten, the last table taking the remainder", () => {
    expect(roomPlan("dinner", 180).tables).toHaveLength(18);
    expect(roomPlan("dinner", 65).tables).toHaveLength(7);
    expect(roomPlan("dinner", 65).dots).toHaveLength(65);
  });

  it("is deterministic — the same number always draws the same room", () => {
    expect(roomPlan("reception", 250)).toEqual(roomPlan("reception", 250));
    expect(roomPlan("theatre", 80)).toEqual(roomPlan("theatre", 80));
  });

  it("keeps every mark inside the plate", () => {
    for (const format of CAPACITY_FORMATS) {
      const plan = roomPlan(format.key, 250);
      for (const dot of plan.dots) {
        expect(dot.x).toBeGreaterThanOrEqual(0);
        expect(dot.x).toBeLessThanOrEqual(plan.width);
        expect(dot.y).toBeGreaterThanOrEqual(0);
        expect(dot.y).toBeLessThanOrEqual(plan.height);
      }
    }
  });

  it("draws nothing for a zero capacity", () => {
    expect(roomPlan("dinner", 0).dots).toHaveLength(0);
  });
});
