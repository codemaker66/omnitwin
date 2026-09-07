import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useChairDialogStore } from "../../stores/chair-dialog-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { createPlacedItem } from "../../lib/placement.js";
import { rearrangeTableGroup } from "../../lib/table-group.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import {
  ChairCountDialog,
  initialChairCountForCapacity,
  type ChairCountRequest,
} from "../ChairCountDialog.js";

afterEach(() => {
  cleanup();
  useChairDialogStore.getState().clearDialog();
  usePlacementStore.setState({ placedItems: [] });
  vi.useRealTimers();
});

describe("initialChairCountForCapacity", () => {
  it("never starts above a scaled table's physical capacity", () => {
    expect(initialChairCountForCapacity("round", 4)).toBe(4);
    expect(initialChairCountForCapacity("rectangular", 1)).toBe(1);
  });

  it("allows table-only when no chair physically fits", () => {
    expect(initialChairCountForCapacity("rectangular", 0)).toBe(0);
  });
});

describe("ChairCountDialog scaled capacity", () => {
  it("escapes the planner stacking context while retaining confirmation and cancellation", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    if (table === undefined) throw new Error("Round table fixture missing");
    const onConfirm = vi.fn<(count: number) => void>();
    const onCancel = vi.fn<() => void>();
    const { container, rerender } = render(<div className="cockpit-stage" style={{ transform: "translateZ(0)" }}>
      <ChairCountDialog request={{ catalogueItemId: table.id, x: 0, z: 0, rotationY: 0, tableShape: "round" }} onConfirm={onConfirm} onCancel={onCancel} />
    </div>);
    const dialog = screen.getByRole("dialog", { name: "Seating Arrangement" });
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    fireEvent.change(screen.getByLabelText("Chair count"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Place 8 Chairs" }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(8);
    fireEvent.keyDown(window, { code: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(<ChairCountDialog request={null} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("submits table-only instead of inventing a seat for a tiny scaled table", () => {
    vi.useFakeTimers();
    const table = getCatalogueItemBySlug("trestle-6ft");
    if (table === undefined) throw new Error("trestle-6ft catalogue item missing");
    const request: ChairCountRequest = {
      catalogueItemId: table.id,
      x: 0,
      z: 0,
      rotationY: 0,
      tableShape: "rectangular",
      scale: 0.01,
    };
    const onConfirm = vi.fn<(count: number) => void>();

    render(
      <ChairCountDialog
        request={request}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText<HTMLInputElement>("Chair count").value).toBe("0");
    expect(screen.getByText("No chairs fit at this scale")).toBeDefined();
    fireEvent.click(screen.getByTestId("chair-count-confirm"));
    expect(onConfirm).toHaveBeenCalledWith(0);
  });
});

it("offers an edit count that fits the saved scaled chairs without changing their assets", () => {
  const tableAsset = getCatalogueItemBySlug("round-table-6ft");
  const chairAsset = getCatalogueItemBySlug("banquet-chair");
  if (tableAsset === undefined || chairAsset === undefined) throw new Error("Missing catalogue fixture");
  const table = createPlacedItem(tableAsset.id, 0, 0, 0, "saved");
  const chair = { ...createPlacedItem(chairAsset.id, 0, 0, 0, "saved"), scale: 2 };
  const items = [table, chair];
  usePlacementStore.setState({ placedItems: items });
  const request: ChairCountRequest = { catalogueItemId: tableAsset.id, x: 0, z: 0, rotationY: 0, tableShape: "round" };
  useChairDialogStore.getState().showDialog(request, table.id);
  const onConfirm = vi.fn<(count: number) => void>();
  render(<ChairCountDialog request={request} onConfirm={onConfirm} onCancel={vi.fn()} />);
  const input = screen.getByLabelText<HTMLInputElement>("Chair count");
  const maximum = Number(input.max);
  expect(maximum).toBeLessThan(13);
  fireEvent.change(input, { target: { value: String(maximum) } });
  fireEvent.click(screen.getByTestId("chair-count-confirm"));
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith(maximum);
  const result = rearrangeTableGroup(table.id, maximum, items);
  expect(result).toHaveLength(maximum + 1);
  expect(result.find((item) => item.id === chair.id)?.catalogueItemId).toBe(chairAsset.id);
});
