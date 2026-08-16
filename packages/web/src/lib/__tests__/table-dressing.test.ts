import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import {
  isTableDressingApplicator,
  isSceneFurniturePlacement,
  sceneFurniturePlacements,
  selectedTableIds,
  selectedDiningTableIds,
  tableClothStyleForCatalogueItem,
  tableDressingTargetIds,
  tableGroupedChairCount,
  tableSettingForCatalogueItem,
} from "../table-dressing.js";
import { createPlacedItem, getGroupMemberIds } from "../placement.js";
import { placedCirculationFootprints } from "../circulation-scene.js";
import { seatingCountsFromPlacedItems } from "../seating-counts.js";
import { buildOpsSetupPlan } from "../cockpit-ops-model.js";
import { generateDiagramLabels } from "../diagram-labels.js";
import { buildGuestFlowReplayInputFromLayout } from "../guest-flow-layout-input.js";

const blackClothId = getCatalogueItemBySlug("black-table-cloth")?.id ?? "missing-black-cloth";
const whiteClothId = getCatalogueItemBySlug("white-table-cloth")?.id ?? "missing-white-cloth";
const dinnerSettingId = getCatalogueItemBySlug("dinner-place-setting")?.id ?? "missing-dinner-setting";
const tableId = getCatalogueItemBySlug("round-table-6ft")?.id ?? "missing-round-table";
const chairId = getCatalogueItemBySlug("banquet-chair")?.id ?? "missing-chair";
const poseurId = getCatalogueItemBySlug("poseur-table")?.id ?? "missing-poseur";
const blackPoseurId = getCatalogueItemBySlug("poseur-table-black")?.id ?? "missing-black-poseur";
const whitePoseurId = getCatalogueItemBySlug("poseur-table-white")?.id ?? "missing-white-poseur";

describe("table dressing catalogue helpers", () => {
  it("identifies only the three contextual applicators by canonical UUID or slug", () => {
    const applicators = [
      ["black-table-cloth", blackClothId, "edc002d8-77a5-508a-bd5d-a5dc9ec74b5e"],
      ["white-table-cloth", whiteClothId, "22a9184e-694e-5458-af23-4b95ed37ceeb"],
      ["dinner-place-setting", dinnerSettingId, "1797ad4e-89c2-5895-a3e8-9af85ec110c0"],
    ] as const;

    for (const [slug, id, canonicalId] of applicators) {
      expect(id).toBe(canonicalId);
      expect(isTableDressingApplicator(slug)).toBe(true);
      expect(isTableDressingApplicator(id)).toBe(true);
    }

    expect(isTableDressingApplicator(tableId)).toBe(false);
    expect(isTableDressingApplicator("not-a-catalogue-item")).toBe(false);
    expect(isTableDressingApplicator(null)).toBe(false);
  });

  it("resolves black and white cloth styles from UUIDs and slugs", () => {
    expect(tableClothStyleForCatalogueItem(blackClothId)).toBe("black");
    expect(tableClothStyleForCatalogueItem("black-table-cloth")).toBe("black");
    expect(tableClothStyleForCatalogueItem(whiteClothId)).toBe("white");
    expect(tableClothStyleForCatalogueItem("white-table-cloth")).toBe("white");
  });

  it("resolves dinner table settings without treating cloths as settings", () => {
    expect(tableSettingForCatalogueItem(dinnerSettingId)).toBe("dinner");
    expect(tableSettingForCatalogueItem("dinner-place-setting")).toBe("dinner");
    expect(tableSettingForCatalogueItem(blackClothId)).toBeNull();
  });

  it("retains a leaked row as data while excluding it from scene and operations derivations", () => {
    const leaked = createPlacedItem(blackClothId, 0, 0);
    const replay = buildGuestFlowReplayInputFromLayout({
      roomWidthM: 10,
      roomLengthM: 10,
      placedItems: [leaked],
      plannedGuestCount: 20,
    });

    expect(isSceneFurniturePlacement(leaked)).toBe(false);
    expect(sceneFurniturePlacements([leaked])).toEqual([]);
    expect(placedCirculationFootprints([leaked])).toEqual([]);
    expect(seatingCountsFromPlacedItems([leaked])).toEqual({
      roundTables: 0,
      banquetTables: 0,
      chairs: 0,
    });
    expect(buildOpsSetupPlan([leaked])).toMatchObject({
      tasks: [],
      totalItems: 0,
      totalCrewMinutes: 0,
    });
    expect(generateDiagramLabels([leaked])).toEqual([]);
    expect(replay.obstacles).toEqual([]);
    expect(replay.layout.placedObjectCount).toBe(0);
  });

  it("excludes a leaked applicator from group-driven selection expansion", () => {
    const table = { ...createPlacedItem(tableId, 0, 0), groupId: "legacy-group" };
    const leaked = { ...createPlacedItem(blackClothId, 0, 0), groupId: "legacy-group" };

    expect([...getGroupMemberIds(table.id, [table, leaked])]).toEqual([table.id]);
    expect([...getGroupMemberIds(leaked.id, [table, leaked])]).toEqual([]);
  });
});

describe("table dressing target selection", () => {
  it("targets selected tables before the nearest hovered table", () => {
    const tableA = createPlacedItem(tableId, 0, 0);
    const tableB = createPlacedItem(tableId, 4, 0);
    const chair = createPlacedItem(chairId, 8, 0);
    const placed = [tableA, tableB, chair];

    expect(selectedTableIds(placed, new Set([tableA.id, chair.id]))).toEqual([tableA.id]);
    expect(tableDressingTargetIds(placed, new Set([tableA.id, chair.id]), tableB.id)).toEqual([tableA.id]);
  });

  it("falls back to the nearest table when no selected table exists", () => {
    const table = createPlacedItem(tableId, 0, 0);
    const chair = createPlacedItem(chairId, 4, 0);

    expect(tableDressingTargetIds([table, chair], new Set([chair.id]), table.id)).toEqual([table.id]);
    expect(tableDressingTargetIds([table, chair], new Set([chair.id]), null)).toEqual([]);
  });

  it("allows poseur linen but excludes poseurs from dinner-setting targets", () => {
    const poseur = createPlacedItem(poseurId, 0, 0);
    const table = createPlacedItem(tableId, 4, 0);
    const placed = [poseur, table];

    expect(selectedTableIds(placed, new Set([poseur.id]))).toEqual([poseur.id]);
    expect(selectedDiningTableIds(placed, new Set([poseur.id]))).toEqual([]);
    expect(tableDressingTargetIds(placed, new Set([poseur.id]), null, "linen")).toEqual([
      poseur.id,
    ]);
    expect(tableDressingTargetIds(placed, new Set([poseur.id]), poseur.id, "dinner")).toEqual([]);
    expect(tableDressingTargetIds(placed, new Set([poseur.id]), table.id, "dinner")).toEqual([
      table.id,
    ]);
  });

  it("never targets intrinsic-cloth poseurs with a second generic cloth", () => {
    const barePoseur = createPlacedItem(poseurId, 0, 0);
    const blackPoseur = createPlacedItem(blackPoseurId, 2, 0);
    const whitePoseur = createPlacedItem(whitePoseurId, 4, 0);
    const placed = [barePoseur, blackPoseur, whitePoseur];
    const allSelected = new Set(placed.map((placedItem) => placedItem.id));

    expect(selectedTableIds(placed, allSelected)).toEqual([barePoseur.id]);
    expect(tableDressingTargetIds(placed, new Set([blackPoseur.id]), blackPoseur.id)).toEqual([]);
    expect(tableDressingTargetIds(placed, new Set([whitePoseur.id]), barePoseur.id)).toEqual([
      barePoseur.id,
    ]);
  });

  it("counts grouped chairs so dinner settings match the table ring", () => {
    const table = { ...createPlacedItem(tableId, 0, 0), groupId: "g-table" };
    const chairA = { ...createPlacedItem(chairId, 1, 0), groupId: "g-table" };
    const chairB = { ...createPlacedItem(chairId, -1, 0), groupId: "g-table" };
    const looseChair = createPlacedItem(chairId, 4, 0);

    expect(tableGroupedChairCount([table, chairA, chairB, looseChair], table)).toBe(2);
    expect(tableGroupedChairCount([looseChair], looseChair)).toBeUndefined();
  });
});
