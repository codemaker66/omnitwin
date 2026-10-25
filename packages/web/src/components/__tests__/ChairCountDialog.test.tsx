import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useChairDialogStore } from "../../stores/chair-dialog-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { createPlacedItem } from "../../lib/placement.js";
import { createTableGroup, rearrangeTableGroup } from "../../lib/table-group.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { registerEscapeLayer, registerKeyBindings } from "../../lib/planner-keys.js";
import {
  ChairCountDialog,
  type ChairCountRequest,
} from "../ChairCountDialog.js";

afterEach(() => {
  cleanup();
  useChairDialogStore.getState().clearDialog();
  usePlacementStore.setState({ placedItems: [] });
  vi.useRealTimers();
});

describe("ChairCountDialog seat truth", () => {
  it("starts a 6 ft round at ten and steps it between eight and twelve", () => {
    const table = getCatalogueItemBySlug("round-table-6ft-white");
    if (table === undefined) throw new Error("Round table fixture missing");
    render(<ChairCountDialog request={{ catalogueItemId: table.id, x: 0, z: 0, rotationY: 0, tableShape: "round" }} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByLabelText<HTMLInputElement>("Chair count");
    expect(input.value).toBe("10");
    expect(input.min).toBe("8");
    expect(input.max).toBe("12");
    expect(screen.getByText("8 – 12 chairs")).toBeDefined();
  });

  it("starts a placed table's stepper from the chairs it already has", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    if (table === undefined) throw new Error("Round table fixture missing");
    const group = createTableGroup(table.id, 0, 0, 0, 9);
    const placed = group[0];
    if (placed === undefined) throw new Error("No table placed");
    usePlacementStore.setState({ placedItems: group });
    const request: ChairCountRequest = { catalogueItemId: table.id, x: 0, z: 0, rotationY: 0, tableShape: "round" };
    useChairDialogStore.getState().showDialog(request, placed.id);
    render(<ChairCountDialog request={request} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText<HTMLInputElement>("Chair count").value).toBe("9");
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

  it("presses the focused button on Enter instead of placing chairs", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    if (table === undefined) throw new Error("Round table fixture missing");
    const onConfirm = vi.fn<(count: number) => void>();
    render(<ChairCountDialog request={{ catalogueItemId: table.id, x: 0, z: 0, rotationY: 0, tableShape: "round" }} onConfirm={onConfirm} onCancel={vi.fn()} />);

    for (const name of ["Cancel", "Table Only"]) {
      const button = screen.getByRole("button", { name });
      button.focus();
      fireEvent.keyDown(button, { code: "Enter", key: "Enter" });
    }
    expect(onConfirm).not.toHaveBeenCalled();

    // Enter from the count still places the chairs.
    fireEvent.keyDown(screen.getByLabelText("Chair count"), { code: "Enter", key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("holds the keyboard while open: Escape cancels before anything behind it, arrows step, Enter places", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    if (table === undefined) throw new Error("Round table fixture missing");
    const onConfirm = vi.fn<(count: number) => void>();
    const onCancel = vi.fn<() => void>();
    const behindEscape = vi.fn();
    const behindShortcut = vi.fn();
    const stopBehind = [
      registerEscapeLayer({ kind: "selection", isOpen: () => true, escape: behindEscape }),
      registerKeyBindings([{ keys: [{ code: "KeyF" }], run: behindShortcut }]),
    ];
    try {
      const request: ChairCountRequest = { catalogueItemId: table.id, x: 0, z: 0, rotationY: 0, tableShape: "round" };
      const { rerender } = render(<ChairCountDialog request={request} onConfirm={onConfirm} onCancel={onCancel} />);
      // The count is redrawn (a new element) on every step.
      const count = (): HTMLInputElement => screen.getByLabelText<HTMLInputElement>("Chair count");
      const start = Number(count().value);

      fireEvent.keyDown(window, { code: "KeyF", key: "f" });
      expect(behindShortcut).not.toHaveBeenCalled();

      fireEvent.keyDown(window, { code: "ArrowDown", key: "ArrowDown" });
      fireEvent.keyDown(window, { code: "ArrowDown", key: "ArrowDown", repeat: true });
      expect(count().value).toBe(String(start - 2));

      // In the count, the arrows are the number field's own.
      const input = count();
      const inField = fireEvent.keyDown(input, { code: "ArrowDown", key: "ArrowDown" });
      expect(inField).toBe(true);
      expect(count()).toBe(input);

      fireEvent.keyDown(input, { code: "NumpadEnter", key: "Enter" });
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(start - 2);

      fireEvent.keyDown(input, { code: "Escape", key: "Escape" });
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(behindEscape).not.toHaveBeenCalled();

      // Closed, it neither holds Escape nor answers Enter.
      rerender(<ChairCountDialog request={null} onConfirm={onConfirm} onCancel={onCancel} />);
      fireEvent.keyDown(window, { code: "Enter", key: "Enter" });
      fireEvent.keyDown(window, { code: "Escape", key: "Escape" });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(behindEscape).toHaveBeenCalledTimes(1);
    } finally {
      for (const stop of stopBehind) stop();
    }
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
