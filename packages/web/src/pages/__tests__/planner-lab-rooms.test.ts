import { SpaceSchema, TRADES_HALL_ROOMS } from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { plannerLabRoom, plannerLabRoomDimensions, PLANNER_LAB_VENUE_ID } from "../planner-lab-rooms.js";

describe("the planner lab's other rooms", () => {
  it("is the lab's own Grand Hall without ?space=, or for a room it does not have", () => {
    expect(plannerLabRoom("")).toBeNull();
    expect(plannerLabRoom("?guests=40&render=desktop")).toBeNull();
    expect(plannerLabRoom("?space=grand-hall")).toBeNull();
    expect(plannerLabRoom("?space=ballroom")).toBeNull();
    expect(plannerLabRoom("?space=")).toBeNull();
  });

  it("shows the Saloon as production stores its row, in the lab's Trades Hall venue", () => {
    const saloon = plannerLabRoom("?space=saloon&rooms=surveyed");
    if (saloon === null) throw new Error("the lab has no Saloon");
    expect(SpaceSchema.parse(saloon)).toEqual(saloon);
    expect(saloon).toMatchObject({ name: "Saloon", slug: "saloon", venueId: PLANNER_LAB_VENUE_ID, widthM: "12", lengthM: "7", heightM: "5.4" });
    const stored = TRADES_HALL_ROOMS.find((room) => room.slug === "saloon");
    expect(stored).toMatchObject({ name: saloon.name, floorPlanOutline: saloon.floorPlanOutline, sortOrder: saloon.sortOrder });
  });

  it("sizes the room as the planner does, from the room's own geometry", () => {
    const saloon = plannerLabRoom("?space=saloon");
    if (saloon === null) throw new Error("the lab has no Saloon");
    const { width, length, height } = plannerLabRoomDimensions(saloon);
    // The planner's Saloon: 11.9 m and two 0.6 m alcoves wide, 6.9 m deep, 5.4 m high.
    expect(width).toBeCloseTo(13.1, 9);
    expect(length).toBeCloseTo(6.9, 9);
    expect(height).toBe(5.4);
  });
});
