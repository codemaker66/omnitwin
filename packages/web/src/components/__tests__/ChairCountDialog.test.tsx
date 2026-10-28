import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useChairDialogStore } from "../../stores/chair-dialog-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { createPlacedItem } from "../../lib/placement.js";
import { chairCountRange, createTableGroup, rearrangeTableGroup, seatCapacity } from "../../lib/table-group.js";
import { getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { registerEscapeLayer, registerKeyBindings } from "../../lib/planner-keys.js";
import {
  CHAIR_DIALOG_CANCEL_FADE_MS,
  ChairCountDialog,
  forgetRememberedSeatsForTests,
  type ChairCountRequest,
} from "../ChairCountDialog.js";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../lib/reduced-motion.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/reduced-motion.js")>();
  return { ...actual, prefersReducedMotion: () => motion.reduced };
});

afterEach(() => {
  cleanup();
  useChairDialogStore.getState().clearDialog();
  usePlacementStore.setState({ placedItems: [] });
  forgetRememberedSeatsForTests();
  motion.reduced = false;
  vi.useRealTimers();
});

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return item.id;
}

function round(slug = "round-table-6ft"): ChairCountRequest {
  return { catalogueItemId: catalogueId(slug), x: 0, z: 0, rotationY: 0, tableShape: "round" };
}

const seats = (): HTMLInputElement => screen.getByLabelText<HTMLInputElement>("Seats");

describe("ChairCountDialog seat truth", () => {
  it("starts a 6 ft round at ten and steps it between eight and twelve", () => {
    render(<ChairCountDialog request={round("round-table-6ft-white")} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(seats().value).toBe("10");
    expect(seats().min).toBe("8");
    expect(seats().max).toBe("12");
    expect(screen.getByText("8 – 12 seats")).toBeDefined();
  });

  it("starts a placed table's stepper from the chairs it already has", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    if (table === undefined) throw new Error("Round table fixture missing");
    const group = createTableGroup(table.id, 0, 0, 0, 9);
    const placed = group[0];
    if (placed === undefined) throw new Error("No table placed");
    usePlacementStore.setState({ placedItems: group });
    const request = round();
    useChairDialogStore.getState().showDialog(request, placed.id);
    render(<ChairCountDialog request={request} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(seats().value).toBe("9");
    expect(screen.getByTestId("chair-count-confirm").textContent).toBe("Set 9 seats");
  });

  it("lets a placed round keep fewer chairs than seat truth's eight", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    if (table === undefined) throw new Error("Round table fixture missing");
    const group = createTableGroup(table.id, 0, 0, 0, 6);
    const placed = group[0];
    if (placed === undefined) throw new Error("No table placed");
    usePlacementStore.setState({ placedItems: group });
    const request = round();
    useChairDialogStore.getState().showDialog(request, placed.id);
    render(<ChairCountDialog request={request} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(seats().value).toBe("6");
    expect(seats().min).toBe("6");
    expect(seats().max).toBe("12");
  });
});

describe("ChairCountDialog's starting count", () => {
  it("starts a new table from the count last placed at that kind of table, cloth or none", () => {
    const onConfirm = vi.fn<(count: number) => void>();
    const onCancel = vi.fn<() => void>();
    const { rerender } = render(<ChairCountDialog request={round()} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.change(seats(), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Place with 12 seats" }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(12);

    rerender(<ChairCountDialog request={null} onConfirm={onConfirm} onCancel={onCancel} />);
    rerender(<ChairCountDialog request={round("round-table-6ft-white")} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(seats().value).toBe("12");

    // Another kind of table starts from its own count.
    const trestle = getCatalogueItemBySlug("trestle-6ft");
    if (trestle === undefined) throw new Error("trestle-6ft catalogue item missing");
    rerender(<ChairCountDialog request={null} onConfirm={onConfirm} onCancel={onCancel} />);
    rerender(<ChairCountDialog
      request={{ catalogueItemId: trestle.id, x: 0, z: 0, rotationY: 0, tableShape: "rectangular" }}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />);
    expect(seats().value).toBe(String(chairCountRange(trestle, seatCapacity(trestle)).initial));
  });

  it("starts a placed table from its own chairs, whatever was placed last", () => {
    const onConfirm = vi.fn<(count: number) => void>();
    const { rerender } = render(<ChairCountDialog request={round()} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.change(seats(), { target: { value: "12" } });
    fireEvent.keyDown(seats(), { code: "Enter", key: "Enter" });
    rerender(<ChairCountDialog request={null} onConfirm={onConfirm} onCancel={vi.fn()} />);

    const group = createTableGroup(catalogueId("round-table-6ft"), 0, 0, 0, 9);
    const placed = group[0];
    if (placed === undefined) throw new Error("No table placed");
    usePlacementStore.setState({ placedItems: group });
    const request = round();
    act(() => { useChairDialogStore.getState().showDialog(request, placed.id); });
    rerender(<ChairCountDialog request={request} onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(seats().value).toBe("9");
  });
});

describe("ChairCountDialog's typed count", () => {
  it("takes what is typed as a draft, with no clamp per key, and Enter places it", () => {
    const onConfirm = vi.fn<(count: number) => void>();
    render(<ChairCountDialog request={round()} onConfirm={onConfirm} onCancel={vi.fn()} />);
    // The first key of "11" is not a count a round takes, and is left as typed.
    fireEvent.change(seats(), { target: { value: "1" } });
    expect(seats().value).toBe("1");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(seats(), { target: { value: "11" } });
    expect(screen.getByTestId("chair-count-confirm").textContent).toBe("Place with 11 seats");
    fireEvent.keyDown(seats(), { code: "Enter", key: "Enter" });
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(11);
  });

  it("says what a round takes, and places nothing, for a count it cannot take", () => {
    const onConfirm = vi.fn<(count: number) => void>();
    render(<ChairCountDialog request={round()} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.change(seats(), { target: { value: "20" } });
    // The button names the 20 it was asked for, never a count it would not place.
    expect(screen.getByTestId("chair-count-confirm").textContent).toBe("Place with 20 seats");
    fireEvent.keyDown(seats(), { code: "Enter", key: "Enter" });
    fireEvent.click(screen.getByTestId("chair-count-confirm"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Rounds take 8 to 12");
    expect(seats().getAttribute("aria-invalid")).toBe("true");
    // A step starts from the nearest count it takes.
    fireEvent.click(screen.getByRole("button", { name: "Fewer seats" }), { detail: 0 });
    expect(seats().value).toBe("11");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the count it had when the field is left empty, and warns when left out of range", () => {
    render(<ChairCountDialog request={round()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(seats(), { target: { value: "" } });
    fireEvent.blur(seats());
    expect(seats().value).toBe("10");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(seats(), { target: { value: "3" } });
    fireEvent.blur(seats());
    expect(seats().value).toBe("3");
    expect(screen.getByRole("alert").textContent).toBe("Rounds take 8 to 12");
  });
});

describe("ChairCountDialog's steppers", () => {
  it("step from the keyboard (a click with no pointer), and once for each pointer press", () => {
    render(<ChairCountDialog request={round()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "More seats" }), { detail: 0 });
    expect(seats().value).toBe("11");
    const fewer = screen.getByRole("button", { name: "Fewer seats" });
    fireEvent.pointerDown(fewer);
    fireEvent.pointerUp(fewer);
    fireEvent.click(fewer, { detail: 1 });
    expect(seats().value).toBe("10");
  });
});

describe("ChairCountDialog's close", () => {
  it("places at once: the room's set-down is the answer", () => {
    const onConfirm = vi.fn<(count: number) => void>();
    render(<ChairCountDialog request={round()} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByTestId("chair-count-confirm"));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(10);
  });

  it("fades out over 90 ms on a cancel, and answers nothing while it fades", () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn<(count: number) => void>();
    const onCancel = vi.fn<() => void>();
    render(<ChairCountDialog request={round()} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("chair-count-dialog").getAttribute("data-leaving")).toBe("true");
    fireEvent.click(screen.getByTestId("chair-count-confirm"));
    fireEvent.keyDown(window, { code: "Escape", key: "Escape" });
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(CHAIR_DIALOG_CANCEL_FADE_MS); });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels at once under reduced motion", () => {
    motion.reduced = true;
    const onCancel = vi.fn<() => void>();
    render(<ChairCountDialog request={round()} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("still cancels when it is taken away mid-fade", () => {
    vi.useFakeTimers();
    const onCancel = vi.fn<() => void>();
    const { unmount } = render(<ChairCountDialog request={round()} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    unmount();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("ChairCountDialog scaled capacity", () => {
  it("escapes the planner stacking context while retaining confirmation and cancellation", () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn<(count: number) => void>();
    const onCancel = vi.fn<() => void>();
    const { container, rerender } = render(<div className="cockpit-stage" style={{ transform: "translateZ(0)" }}>
      <ChairCountDialog request={round()} onConfirm={onConfirm} onCancel={onCancel} />
    </div>);
    const dialog = screen.getByRole("dialog", { name: "Seats at this round" });
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    fireEvent.change(seats(), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Place with 8 seats" }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(8);
    fireEvent.keyDown(window, { code: "Escape" });
    act(() => { vi.advanceTimersByTime(CHAIR_DIALOG_CANCEL_FADE_MS); });
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(<ChairCountDialog request={null} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("presses the focused button on Enter instead of placing chairs", () => {
    const onConfirm = vi.fn<(count: number) => void>();
    render(<ChairCountDialog request={round()} onConfirm={onConfirm} onCancel={vi.fn()} />);

    for (const name of ["Cancel", "Table only"]) {
      const button = screen.getByRole("button", { name });
      button.focus();
      fireEvent.keyDown(button, { code: "Enter", key: "Enter" });
    }
    expect(onConfirm).not.toHaveBeenCalled();

    // Enter from the count still places the chairs.
    fireEvent.keyDown(seats(), { code: "Enter", key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("holds the keyboard while open: Escape cancels before anything behind it, arrows step, Enter places", () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn<(count: number) => void>();
    const onCancel = vi.fn<() => void>();
    const behindEscape = vi.fn();
    const behindShortcut = vi.fn();
    const stopBehind = [
      registerEscapeLayer({ kind: "selection", isOpen: () => true, escape: behindEscape }),
      registerKeyBindings([{ keys: [{ code: "KeyF" }], run: behindShortcut }]),
    ];
    try {
      const request = round();
      const { rerender } = render(<ChairCountDialog request={request} onConfirm={onConfirm} onCancel={onCancel} />);
      const start = Number(seats().value);

      fireEvent.keyDown(window, { code: "KeyF", key: "f" });
      expect(behindShortcut).not.toHaveBeenCalled();

      fireEvent.keyDown(window, { code: "ArrowDown", key: "ArrowDown" });
      fireEvent.keyDown(window, { code: "ArrowDown", key: "ArrowDown", repeat: true });
      expect(seats().value).toBe(String(start - 2));

      // In the count, the arrows are the number field's own.
      const input = seats();
      const inField = fireEvent.keyDown(input, { code: "ArrowDown", key: "ArrowDown" });
      expect(inField).toBe(true);
      expect(seats()).toBe(input);

      fireEvent.keyDown(input, { code: "NumpadEnter", key: "Enter" });
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(start - 2);

      fireEvent.keyDown(input, { code: "Escape", key: "Escape" });
      act(() => { vi.advanceTimersByTime(CHAIR_DIALOG_CANCEL_FADE_MS); });
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

    expect(seats().value).toBe("0");
    expect(screen.getByText("No seats fit at this scale")).toBeDefined();
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
  const maximum = Number(seats().max);
  expect(maximum).toBeLessThan(13);
  fireEvent.change(seats(), { target: { value: String(maximum) } });
  fireEvent.click(screen.getByTestId("chair-count-confirm"));
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith(maximum);
  const result = rearrangeTableGroup(table.id, maximum, items);
  expect(result).toHaveLength(maximum + 1);
  expect(result.find((item) => item.id === chair.id)?.catalogueItemId).toBe(chairAsset.id);
});
