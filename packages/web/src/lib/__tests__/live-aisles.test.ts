import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { FILL_AISLE_RULE, GRAND_HALL_WALL_NAMES, gangwayReview, grandHallExits } from "../auto-fill.js";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { CIRCULATION_AISLE } from "../circulation.js";
import { liveAisles, type LiveAisleOptions } from "../clearance-ring.js";
import { createPlacedItem, type PlacedItem } from "../placement.js";
import { cardParamsFor, stampSetup } from "../setup-cards.js";

const HALL = GRAND_HALL_RENDER_DIMENSIONS;
const OPTIONS: LiveAisleOptions = { exits: grandHallExits(), wallNames: GRAND_HALL_WALL_NAMES };
/** A 6 ft round's outermost chair reach along Z: its ring radius and half a chair's depth. */
const CHAIR_REACH = 0.915 + 0.05 + 0.58;

let counter = 0;
function ids(): string {
  counter += 1;
  return `a-${String(counter)}`;
}

function round(x: number, z: number): readonly PlacedItem[] {
  const params = cardParamsFor("round");
  if (params === null) throw new Error("no round");
  return stampSetup(params, { x, z }, 0, ids);
}

function lectern(x: number, z: number, id: string): PlacedItem {
  const item = getCatalogueItemBySlug("lectern");
  if (item === undefined) throw new Error("no lectern");
  return createPlacedItem(item.id, x, z, 0, null, 0, id);
}

/** A ghost round and a placed one directly across Z, `gap` metres chair back to chair back. */
function across(gap: number): { readonly ghost: readonly PlacedItem[]; readonly placed: readonly PlacedItem[] } {
  return { ghost: round(0, -2.1), placed: round(0, -2.1 + 2 * CHAIR_REACH + gap) };
}

describe("live aisles in the planner's bands", () => {
  it("measures chair back to chair back, in sage when comfortable", () => {
    const { ghost, placed } = across(1.4);
    const [nearest] = liveAisles(ghost, placed, HALL, OPTIONS);
    expect(nearest?.gapM).toBeCloseTo(1.4, 6);
    expect(nearest).toMatchObject({ words: "1.4 m", tone: "sage", neighbour: "the round's chairs", onGangway: false });
  });

  it("names a tight aisle and one with no way through, in amber", () => {
    const tight = across(0.8);
    expect(liveAisles(tight.ghost, tight.placed, HALL, OPTIONS)[0]).toMatchObject({ words: "0.8 m · tight", tone: "amber", band: "tight" });
    const blocked = across(0.3);
    expect(liveAisles(blocked.ghost, blocked.placed, HALL, OPTIONS)[0]).toMatchObject({ words: "0.3 m · no way through", tone: "amber", band: "blocked" });
  });

  it("measures to the walls too", () => {
    const ghost = [lectern(HALL.width / 2 - 0.3 - 0.8, 0, "ghost")];
    const [nearest] = liveAisles(ghost, [], HALL, OPTIONS);
    expect(nearest).toMatchObject({ neighbour: "the end wall", words: "0.8 m · tight", onGangway: false });
    expect(nearest?.gapM).toBeCloseTo(0.8, 6);
  });

  it("flags a designated gangway under the 1.1 m guidance, and never refuses it", () => {
    const ghost = round(0, -HALL.length / 2 + 0.95 + CHAIR_REACH);
    const [nearest] = liveAisles(ghost, [], HALL, OPTIONS);
    expect(nearest).toMatchObject({
      neighbour: "the window wall",
      onGangway: true,
      tone: "amber",
      words: "Gangway 0.95 m · under the 1.1 m guidance · goes to the venue with this layout",
    });
    const wide = liveAisles(round(0, -HALL.length / 2 + 1.2 + CHAIR_REACH), [], HALL, OPTIONS)[0];
    expect(wide).toMatchObject({ onGangway: true, tone: "sage", words: "1.2 m" });
  });

  it("flags a pinch across a middle gangway where the design has one", () => {
    const rule = { ...FILL_AISLE_RULE, gangwayM: 1.2 };
    const ghost = round(-1, -(0.4 + CHAIR_REACH));
    const placed = round(-1, 0.4 + CHAIR_REACH);
    const [nearest] = liveAisles(ghost, placed, HALL, { ...OPTIONS, rule });
    expect(nearest).toMatchObject({ onGangway: true, words: "Gangway 0.80 m · under the 1.2 m guidance · goes to the venue with this layout" });
  });

  it("flags a round pushed past the middle gangway's centre line, as the review does", () => {
    const rule = { ...FILL_AISLE_RULE, gangwayM: 1.2 };
    // The ghost's near chair reaches 0.65 m past the line; it still stands on its own table's side.
    const ghost = round(-1, 0.65 - CHAIR_REACH);
    const placed = round(-1, 1.25 + CHAIR_REACH);
    const [nearest] = liveAisles(ghost, placed, HALL, { ...OPTIONS, rule });
    expect(nearest?.gapM).toBeCloseTo(0.6, 6);
    expect(nearest).toMatchObject({ onGangway: true, words: "Gangway 0.60 m · under the 1.2 m guidance · goes to the venue with this layout" });
    const review = gangwayReview([...ghost, ...placed], HALL, grandHallExits(), { wallNames: GRAND_HALL_WALL_NAMES, rule }).filter((item) => item.gangway === "the middle");
    expect(review.map((item) => item.widthM)).toEqual([nearest?.gapM]);
  });

  it("measures a turned round with no chairs as the review does, to the millimetre", () => {
    const item = getCatalogueItemBySlug("round-table-6ft-white");
    if (item === undefined) throw new Error("no round");
    const table = createPlacedItem(item.id, 0, HALL.length / 2 - 1.0 - 0.915, Math.PI / 4, null, 0, "turned");
    const doorWall = liveAisles([table], [], HALL, OPTIONS).find((line) => line.neighbour === "the door wall");
    const [listed] = gangwayReview([table], HALL, grandHallExits(), { wallNames: GRAND_HALL_WALL_NAMES });
    expect(doorWall?.gapM).toBeCloseTo(1.0, 9);
    expect(listed?.widthM).toBeCloseTo(doorWall?.gapM ?? Number.NaN, 9);
    expect(doorWall?.words).toBe("Gangway 1.00 m · under the 1.1 m guidance · goes to the venue with this layout");
  });

  it("measures to the three nearest only, nearest first", () => {
    const ghost = [lectern(0, 0, "ghost")];
    const placed = [lectern(1.5, 0, "a"), lectern(-2.5, 0, "b"), lectern(0, 1.8, "c"), lectern(0, -3.5, "d")];
    const lines = liveAisles(ghost, placed, HALL, OPTIONS);
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.gapM)).toEqual([...lines.map((line) => line.gapM)].sort((a, b) => a - b));
    expect(lines[0]?.gapM).toBeCloseTo(0.9, 6);
  });

  it("gives the caption the same lines as the ghost for a set already placed", () => {
    const { ghost, placed } = across(1.0);
    const asGhost = liveAisles(ghost, placed, HALL, OPTIONS);
    const asCaption = liveAisles(ghost, [...placed, ...ghost], HALL, { ...OPTIONS, excludeIds: new Set(ghost.map((piece) => piece.id)) });
    expect(asCaption).toEqual(asGhost);
  });
});

describe("one figure for comfortable", () => {
  it("keeps the API's venue planning policy at the planner's comfortable aisle", () => {
    const policy = readFileSync(resolve("../api/src/services/layout-planning-policy.ts"), "utf8");
    const match = /minPrimaryFurnitureClearanceM:\s*([\d.]+)/u.exec(policy);
    expect(Number(match?.[1])).toBe(CIRCULATION_AISLE.comfortableM);
  });
});
