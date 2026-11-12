import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../../../stores/editor-store.js";
import { PlannerLeavingNotes } from "../PlannerLeavingNotes.js";

// ---------------------------------------------------------------------------
// Today's chrome says what came back from this device (QoL D-01) and what
// stayed behind in another layout (D-X3), in the new chrome's words. The
// save-error toast owns the spot while a save has failed or a conflict waits.
// ---------------------------------------------------------------------------

beforeEach(() => {
  useEditorStore.setState({
    configId: "cfg-1",
    isDirty: true,
    isSaving: false,
    isOnline: true,
    keptOnDevice: true,
    saveError: null,
    saveConflict: null,
    lastSavedAt: null,
    restoredFromDevice: { changes: 3, editedAt: new Date() },
    leftBehind: null,
  });
});

afterEach(() => {
  cleanup();
  useEditorStore.getState().reset();
  useEditorStore.setState({ leftBehind: null });
});

describe("the v1 planner's notes about work that outlived its page", () => {
  it("gives the restore receipt with the house indicator while it saves, then the time it saved", () => {
    const { container, rerender } = render(<PlannerLeavingNotes />);
    expect(screen.getByRole("status").textContent).toMatch(/^Restored 3 changes you made at \d\d:\d\d on this device · Saving$/u);
    expect(container.querySelector("[data-activity-indicator]")).not.toBeNull();

    useEditorStore.setState({ isDirty: false, lastSavedAt: new Date("2026-10-27T21:42:00Z") });
    rerender(<PlannerLeavingNotes />);
    expect(screen.getByRole("status").textContent).toContain("· Saved 21:42");
    expect(container.querySelector("[data-activity-indicator]")).toBeNull();
  });

  it("says what stayed behind, and goes when dismissed", () => {
    useEditorStore.setState({
      restoredFromDevice: null,
      leftBehind: { configId: "cfg-0", roomName: "Grand Hall", kept: true, savesOnReturn: true },
    });
    render(<PlannerLeavingNotes />);
    expect(screen.getByRole("status").textContent).toBe("Your changes to the Grand Hall layout are kept on this device and save when you open it again.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(useEditorStore.getState().leftBehind).toBeNull();
  });

  it("leaves the spot to the save-error toast", () => {
    useEditorStore.setState({ saveError: "Server error" });
    render(<PlannerLeavingNotes />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
