import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CANONICAL_ASSETS } from "@omnitwin/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlueprintPage } from "../pages/BlueprintPage.js";
import { MobilePlannerTopBar } from "../components/editor/MobilePlannerTopBar.js";
import { useEditorStore, type EditorObject } from "../stores/editor-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { GuestsLensPanel } from "../components/editor/cockpit/GuestsLensPanel.js";
import { MAX_GUEST_FLOW_AGENTS } from "../lib/guest-flow-layout-input.js";

// ---------------------------------------------------------------------------
// BlueprintFromStore — the 2D paper view of the live editor store.
// The canvas toolbar's undo/redo buttons must drive the same editor-store
// history as the 3D view, so a change made in 3D can be undone from 2D
// and vice versa (one timeline across both views).
// ---------------------------------------------------------------------------

beforeEach(() => {
  useEditorStore.getState().reset();
  useCockpitStore.getState().reset();
});

afterEach(() => {
  cleanup();
  useEditorStore.getState().reset();
  useCockpitStore.getState().reset();
});

function object(id: string, slug: string, groupId: string | null): EditorObject {
  const asset = CANONICAL_ASSETS.find((item) => item.slug === slug);
  if (asset === undefined) throw new Error(`Missing fixture asset: ${slug}`);
  return {
    id, assetDefinitionId: asset.id, groupId,
    positionX: 0, positionY: 0, positionZ: 0,
    rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: 0,
    clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, notes: "",
  };
}

function furnishedHall(): EditorObject[] {
  return Array.from({ length: 18 }, (_unused, table) => {
    const group = `table-${String(table)}`;
    return [
      object(group, "round-table-6ft", group),
      ...Array.from({ length: 8 }, (_value, chair) => object(`${group}-chair-${String(chair)}`, "banquet-chair", group)),
    ];
  }).flat();
}

function guestDisplay(): string | null | undefined {
  return screen.getByLabelText("Increase guest count").parentElement?.querySelector("span")?.textContent;
}

describe("BlueprintFromStore save status", () => {
  it("tracks saved, dirty, in-flight, failed and conflicted state instead of always claiming clean", () => {
    useEditorStore.setState({ configId: "saved-layout", lastSavedAt: new Date(Date.now() - 120_000) });
    const { container } = render(<><BlueprintPage source="editor-store" /><MobilePlannerTopBar mode="2d" onModeChange={() => undefined} /></>);
    const chrome = (): string => container.querySelector(".bp-chrome")?.textContent ?? "";
    const mobile = (): string => screen.getByTestId("mobile-planner-topbar").textContent ?? "";
    expect(chrome()).toContain("Saved 2m ago");
    expect(mobile()).toContain("Layout saved");
    act(() => { useEditorStore.setState({ isDirty: true }); });
    expect(chrome()).toContain("Unsaved changes");
    expect(mobile()).toContain("Unsaved changes");
    act(() => { useEditorStore.setState({ isSaving: true }); });
    expect(chrome()).toContain("Saving…");
    expect(mobile()).toContain("Saving…");
    act(() => { useEditorStore.setState({ isSaving: false, saveError: "Failed" }); });
    expect(chrome()).toContain("Save failed - retry");
    expect(mobile()).toContain("Save failed - retry");
    act(() => { useEditorStore.setState({ saveConflict: { expectedRevision: 1, currentRevision: 2, message: "Changed elsewhere" } }); });
    expect(chrome()).toContain("Save conflict - reload");
    expect(mobile()).toContain("Reload layout");
    act(() => { useEditorStore.setState({ isDirty: false, saveError: null, saveConflict: null, lastSavedAt: null }); });
    expect(chrome()).toContain("Layout saved");
    expect(mobile()).toContain("Layout saved");
    expect(chrome()).not.toContain("Not saved");
  });
});

describe("BlueprintFromStore seating and guests", () => {
  it("reports 144 placed seats for 18 tables and 144 chairs without inventing attendance", () => {
    useEditorStore.getState().replaceObjectsFromScene(furnishedHall());
    useEditorStore.getState().selectObject("table-0");
    render(<BlueprintPage source="editor-store" />);
    expect(screen.getByText("Seats placed").parentElement?.textContent).toBe("Seats placed144");
    expect(screen.getByText("Rounds").parentElement?.textContent).toBe("Rounds18");
    expect(guestDisplay()).toBe("Not set");
    expect(screen.queryByText("1620")).toBeNull();
    expect(screen.getAllByText("10 cap.")).toHaveLength(18);
    expect(screen.getByText("18 placed")).toBeTruthy();
    expect(screen.queryByText("18 / 0 placed")).toBeNull();
  });

  it("shares guest changes with the actual 3D Guests panel and survives view remounts", () => {
    const { rerender } = render(<><BlueprintPage source="editor-store" /><GuestsLensPanel /></>);
    fireEvent.change(screen.getByLabelText("Expected guests"), { target: { value: "144" } });
    expect(guestDisplay()).toBe("144");
    fireEvent.click(screen.getByLabelText("Increase guest count"));
    expect(screen.getByLabelText<HTMLInputElement>("Expected guests").value).toBe("149");
    rerender(<GuestsLensPanel />);
    rerender(<><BlueprintPage source="editor-store" /><GuestsLensPanel /></>);
    expect(guestDisplay()).toBe("149");
    fireEvent.change(screen.getByLabelText("Expected guests"), { target: { value: "" } });
    expect(guestDisplay()).toBe("Not set");
    fireEvent.click(screen.getByLabelText("Decrease guest count"));
    expect(useCockpitStore.getState().plannedGuestCount).toBeNull();
    act(() => { useCockpitStore.getState().setPlannedGuestCount(MAX_GUEST_FLOW_AGENTS); });
    fireEvent.click(screen.getByLabelText("Increase guest count"));
    expect(useCockpitStore.getState().plannedGuestCount).toBe(MAX_GUEST_FLOW_AGENTS);
  });

  it("updates placed seats through chair undo/redo without changing the guest target", () => {
    useEditorStore.getState().replaceObjectsFromScene(furnishedHall());
    useCockpitStore.getState().setPlannedGuestCount(150);
    render(<BlueprintPage source="editor-store" />);
    const extra = object("extra-chair", "banquet-chair", null);
    act(() => { useEditorStore.getState().addObject(extra.assetDefinitionId, 0, 0, 0); });
    expect(screen.getByText("Seats placed").parentElement?.textContent).toBe("Seats placed145");
    fireEvent.click(screen.getByTitle("Undo (⌘Z)"));
    expect(screen.getByText("Seats placed").parentElement?.textContent).toBe("Seats placed144");
    fireEvent.click(screen.getByTitle("Redo (⌘⇧Z)"));
    expect(screen.getByText("Seats placed").parentElement?.textContent).toBe("Seats placed145");
    expect(guestDisplay()).toBe("150");
    expect(useCockpitStore.getState().plannedGuestCount).toBe(150);
  });

  it("does not draw invented chairs for a bare table and labels its catalogue capacity", () => {
    const table = object("bare-table", "round-table-6ft", null);
    useEditorStore.getState().replaceObjectsFromScene([table]);
    useEditorStore.getState().selectObject(table.id);
    const { container } = render(<BlueprintPage source="editor-store" />);
    expect(screen.getByText("Seats placed").parentElement?.textContent).toBe("Seats placed0");
    expect(screen.getByText("Table capacity").parentElement?.textContent).toBe("Table capacity10");
    expect(container.querySelectorAll('circle[opacity="0.9"]')).toHaveLength(0);
  });

  it("does not turn a missing catalogue capacity into a zero-capacity claim", () => {
    const table = object("trestle", "trestle-6ft", null);
    useEditorStore.getState().replaceObjectsFromScene([table]);
    useEditorStore.getState().selectObject(table.id);
    render(<BlueprintPage source="editor-store" />);
    expect(screen.queryByText(/capacity 0/i)).toBeNull();
    expect(screen.queryByText("Table capacity")).toBeNull();
    expect(screen.getByText("Seats placed").parentElement?.textContent).toBe("Seats placed0");
  });
});

describe("BlueprintFromStore undo toolbar", () => {
  it("renders the canonical mic stand with a truthful floor-equipment label", () => {
    const micStand = CANONICAL_ASSETS.find((asset) => asset.slug === "mic-stand");
    expect(micStand).toBeDefined();
    if (micStand === undefined) return;
    useEditorStore.getState().addObject(micStand.id, 0, 0, 0);

    render(<BlueprintPage source="editor-store" />);

    expect(screen.getAllByText("Mic stand").length).toBeGreaterThan(0);
    expect(screen.getByText("MIC STAND · 0.5×0.5M")).toBeTruthy();
    expect(screen.queryByText(/MIC STAND.*SEAT/i)).toBeNull();
  });

  it("disables undo and redo when the editor history is empty", () => {
    render(<BlueprintPage source="editor-store" />);

    const undo = screen.getByTitle<HTMLButtonElement>("Undo (⌘Z)");
    const redo = screen.getByTitle<HTMLButtonElement>("Redo (⌘⇧Z)");
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);
  });

  it("undoes and redoes editor-store changes from the 2D toolbar", () => {
    useEditorStore.getState().addObject("a1", 1, 0, 2);
    expect(useEditorStore.getState().objects).toHaveLength(1);

    render(<BlueprintPage source="editor-store" />);

    const undo = screen.getByTitle<HTMLButtonElement>("Undo (⌘Z)");
    expect(undo.disabled).toBe(false);

    fireEvent.click(undo);
    expect(useEditorStore.getState().objects).toHaveLength(0);

    const redo = screen.getByTitle<HTMLButtonElement>("Redo (⌘⇧Z)");
    expect(redo.disabled).toBe(false);

    fireEvent.click(redo);
    expect(useEditorStore.getState().objects).toHaveLength(1);
  });
});
