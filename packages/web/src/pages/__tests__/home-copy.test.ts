import { describe, expect, it } from "vitest";
import { TRADES_HALL_ROOM_CAPACITIES } from "@omnitwin/types";
import { allFreshCopy } from "../fresh/fresh-copy.js";
import { allTwinCopy } from "../../twin/twin-copy.js";
import {
  HOME_FOOT_TWIN,
  HOME_HERO_TOUR,
  allHomeCopy,
  roomCapacityLine,
} from "../home-copy.js";

// Blake's choice of 16 October 2026, "Name what's there": while the founder
// splat hold stands, the front door names the panorama tour and each room's
// published capacities, and says nothing of Gaussian splats, work in progress
// or the 3D room.

describe("roomCapacityLine", () => {
  it("gives dinner then reception, labelled as the venue labels them", () => {
    expect(roomCapacityLine("grand-hall")).toBe("Dinner 180 · Reception 250");
    expect(roomCapacityLine("saloon")).toBe("Dinner 60 · Reception 80");
  });

  it("reads every published room from the venue's own figures", () => {
    for (const [slug, capacity] of Object.entries(TRADES_HALL_ROOM_CAPACITIES)) {
      expect(roomCapacityLine(slug), slug).toBe(
        `Dinner ${String(capacity.dinner)} · Reception ${String(capacity.reception)}`,
      );
    }
  });

  it.each(["lady-convenors-room", "not-a-room", "", "constructor"])(
    "returns null for %j, which the venue publishes no figures for",
    (slug) => {
      expect(roomCapacityLine(slug)).toBeNull();
    },
  );
});

describe("the front door's wording", () => {
  it("names the panorama tour plainly", () => {
    expect(HOME_HERO_TOUR).toBe("Take the panorama tour");
    expect(HOME_FOOT_TWIN).toBe("Panorama tour");
  });

  it.each([
    ["the front door", allHomeCopy],
    ["/fresh", allFreshCopy],
    ["the tour page", allTwinCopy],
  ])("has no Work in progress, Gaussian or 3D room wording on %s", (_name, words) => {
    for (const line of words()) {
      expect(line, line).not.toMatch(/work in progress|gaussian|3D room/iu);
    }
  });
});
