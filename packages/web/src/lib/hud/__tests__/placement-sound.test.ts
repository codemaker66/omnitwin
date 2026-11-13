import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCatalogueItem } from "../../catalogue.js";
import type { PlacedItem } from "../../placement.js";
import { setPlannerFeaturesForTesting } from "../../planner-features.js";
import { cardParamsFor, stampSetup } from "../../setup-cards.js";
import { placementSound } from "../placement-sound.js";

// ---------------------------------------------------------------------------
// One sound for each act of setting down, never one per piece: a table with
// its chairs is one set-down, a lone chair a chair, and many sets at once
// (Lay out) the brush.
// ---------------------------------------------------------------------------

const TURINI = "burgess-turini-18-3";

let sequence = 0;
const newId = (): string => {
  sequence += 1;
  return `piece-${String(sequence)}`;
};

function round(x: number): readonly PlacedItem[] {
  const params = cardParamsFor("round", { seats: 10 });
  if (params === null) throw new Error("no round card");
  return stampSetup(params, { x, z: 0 }, 0, newId, TURINI);
}

const ids = (items: readonly PlacedItem[]): string[] => items.map((item) => item.id);

beforeEach(() => {
  sequence = 0;
  setPlannerFeaturesForTesting({ tableSets: true, setupCards: true, seatsOnTheCard: true });
});

afterEach(() => {
  setPlannerFeaturesForTesting(null);
});

describe("the sound a placement makes", () => {
  it("sets a table down with its chairs as one sound", () => {
    const set = round(0);
    expect(set.length, "a round of ten is a table and its chairs").toBeGreaterThan(1);
    expect(new Set(set.map((item) => item.groupId)).size, "one set").toBe(1);
    expect(placementSound(ids(set), set)).toBe("planner-set-table");
  });

  it("sets a lone chair down as a chair", () => {
    const chair = round(0).find((item) => getCatalogueItem(item.catalogueItemId)?.category === "chair");
    if (chair === undefined) throw new Error("a round has chairs");
    const alone: PlacedItem = { ...chair, groupId: null };
    expect(placementSound([alone.id], [alone])).toBe("planner-set-chair");
  });

  it("plays the brush once for many sets placed together, as Lay out does", () => {
    const room = [...round(-5), ...round(0), ...round(5)];
    expect(placementSound(ids(room), room)).toBe("planner-brush");
  });

  it("hears only what was just placed, and nothing when none of it is in the room", () => {
    const earlier = round(-5);
    const now = round(5);
    const room = [...earlier, ...now];
    expect(placementSound(ids(now), room)).toBe("planner-set-table");
    expect(placementSound(["gone"], room)).toBeNull();
    expect(placementSound([], room)).toBeNull();
  });
});
