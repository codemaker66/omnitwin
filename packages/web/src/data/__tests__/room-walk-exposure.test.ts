import { describe, expect, it } from "vitest";
import { roomsWithSplatBundles } from "../room-splat-bundles.js";
import {
  ROOM_WALK_EXPOSURE,
  isRoomWalkable,
  roomWalkExposure,
} from "../room-walk-exposure.js";

// The public walk is a decision per room, recorded as reviewable project data
// with its reason and date - not a magic list in a page. A room absent from
// the record is NOT walkable: the safe default is the closed door.
describe("room walk exposure", () => {
  it("records a decision for every captured room", () => {
    for (const slug of roomsWithSplatBundles()) {
      const decision = roomWalkExposure(slug);
      expect(decision, slug).not.toBeNull();
      expect(decision?.decidedOn, slug).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(decision?.reason.length ?? 0, slug).toBeGreaterThan(20);
    }
  });

  it("closes the door on the three rooms whose walk box cannot yet hold the room", () => {
    expect(isRoomWalkable("robert-adam-room")).toBe(false);
    expect(isRoomWalkable("north-gallery")).toBe(false);
    expect(isRoomWalkable("lady-convenors-room")).toBe(false);
  });

  it("keeps the rooms whose walk keeps the visitor inside", () => {
    for (const slug of ["grand-hall", "saloon", "south-gallery", "reception-room", "deacon-conveners-room"]) {
      expect(isRoomWalkable(slug), slug).toBe(true);
    }
  });

  it("treats an unknown room as not walkable", () => {
    expect(isRoomWalkable("no-such-room")).toBe(false);
    expect(roomWalkExposure("no-such-room")).toBeNull();
  });

  it("names no room that has no capture", () => {
    const captured = new Set(roomsWithSplatBundles());
    for (const slug of Object.keys(ROOM_WALK_EXPOSURE)) expect(captured.has(slug), slug).toBe(true);
  });
});
