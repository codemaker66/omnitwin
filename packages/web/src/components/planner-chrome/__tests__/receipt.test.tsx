import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Receipt, RECEIPT_MS } from "../Receipt.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlannerChromeStore } from "../../../stores/planner-chrome-store.js";

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
