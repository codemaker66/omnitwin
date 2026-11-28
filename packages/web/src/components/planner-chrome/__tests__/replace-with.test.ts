import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { carriedNoteIds, heldNoteIds, registerHeldNotes } from "../../../lib/guest-plan-notes.js";
import type { PlacedItem } from "../../../lib/placement.js";
import { armOrCancel } from "../card-keys.js";
import { replacePreview, replaceWith } from "../replace-with.js";
import { useCardsStore } from "../../../stores/cards-store.js";
import { useCatalogueStore } from "../../../stores/catalogue-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlacementNoticeStore } from "../../../stores/placement-notice-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { usePlannerChromeStore } from "../../../stores/planner-chrome-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";

// ---------------------------------------------------------------------------
// Replace… (T-671 slice 11′; card-dock spec §8): the caption puts the cards in
// replace mode; a card pressed then (rail, digit or catalogue) replaces the
// selection through lane E's replaceSelection, one step, with E's receipt;
// pointing at a card says what would happen; the store refuses for staff.
// ---------------------------------------------------------------------------

function idOf(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`no ${slug}`);
  return item.id;
}

function round(name: string, x: number): PlacedItem[] {
  const group = `g-${name}`;
  const at = (id: string, slug: string, px: number, pz: number, extra: Partial<PlacedItem> = {}): PlacedItem =>
    ({ id, catalogueItemId: idOf(slug), x: px, y: 0, z: pz, rotationY: 0, clothed: false, clothStyle: null, tableSetting: null, groupId: group, ...extra });
  return [
    at(name, "round-table-6ft", x, 0, { label: name.replace("t", "Table ") }),
    ...Array.from({ length: 10 }, (_, n) => at(`${name}-c${String(n)}`, "banquet-chair", x + 0.95 * Math.cos(n * 0.628), 0.95 * Math.sin(n * 0.628))),
  ];
}

beforeEach(() => {
  usePlacementStore.setState({ placedItems: [...round("t1", -3), ...round("t2", 0)] });
  useSelectionStore.getState().selectMultiple(["t1", "t2"]);
  useCardsStore.getState().reset();
  useCatalogueStore.getState().disarm();
  usePlannerChromeStore.getState().clearReceipt();
});

afterEach(() => {
  // Back to the editor store's own reading of the open plan's held notes, as it registers it.
  registerHeldNotes(() => heldNoteIds(useEditorStore.getState()), () => carriedNoteIds(useEditorStore.getState()));
});

describe("replacing", () => {
  it("replaces the selection with the card, posts lane E's receipt, and leaves replace mode", () => {
    useCardsStore.getState().startReplacing("Replace 2 Round 6 ft with…");
    expect(replaceWith("long-table")).toBe(true);
    const placed = usePlacementStore.getState().placedItems;
    expect(placed.some((piece) => piece.id === "t1" || piece.id === "t2")).toBe(false);
    expect(placed.length).toBeGreaterThan(0);
    expect(usePlannerChromeStore.getState().receipt?.text).toMatch(/^Replaced /u);
    expect(useCardsStore.getState().replacing).toBeNull();
  });

  it("takes a rail card's press or digit as the replacement, not as arming", () => {
    useCardsStore.getState().startReplacing("Replace 2 Round 6 ft with…");
    armOrCancel("long-table");
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
    expect(usePlacementStore.getState().placedItems.some((piece) => piece.id === "t1")).toBe(false);
  });

  it("says what would happen before it does", () => {
    const preview = replacePreview("long-table");
    expect(preview?.ok).toBe(true);
    expect(preview?.text).toMatch(/^Replace /u);
    expect(usePlacementStore.getState().placedItems.some((piece) => piece.id === "t1")).toBe(true); // nothing changed
  });

  // #388: a table holding a note this browser is not shown is never replaced, and the card pointed at says so
  // first, in the command's own sentence (lib/replace: a preview is given the command's answer).
  it("says before it is pressed that a table holding a note this browser is not shown is not replaced", () => {
    registerHeldNotes(() => new Set(["t1"]));
    const refusal = "Nothing was replaced: Table 1 has a note that cannot be shown here.";
    expect(replacePreview("long-table")).toEqual({ ok: false, text: refusal });
    useCardsStore.getState().startReplacing("Replace 2 Round 6 ft with…");
    expect(replaceWith("long-table")).toBe(false);
    expect(usePlacementStore.getState().placedItems.some((piece) => piece.id === "t1")).toBe(true);
    expect(usePlacementNoticeStore.getState().notice?.text).toBe(refusal);
  });

  it("refuses, for staff, when the store holds too few, and stays in replace mode", () => {
    useCardsStore.getState().setStock(new Map([[idOf("trestle-6ft"), 0]]));
    useCardsStore.getState().startReplacing("Replace 2 Round 6 ft with…");
    expect(replaceWith("long-table")).toBe(false);
    expect(usePlacementStore.getState().placedItems.some((piece) => piece.id === "t1")).toBe(true);
    expect(useCardsStore.getState().replacing).not.toBeNull();
  });

  // #357 V5: Replace… is offered for dining tables alone; a selection that is no longer that is never replaced.
  it("refuses, and leaves replace mode, once the selection is not all dining tables", () => {
    const bar: PlacedItem = { id: "bar", catalogueItemId: idOf("bar-counter"), x: 6, y: 0, z: 0, rotationY: 0, clothed: false, clothStyle: null, tableSetting: null, groupId: null };
    usePlacementStore.setState({ placedItems: [...usePlacementStore.getState().placedItems, bar] });
    useCardsStore.getState().startReplacing("Replace 2 Round 6 ft with…");
    useSelectionStore.getState().select("bar");
    expect(replaceWith("long-table")).toBe(false);
    expect(usePlacementStore.getState().placedItems.some((piece) => piece.id === "bar")).toBe(true);
    expect(useCardsStore.getState().replacing).toBeNull();
    useCardsStore.getState().startReplacing("Replace 2 Round 6 ft with…");
    useSelectionStore.getState().clearSelection();
    expect(replaceWith("long-table")).toBe(false);
    expect(useCardsStore.getState().replacing).toBeNull();
  });
});
