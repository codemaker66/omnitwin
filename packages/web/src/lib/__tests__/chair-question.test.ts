import { afterEach, describe, expect, it } from "vitest";
import { answerChairQuestion, cancelChairQuestion } from "../chair-question.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../catalogue.js";
import { createTableGroup } from "../table-group.js";
import type { ChairCountRequest } from "../../components/ChairCountDialog.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useChairDialogStore } from "../../stores/chair-dialog-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";

function roundTableId(): string {
  const table = getCatalogueItemBySlug("round-table-6ft");
  if (table === undefined) throw new Error("Round table fixture missing");
  return table.id;
}

function question(catalogueItemId: string, x = 2, z = 1): ChairCountRequest {
  return { catalogueItemId, x, z, rotationY: 0, tableShape: "round" };
}

function chairsAt(groupId: string | null): number {
  return usePlacementStore.getState().placedItems.filter((item) => (
    item.groupId === groupId && getCatalogueItem(item.catalogueItemId)?.category === "chair"
  )).length;
}

afterEach(() => {
  useChairDialogStore.getState().clearDialog();
  useCatalogueStore.getState().clearSelection();
  usePlacementStore.setState({ placedItems: [] });
});

describe("the chair question's answers", () => {
  it("places a new table with the seats asked for, and leaves its card in hand for the next", () => {
    const tableId = roundTableId();
    useChairDialogStore.getState().showDialog(question(tableId));
    answerChairQuestion(9);
    const placed = usePlacementStore.getState().placedItems;
    const table = placed.find((item) => item.catalogueItemId === tableId);
    expect(table).toBeDefined();
    expect(chairsAt(table?.groupId ?? null)).toBe(9);
    expect(useChairDialogStore.getState().pending).toBeNull();
    expect(useCatalogueStore.getState().selectedItemId).toBe(tableId);
  });

  it("places the table alone at no seats, its card still in hand", () => {
    const tableId = roundTableId();
    useChairDialogStore.getState().showDialog(question(tableId));
    answerChairQuestion(0);
    expect(usePlacementStore.getState().placedItems.map((item) => item.catalogueItemId)).toEqual([tableId]);
    expect(useCatalogueStore.getState().selectedItemId).toBe(tableId);
  });

  it("puts the card back in hand on a cancel and places nothing, so a misplaced click costs one Cancel", () => {
    const tableId = roundTableId();
    useChairDialogStore.getState().showDialog(question(tableId));
    cancelChairQuestion();
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
    expect(useChairDialogStore.getState().pending).toBeNull();
    expect(useCatalogueStore.getState().selectedItemId).toBe(tableId);
  });

  it("re-seats a placed table and leaves no card in hand, answered or cancelled", () => {
    const tableId = roundTableId();
    const group = createTableGroup(tableId, 0, 0, 0, 8);
    const table = group[0];
    if (table === undefined) throw new Error("No table placed");
    usePlacementStore.setState({ placedItems: group });

    useChairDialogStore.getState().showDialog(question(tableId, 0, 0), table.id);
    answerChairQuestion(10);
    expect(chairsAt(table.groupId)).toBe(10);
    expect(useChairDialogStore.getState().pending).toBeNull();
    expect(useCatalogueStore.getState().selectedItemId).toBeNull();

    useChairDialogStore.getState().showDialog(question(tableId, 0, 0), table.id);
    cancelChairQuestion();
    expect(chairsAt(table.groupId)).toBe(10);
    expect(useCatalogueStore.getState().selectedItemId).toBeNull();
  });
});
