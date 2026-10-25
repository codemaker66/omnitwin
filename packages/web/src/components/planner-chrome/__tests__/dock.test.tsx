import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The dock (T-671 slice 8′; spec 4.1, 6.3; card-dock spec §12): Plan · Room ·
// Walk on Shift 1 2 3, Add · Lay out · Measure · Draw, Undo · Redo named for
// what they would do. Its keys are the same in every state; a key that cannot
// act stays in place, dimmed, and says why.
// ---------------------------------------------------------------------------

const facts = vi.hoisted(() => ({
  hall: true,
  undo: null as string | null,
  redo: null as string | null,
}));
vi.mock("../../grand-hall/hall-space.js", () => ({ useModelledGrandHall: () => facts.hall }));
vi.mock("../../../lib/editor-history.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  canUndo: () => facts.undo !== null,
  canRedo: () => facts.redo !== null,
  undoLabel: () => facts.undo,
  redoLabel: () => facts.redo,
}));

const { Dock, DOCK_LABELS } = await import("../Dock.js");
const { useHallViewStore } = await import("../../../stores/hall-view-store.js");
const { useCockpitStore } = await import("../../../stores/cockpit-store.js");
const { useToolStore } = await import("../../../stores/tool-store.js");
const { usePlannerChromeStore } = await import("../../../stores/planner-chrome-store.js");
const { useEditorStore } = await import("../../../stores/editor-store.js");

beforeEach(() => {
  facts.hall = true;
  facts.undo = null;
  facts.redo = null;
  useHallViewStore.setState({ activePreset: "room", viewRequest: null });
  useCockpitStore.getState().setWalkMode(false);
  useToolStore.getState().setTool("select");
  usePlannerChromeStore.getState().closeAll();
});
afterEach(cleanup);

function dock(): HTMLElement {
  return screen.getByRole("toolbar", { name: "The dock" });
}

function keyNames(): string[] {
  return Array.from(dock().querySelectorAll("button")).map((key) => {
    const words = (key.textContent ?? "").trim();
    return words.length > 0 ? words : key.getAttribute("aria-label") ?? "";
  });
}

describe("the dock's keys", () => {
  it("are the same keys in the same places whatever the planner is doing", () => {
    render(<Dock />);
    const atRest = keyNames();
    expect(atRest).toEqual(["Plan", "Room", "Walk", "Add", "Lay out", "Measure", "Draw", "Undo: Nothing to undo yet", "Redo: Nothing to redo yet"]);
    act(() => { useToolStore.getState().setTool("measure"); });
    expect(keyNames()).toEqual(atRest);
    act(() => { useToolStore.getState().setTool("draw"); });
    expect(keyNames()).toEqual(atRest);
    act(() => { useCockpitStore.getState().setWalkMode(true); });
    expect(keyNames()).toEqual(atRest);
  });

  it("never gives two keys one word stem (Lay out is never beside Layout)", () => {
    const stems = DOCK_LABELS.map((label) => label.toLowerCase().replace(/\s+/gu, "").slice(0, 5));
    expect(new Set(stems).size).toBe(stems.length);
  });
});

describe("the view", () => {
  it("names the view in use and moves on Shift 1, 2 and 3", () => {
    render(<Dock />);
    const views = within(dock()).getByRole("radiogroup", { name: "View" });
    expect(within(views).getByRole("radio", { name: /^Room/u }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(window, { key: "!", code: "Digit1", shiftKey: true });
    expect(useHallViewStore.getState().activePreset).toBe("plan");
    fireEvent.keyDown(window, { key: "#", code: "Digit3", shiftKey: true });
    expect(useHallViewStore.getState().activePreset).toBe("walk");
    fireEvent.keyDown(window, { key: "@", code: "Digit2", shiftKey: true });
    expect(useHallViewStore.getState().activePreset).toBe("room");
    // Plain digits belong to the cards (B7), not the views.
    fireEvent.keyDown(window, { key: "1", code: "Digit1" });
    expect(useHallViewStore.getState().activePreset).toBe("room");
  });

  it("switches on a press of a view key", () => {
    render(<Dock />);
    fireEvent.click(within(dock()).getByRole("radio", { name: /^Plan/u }));
    expect(useHallViewStore.getState().activePreset).toBe("plan");
  });

  it("stays in place, dimmed, where the room has no set views yet, and says why", () => {
    facts.hall = false;
    render(<Dock />);
    const plan = within(dock()).getByRole("radio", { name: /^Plan: / });
    expect(plan.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(plan);
    fireEvent.keyDown(window, { key: "!", code: "Digit1", shiftKey: true });
    expect(useHallViewStore.getState().activePreset).toBe("room");
  });
});

describe("the tools", () => {
  it("lays out in the right zone, and Measure and Draw stay on until pressed again", () => {
    render(<Dock />);
    fireEvent.click(within(dock()).getByRole("button", { name: /^Lay out/u }));
    expect(usePlannerChromeStore.getState().right).toBe("lay-out");
    expect(within(dock()).getByRole("button", { name: /^Lay out/u }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(within(dock()).getByRole("button", { name: /^Measure/u }));
    expect(useToolStore.getState().activeTool).toBe("measure");
    fireEvent.click(within(dock()).getByRole("button", { name: /^Measure/u }));
    expect(useToolStore.getState().activeTool).toBe("select");
    fireEvent.keyDown(window, { key: "l", code: "KeyL" });
    expect(usePlannerChromeStore.getState().right).toBeNull();
  });

  it("names Undo and Redo for what they would do", () => {
    facts.undo = "Place Round table";
    facts.redo = "Move Table 3";
    const undo = vi.spyOn(useEditorStore.getState(), "undo");
    render(<Dock />);
    const key = within(dock()).getByRole("button", { name: /^Undo Place Round table/u });
    fireEvent.click(key);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(within(dock()).getByRole("button", { name: /^Redo Move Table 3/u })).toBeTruthy();
  });
});
