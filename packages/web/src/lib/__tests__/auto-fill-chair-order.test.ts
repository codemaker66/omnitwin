import { describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS, toRealWorld } from "../../constants/scale.js";
import { getCatalogueItemBySlug, type CatalogueItem } from "../catalogue.js";
import { GRAND_HALL_DOOR_CLEAR_SPACES, doorKeepOuts } from "../door-clear-spaces.js";
import { GRAND_HALL_CHAIR_ORDER, isPlannerChair, plannerChairOrder } from "../furniture-defaults.js";
import { autoFillBasis, planAutoFill, planTheatreFill, plannerChairSupply, type TheatreFillPlan } from "../auto-fill.js";

// ---------------------------------------------------------------------------
// The Grand Hall's chairs past one kind's stock (Blake, 28 Oct 2026, verbatim:
// "So for the grand hall we normally use the pink chair, then the checked
// chair, then the red with gold legs chair."), and only the chairs the hall
// owns ("only use the chairs i gave you inventory for"): theatre rows take the
// event's chair at the front, then the hall's order as each kind runs out,
// one kind to a row.
// ---------------------------------------------------------------------------

function chairBySlug(slug: string): CatalogueItem {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`No ${slug} in the catalogue`);
  return item;
}

const turini = chairBySlug("burgess-turini-18-3");
const checked = chairBySlug("checked-banquet-chair");
const redGold = chairBySlug("gallery-chair-red-gold");
const chiavari = chairBySlug("chiavari-chair");
const pink = chairBySlug("pink-chair");

const widthM = toRealWorld(GRAND_HALL_RENDER_DIMENSIONS.width);
const lengthM = toRealWorld(GRAND_HALL_RENDER_DIMENSIONS.length);
const doorSpaces = doorKeepOuts(GRAND_HALL_DOOR_CLEAR_SPACES);

/** The kinds in the order the rows take them; a kind never returns once the rows have moved on. */
function kindsInRowOrder(plan: TheatreFillPlan): readonly string[] {
  const order: string[] = [];
  for (const seat of plan.seats) {
    if (order.at(-1) === seat.chairItemId) continue;
    expect(order, "a kind returns after the rows moved on").not.toContain(seat.chairItemId);
    order.push(seat.chairItemId);
  }
  return order;
}

describe("the hall's chair order", () => {
  it("is the event's chair, then pink, checked, and red with gold legs", () => {
    expect(GRAND_HALL_CHAIR_ORDER).toEqual(["burgess-turini-18-3", "checked-banquet-chair", "gallery-chair-red-gold"]);
    expect(plannerChairOrder("burgess-turini-18-3")).toEqual(GRAND_HALL_CHAIR_ORDER);
    expect(plannerChairOrder("chiavari-chair")).toEqual(["chiavari-chair", ...GRAND_HALL_CHAIR_ORDER]);
    for (const slug of GRAND_HALL_CHAIR_ORDER) expect(isPlannerChair(slug)).toBe(true);
  });

  it("counts each chair from the store where its figures are known, else from the hall's recorded chairs, the Turini as the pink chair", () => {
    const recorded = plannerChairSupply("burgess-turini-18-3", null).map(({ item, inStore }) => [item.slug, inStore]);
    expect(recorded).toEqual([["burgess-turini-18-3", 120], ["checked-banquet-chair", 106], ["gallery-chair-red-gold", 107]]);
    const store = new Map([[pink.id, 80], [checked.id, 0]]);
    const known = plannerChairSupply("burgess-turini-18-3", store).map(({ inStore }) => inStore);
    expect(known).toEqual([80, 0, 107]);
  });
});

describe("theatre rows past one kind's stock", () => {
  it("seats the Grand Hall for 250 with its doors clear in the hall's chairs, front rows pink, a kind to a row", () => {
    const plan = planTheatreFill(turini, 250, widthM, lengthM, { doorSpaces, chairSupply: plannerChairSupply("burgess-turini-18-3", null) });
    expect(plan).not.toBeNull();
    if (plan === null) return;
    expect(plan.meetsTarget).toBe(true);
    expect(plan.chairsRanOut).toBe(false);
    expect(plan.chairItemId).toBe(turini.id);
    expect(kindsInRowOrder(plan)).toEqual(plan.chairKinds.map(({ chairItemId }) => chairItemId));
    expect(plan.chairKinds[0]?.chairItemId).toBe(turini.id);
    const owned = new Map([[turini.id, 120], [checked.id, 106], [redGold.id, 107]]);
    for (const { chairItemId, seats } of plan.chairKinds) expect(seats).toBeLessThanOrEqual(owned.get(chairItemId) ?? 0);
    expect(plan.chairKinds.length).toBeGreaterThan(1);
  });

  it("puts the wedding's Chiavari at the front, then the hall's order", () => {
    const plan = planTheatreFill(chiavari, 250, widthM, lengthM, { doorSpaces, chairSupply: plannerChairSupply("chiavari-chair", null) });
    expect(plan?.chairKinds[0]?.chairItemId).toBe(chiavari.id);
    expect(plan?.chairKinds.find(({ chairItemId }) => chairItemId === chiavari.id)?.seats).toBeLessThanOrEqual(200);
    expect(plan?.meetsTarget).toBe(true);
  });

  it("stops where the hall's chairs run out, and says so", () => {
    const plan = planTheatreFill(turini, 200, widthM, lengthM, { doorSpaces, chairSupply: [{ item: turini, inStore: 40 }] });
    expect(plan).not.toBeNull();
    if (plan === null) return;
    expect(plan.chairs).toBeLessThanOrEqual(40);
    expect(plan.chairsRanOut).toBe(true);
    expect(plan.meetsTarget).toBe(false);
    expect(autoFillBasis(plan)).toContain("The hall's chairs ran out before the room did.");
  });

  it("names the rows' chairs in the staff's words, without a count", () => {
    const plan = planAutoFill("theatre", 250, widthM, lengthM, "burgess-turini-18-3", { doorSpaces, chairSupply: plannerChairSupply("burgess-turini-18-3", null) });
    expect(plan?.style).toBe("theatre");
    if (plan?.style !== "theatre") return;
    const basis = autoFillBasis(plan);
    expect(basis).toMatch(/ The front rows take the pink chair, then the checked chair(, then the red chair with gold legs)?, as the hall's own chairs run\.$/u);
    expect(basis).not.toMatch(/\d+ (pink|checked|red)/u);
  });

  it("sets every row in the one chair asked for, without limit, where no supply is named", () => {
    const plan = planTheatreFill(turini, 250, widthM, lengthM, { doorSpaces });
    expect(plan?.chairKinds).toEqual([{ chairItemId: turini.id, seats: plan?.chairs }]);
    expect(plan?.chairsRanOut).toBe(false);
  });
});
