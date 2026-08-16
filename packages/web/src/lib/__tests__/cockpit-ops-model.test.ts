import { describe, it, expect } from "vitest";
import { buildOpsSetupPlan, formatSetupDuration } from "../cockpit-ops-model.js";
import { BAR_CATALOGUE_SLUG } from "../guest-flow-layout-input.js";
import { CATALOGUE_ITEMS, type CatalogueItem } from "../catalogue.js";
import type { PlacedItem } from "../placement.js";

function find(predicate: (item: CatalogueItem) => boolean, label: string): CatalogueItem {
  const item = CATALOGUE_ITEMS.find(predicate);
  if (item === undefined) throw new Error(`No catalogue item for ${label}`);
  return item;
}
const roundTable = (): CatalogueItem => find((c) => c.category === "table" && c.tableShape === "round", "round table");
const chair = (): CatalogueItem => find((c) => c.category === "chair", "chair");
const stage = (): CatalogueItem => find((c) => c.category === "stage", "stage");
const bar = (): CatalogueItem => find((c) => c.slug === BAR_CATALOGUE_SLUG, "bar");
const poseur = (): CatalogueItem => find((c) => c.slug === "poseur-table", "poseur table");
const blackPoseur = (): CatalogueItem => find((c) => c.slug === "poseur-table-black", "black poseur table");
const whitePoseur = (): CatalogueItem => find((c) => c.slug === "poseur-table-white", "white poseur table");
const micStand = (): CatalogueItem => find((c) => c.slug === "mic-stand", "mic stand");

function place(item: CatalogueItem, n: number, clothed = false): PlacedItem[] {
  return Array.from({ length: n }, (_unused, index) => ({
    id: `${item.slug}-${String(index)}`,
    catalogueItemId: item.id,
    x: 0, y: 0, z: 0, rotationY: 0,
    clothed, clothStyle: null, tableSetting: null, groupId: null,
  }));
}

describe("buildOpsSetupPlan", () => {
  it("derives load-in tasks, effort, crew and setup time from the layout", () => {
    const items = [...place(stage(), 1), ...place(roundTable(), 18), ...place(chair(), 144), ...place(bar(), 1)];
    const plan = buildOpsSetupPlan(items);

    // Tasks in load-in order, only non-empty ones.
    expect(plan.tasks.map((t) => t.key)).toEqual(["stage", "round-tables", "chairs", "bar"]);
    const chairsTask = plan.tasks.find((t) => t.key === "chairs");
    expect(chairsTask?.count).toBe(144);
    expect(chairsTask?.effortMinutes).toBe(72); // 144 × 0.5

    // 20 (stage) + 54 (18×3) + 72 (chairs) + 15 (bar) = 161 crew-minutes.
    expect(plan.totalItems).toBe(164);
    expect(plan.totalCrewMinutes).toBe(161);
    expect(plan.suggestedCrew).toBe(2); // ceil(161 / 90)
    expect(plan.estimatedSetupMinutes).toBe(81); // ceil(161 / 2)
  });

  it("adds a linen task only for clothed tables", () => {
    const items = [...place(roundTable(), 4, true), ...place(chair(), 32)];
    const plan = buildOpsSetupPlan(items);
    const dress = plan.tasks.find((t) => t.key === "dress-tables");
    expect(dress?.count).toBe(4);
    expect(dress?.effortMinutes).toBe(16); // 4 × 4

    const bare = buildOpsSetupPlan(place(roundTable(), 4, false));
    expect(bare.tasks.find((t) => t.key === "dress-tables")).toBeUndefined();
  });

  it("positions poseurs without labelling them as round dining tables", () => {
    const plan = buildOpsSetupPlan(place(poseur(), 3));

    expect(plan.tasks).toEqual([
      { key: "poseur-tables", label: "Position poseur tables", count: 3, effortMinutes: 9 },
    ]);
    expect(plan.tasks.some((task) => task.key === "round-tables")).toBe(false);
    expect(plan.totalItems).toBe(3);
  });

  it("counts intrinsic poseur linen in the setup plan without persisted cloth flags", () => {
    const plan = buildOpsSetupPlan([
      ...place(blackPoseur(), 1, false),
      ...place(whitePoseur(), 1, false),
    ]);

    expect(plan.tasks.find((task) => task.key === "poseur-tables")?.count).toBe(2);
    expect(plan.tasks.find((task) => task.key === "dress-tables")).toEqual({
      key: "dress-tables",
      label: "Dress tables (linen)",
      count: 2,
      effortMinutes: 8,
    });
    expect(plan.tasks.some((task) => task.key === "round-tables")).toBe(false);
    expect(plan.totalItems).toBe(2);
  });

  it("keeps a passive mic stand in the existing Ops AV equipment count", () => {
    const plan = buildOpsSetupPlan(place(micStand(), 1));

    expect(plan.tasks).toEqual([
      { key: "av", label: "Set up AV / equipment", count: 1, effortMinutes: 10 },
    ]);
    expect(plan.totalItems).toBe(1);
  });

  it("returns an empty plan for an empty layout", () => {
    const plan = buildOpsSetupPlan([]);
    expect(plan.tasks).toHaveLength(0);
    expect(plan.totalItems).toBe(0);
    expect(plan.totalCrewMinutes).toBe(0);
    expect(plan.suggestedCrew).toBe(0);
    expect(plan.estimatedSetupMinutes).toBe(0);
  });

  it("adds a lighting rig task from the Lighting lens, early in the load-in", () => {
    const plan = buildOpsSetupPlan(place(chair(), 10), { lightingFixtures: 18 });
    const lighting = plan.tasks.find((t) => t.key === "lighting");
    expect(lighting?.count).toBe(18);
    expect(lighting?.effortMinutes).toBe(108); // 18 × 6
    // Lighting rigs before furniture: it is the first task here (no stage placed).
    expect(plan.tasks[0]?.key).toBe("lighting");
  });

  it("ignores the lighting option when no rig is set", () => {
    const plan = buildOpsSetupPlan(place(chair(), 10), { lightingFixtures: 0 });
    expect(plan.tasks.find((t) => t.key === "lighting")).toBeUndefined();
  });
});

describe("formatSetupDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatSetupDuration(45)).toBe("45 min");
    expect(formatSetupDuration(60)).toBe("1 h");
    expect(formatSetupDuration(81)).toBe("1 h 21 min");
    expect(formatSetupDuration(0)).toBe("0 min");
  });
});
