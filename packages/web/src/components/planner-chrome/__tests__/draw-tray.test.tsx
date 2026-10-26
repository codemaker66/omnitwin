import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DRAW_WIDTHS, DrawTray, nearestWidth } from "../DrawTray.js";
import { useMarkupStore, type MarkupStroke } from "../../../stores/markup-store.js";
import { useToolStore } from "../../../stores/tool-store.js";

// ---------------------------------------------------------------------------
// The Draw tray (T-674 slice 14; approved spec §6.8): above the dock only
// while the pen is in hand (the dock's Draw key and D), with the inks, two
// widths, Undo for the last stroke and Clear, and the plain fact that the
// drawing is kept on this device only (QoL lens C-09).
// ---------------------------------------------------------------------------

function stroke(id: string): MarkupStroke {
  return { id, color: "gold", width: 0.034, points: [{ x: 0, z: 0 }, { x: 1, z: 1 }], createdAtMs: 1 };
}

beforeEach(() => {
  useToolStore.getState().setTool("select");
  useMarkupStore.getState().loadStrokes([]);
  useMarkupStore.getState().setColor("gold");
  useMarkupStore.getState().setWidth(DRAW_WIDTHS.fine);
});
afterEach(() => {
  cleanup();
  useToolStore.getState().setTool("select");
});

describe("the Draw tray", () => {
  it("shows only while Draw is on, and never turns it on or off itself", () => {
    render(<DrawTray />);
    expect(screen.queryByTestId("planner-draw-tray")).toBeNull();
    act(() => { useToolStore.getState().setTool("draw"); });
    expect(screen.getByTestId("planner-draw-tray")).toBeTruthy();
    expect(useMarkupStore.getState().active).toBe(true);
    act(() => { useToolStore.getState().setTool("select"); });
    expect(screen.queryByTestId("planner-draw-tray")).toBeNull();
  });

  it("chooses the ink and the width the pen draws with", () => {
    act(() => { useToolStore.getState().setTool("draw"); });
    render(<DrawTray />);
    fireEvent.click(screen.getByRole("radio", { name: "Blue" }));
    expect(useMarkupStore.getState().selectedColor).toBe("cyan");
    expect(screen.getByRole("radio", { name: "Blue" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Broad" }));
    expect(useMarkupStore.getState().selectedWidth).toBe(DRAW_WIDTHS.broad);
    expect(screen.getByRole("radio", { name: "Broad" }).getAttribute("aria-checked")).toBe("true");
  });

  it("moves between inks with the arrows, as one radio group", () => {
    act(() => { useToolStore.getState().setTool("draw"); });
    render(<DrawTray />);
    fireEvent.keyDown(screen.getByRole("radiogroup", { name: "Ink" }), { key: "ArrowRight" });
    expect(useMarkupStore.getState().selectedColor).toBe("ivory");
  });

  it("undoes the last stroke, says why it cannot with nothing drawn, and brings a cleared drawing back", () => {
    act(() => { useToolStore.getState().setTool("draw"); });
    render(<DrawTray />);
    const undo = (): HTMLElement => screen.getByRole("button", { name: /^(?:Undo the last stroke|Bring back the drawing)/u });
    expect(undo().getAttribute("aria-disabled")).toBe("true");
    expect(undo().getAttribute("aria-label")).toContain("Nothing drawn yet");
    act(() => { useMarkupStore.setState({ strokes: [stroke("markup-1"), stroke("markup-2")] }); });
    expect(undo().getAttribute("aria-label")).toBe("Undo the last stroke, Ctrl Z");
    fireEvent.click(undo());
    expect(useMarkupStore.getState().strokes.map((s) => s.id)).toEqual(["markup-1"]);
    fireEvent.click(screen.getByRole("button", { name: /^Clear the drawing/u }));
    expect(useMarkupStore.getState().strokes).toHaveLength(0);
    expect(undo().getAttribute("aria-label")).toBe("Bring back the drawing, Ctrl Z");
    fireEvent.click(undo());
    expect(useMarkupStore.getState().strokes.map((s) => s.id)).toEqual(["markup-1"]);
  });

  it("says plainly where the drawing is kept", () => {
    act(() => { useToolStore.getState().setTool("draw"); });
    render(<DrawTray />);
    expect(screen.getByTestId("planner-draw-tray").textContent).toContain("Kept on this device only");
  });

  it("shows a width set elsewhere as the nearer of the two", () => {
    expect(nearestWidth(0.02)).toBe("fine");
    expect(nearestWidth(0.07)).toBe("broad");
  });
});
