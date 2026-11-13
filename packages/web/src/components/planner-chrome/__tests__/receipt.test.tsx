import type { ReactElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Receipt, RECEIPT_MS } from "../Receipt.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlannerChromeStore } from "../../../stores/planner-chrome-store.js";
import { postPlacementNotice, usePlacementNoticeStore } from "../../../stores/placement-notice-store.js";

// ---------------------------------------------------------------------------
// Receipts (T-671; approved spec §6.9): one line above the dock for 5 s with
// role="status": "Table 7 put back in store · Undo · Ctrl Z". Undo is the
// dock's own undo; a newer receipt replaces the older and has its own 5 s.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  usePlannerChromeStore.getState().clearReceipt();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a receipt", () => {
  it("says what happened, offers Undo, and goes after five seconds", () => {
    render(<Receipt />);
    expect(screen.queryByText(/put back in store/u)).toBeNull();
    act(() => { usePlannerChromeStore.getState().postReceipt("Table 7 put back in store", { undo: true }); });
    expect(screen.getByRole("status").textContent).toContain("Table 7 put back in store");
    expect(screen.getByRole("button", { name: /^Undo/u })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(RECEIPT_MS - 1); });
    expect(screen.queryByText(/put back in store/u)).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText(/put back in store/u)).toBeNull();
  });

  it("undoes with the dock's own undo, and then goes", () => {
    const undo = vi.spyOn(useEditorStore.getState(), "undo").mockImplementation(() => undefined);
    render(<Receipt />);
    act(() => { usePlannerChromeStore.getState().postReceipt("Table 7 put back in store", { undo: true }); });
    fireEvent.click(screen.getByRole("button", { name: /^Undo/u }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/put back in store/u)).toBeNull();
  });

  it("gives a newer receipt its own five seconds", () => {
    render(<Receipt />);
    act(() => { usePlannerChromeStore.getState().postReceipt("Table 7 put back in store", { undo: true }); });
    act(() => { vi.advanceTimersByTime(4000); });
    act(() => { usePlannerChromeStore.getState().postReceipt("Replaced 4 rounds with 2 long tables", { undo: true }); });
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByRole("status").textContent).toContain("Replaced 4 rounds with 2 long tables");
  });

  it("offers no Undo when there is nothing to take back", () => {
    render(<Receipt />);
    act(() => { usePlannerChromeStore.getState().postReceipt("Saved", { undo: false }); });
    expect(screen.queryByRole("button", { name: /^Undo/u })).toBeNull();
  });
});

// #357 V7: the line went after 5 s even while its Undo had focus or the pointer, and focus fell to the page.
describe("a receipt someone is holding", () => {
  /** The dock's own Undo, where focus goes back to. */
  function WithDock(): ReactElement {
    return (
      <>
        <button type="button" data-dock-undo="">Dock undo</button>
        <Receipt />
      </>
    );
  }

  it("stays while its Undo has focus, and has five seconds again once focus leaves", () => {
    render(<WithDock />);
    act(() => { usePlannerChromeStore.getState().postReceipt("Table 7 put back in store", { undo: true }); });
    act(() => { screen.getByRole("button", { name: /^Undo/u }).focus(); });
    act(() => { vi.advanceTimersByTime(RECEIPT_MS * 3); });
    expect(screen.queryByText(/put back in store/u)).not.toBeNull();
    act(() => { screen.getByRole("button", { name: "Dock undo" }).focus(); });
    act(() => { vi.advanceTimersByTime(RECEIPT_MS - 1); });
    expect(screen.queryByText(/put back in store/u)).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText(/put back in store/u)).toBeNull();
  });

  it("stays while the pointer is on it", () => {
    render(<WithDock />);
    act(() => { usePlannerChromeStore.getState().postReceipt("Table 7 put back in store", { undo: true }); });
    const line = screen.getByText(/put back in store/u).closest("p") as HTMLElement;
    fireEvent.pointerEnter(line);
    act(() => { vi.advanceTimersByTime(RECEIPT_MS * 2); });
    expect(screen.queryByText(/put back in store/u)).not.toBeNull();
    fireEvent.pointerLeave(line);
    act(() => { vi.advanceTimersByTime(RECEIPT_MS); });
    expect(screen.queryByText(/put back in store/u)).toBeNull();
  });

  it("hands focus to the dock's Undo when it goes with focus in it", () => {
    vi.spyOn(useEditorStore.getState(), "undo").mockImplementation(() => undefined);
    render(<WithDock />);
    act(() => { usePlannerChromeStore.getState().postReceipt("Table 7 put back in store", { undo: true }); });
    const undo = screen.getByRole("button", { name: /^Undo/u });
    act(() => { undo.focus(); });
    fireEvent.click(undo);
    expect(screen.queryByText(/put back in store/u)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Dock undo" }));
  });
});

describe("the engine's notices (v2 has no other place for them)", () => {
  it("shows an undoable notice with Undo, and a plain one (a refusal) without", () => {
    render(<Receipt />);
    act(() => { postPlacementNotice("Pasted 3 tables from the Grand Hall", { undo: true }); });
    expect(screen.getByRole("status").textContent).toContain("Pasted 3 tables from the Grand Hall");
    expect(screen.getByRole("button", { name: /^Undo/u })).toBeTruthy();
    act(() => { postPlacementNotice("Won't fit · would overlap Table 2's chairs by 0.5 m"); });
    expect(screen.getByRole("status").textContent).toContain("Won't fit");
    expect(screen.queryByRole("button", { name: /^Undo/u })).toBeNull();
    act(() => { usePlacementNoticeStore.getState().dismiss(); });
  });
});
