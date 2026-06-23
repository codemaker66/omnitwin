import { describe, it, expect } from "vitest";
import {
  buildCostScenario,
  costQuantitiesFromLayout,
  coversSourceLabel,
  type CostQuantities,
  type CostRates,
} from "../cockpit-cost-model.js";
import { CATALOGUE_ITEMS, type CatalogueItem } from "../catalogue.js";
import type { PlacedItem } from "../placement.js";

function itemByCategory(category: CatalogueItem["category"]): CatalogueItem {
  const item = CATALOGUE_ITEMS.find((candidate) => candidate.category === category);
  if (item === undefined) throw new Error(`No catalogue item for category ${category}`);
  return item;
}

function place(item: CatalogueItem, n: number): PlacedItem[] {
  return Array.from({ length: n }, (_unused, index) => ({
    id: `${item.slug}-${String(index)}`,
    catalogueItemId: item.id,
    x: 0, y: 0, z: 0, rotationY: 0,
    clothed: false, clothStyle: null, tableSetting: null, groupId: null,
  }));
}

const RATES: CostRates = {
  roomHireMinor: 75000, // £750
  cateringPerCoverMinor: 4500, // £45
  furniturePerTableMinor: 800, // £8
  avPerItemMinor: 15000, // £150
  marginPercent: 10,
};

describe("buildCostScenario", () => {
  it("computes line items, subtotal, margin and total with exact integer arithmetic", () => {
    const quantities: CostQuantities = { covers: 100, tables: 12, chairs: 96, avItems: 2, lightingFixtures: 0, coversSource: "guest-count" };
    const model = buildCostScenario(quantities, RATES);
    // room 75000 + catering 100*4500=450000 + furniture 12*800=9600 + av 2*15000=30000
    expect(model.lineItems).toHaveLength(4);
    expect(model.subtotalMinor).toBe(564600);
    expect(model.marginMinor).toBe(56460); // 10%
    expect(model.totalMinor).toBe(621060);
    expect(model.perCoverMinor).toBe(6211); // round(621060 / 100)
  });

  it("omits the catering line and per-cover figure when there are no covers", () => {
    const quantities: CostQuantities = { covers: 0, tables: 0, chairs: 0, avItems: 0, lightingFixtures: 0, coversSource: "none" };
    const model = buildCostScenario(quantities, RATES);
    expect(model.lineItems).toHaveLength(1); // room hire only
    expect(model.lineItems[0]?.key).toBe("room-hire");
    expect(model.perCoverMinor).toBeNull();
    expect(model.totalMinor).toBe(82500); // 75000 + 10%
  });

  it("treats negative / non-finite rates as zero (never a negative line)", () => {
    const quantities: CostQuantities = { covers: 10, tables: 0, chairs: 10, avItems: 0, lightingFixtures: 0, coversSource: "placed-chairs" };
    const model = buildCostScenario(quantities, { ...RATES, roomHireMinor: -5000, cateringPerCoverMinor: 4500, marginPercent: 0 });
    const roomHire = model.lineItems.find((line) => line.key === "room-hire");
    expect(roomHire?.amountMinor).toBe(0);
    expect(model.subtotalMinor).toBe(45000); // catering only
    expect(model.marginMinor).toBe(0);
  });

  it("adds a lighting hire line from the rig fixtures", () => {
    const quantities: CostQuantities = { covers: 0, tables: 0, chairs: 0, avItems: 0, lightingFixtures: 18, coversSource: "none" };
    const model = buildCostScenario(quantities, { ...RATES, roomHireMinor: 0, marginPercent: 0, lightingPerFixtureMinor: 3500 });
    const lighting = model.lineItems.find((line) => line.key === "lighting");
    expect(lighting?.amountMinor).toBe(63000); // 18 × £35
    expect(lighting?.detail).toMatch(/18 fixtures × £35\.00/);
  });
});

describe("costQuantitiesFromLayout", () => {
  it("derives tables / chairs / AV from placed items and covers from the guest count", () => {
    const items = [
      ...place(itemByCategory("table"), 1),
      ...place(itemByCategory("chair"), 8),
      ...place(itemByCategory("av"), 1),
    ];
    const q = costQuantitiesFromLayout(items, 120);
    expect(q.tables).toBe(1);
    expect(q.chairs).toBe(8);
    expect(q.avItems).toBe(1);
    expect(q.covers).toBe(120);
    expect(q.coversSource).toBe("guest-count");
  });

  it("falls back to placed chairs for covers when no guest count is set", () => {
    const items = place(itemByCategory("chair"), 40);
    const q = costQuantitiesFromLayout(items, null);
    expect(q.covers).toBe(40);
    expect(q.coversSource).toBe("placed-chairs");
  });

  it("reports zero covers (source none) for an empty layout", () => {
    const q = costQuantitiesFromLayout([], null);
    expect(q.covers).toBe(0);
    expect(q.coversSource).toBe("none");
    expect(q.lightingFixtures).toBe(0);
  });

  it("passes the rig lighting fixture count through", () => {
    const q = costQuantitiesFromLayout([], 100, 18);
    expect(q.lightingFixtures).toBe(18);
  });
});

describe("coversSourceLabel", () => {
  it("labels every source honestly", () => {
    expect(coversSourceLabel("guest-count")).toMatch(/guest count/i);
    expect(coversSourceLabel("placed-chairs")).toMatch(/chairs/i);
    expect(coversSourceLabel("none")).toMatch(/not set/i);
  });
});
