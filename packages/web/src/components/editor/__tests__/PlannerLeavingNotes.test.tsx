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

  // Delta review of #388 at 7a51b6e4, X2. A refused clear carried from the
  // layout left behind is that refusal's one lasting voice, and the note is
  // created already holding it: an alert, as the slate says it, not a polite
  // region that might never be heard.
  it("says a refused clear carried from the layout left behind as an alert, until dismissed", () => {
    const notRemoved = "Table 7's note was not removed: it was changed somewhere else, and that note cannot be shown here.";
    useEditorStore.setState({
      restoredFromDevice: null,
      leftBehind: { configId: "cfg-0", roomName: "Grand Hall", kept: null, savesOnReturn: false, notRemoved },
    });
    render(<PlannerLeavingNotes />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(notRemoved);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(useEditorStore.getState().leftBehind).toBeNull();
  });

  // Review of #388 at d917b3d0, XB1. A note and the restore receipt can stand
  // together (a layout's work lost on the switch, the next layout's restored).
  // In one alert, each change of the receipt from Saving to Saved re-read the
  // whole lost-work sentence assertively. The note is the alert; the receipt,
  // which is progress, is a polite status beside it, never inside it.
  it("says lost work as an alert and the restore receipt beside it as a status, so the receipt's progress never re-reads the note", () => {
    const lost = "Your changes to the Grand Hall layout did not reach Venviewer, and this browser could not keep them.";
    useEditorStore.setState({ leftBehind: { configId: "cfg-0", roomName: "Grand Hall", kept: false, savesOnReturn: false } });
    const { rerender } = render(<PlannerLeavingNotes />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(lost);
    expect(screen.getByRole("status").textContent).toMatch(/^Restored 3 changes you made at \d\d:\d\d on this device · Saving$/u);
    expect(alert.contains(screen.getByRole("status"))).toBe(false);

    useEditorStore.setState({ isDirty: false, lastSavedAt: new Date("2026-10-27T21:42:00Z") });
    rerender(<PlannerLeavingNotes />);
    expect(screen.getByRole("status").textContent).toContain("· Saved 21:42");
    // The alert is the same region, its words untouched.
    expect(screen.getByRole("alert")).toBe(alert);
    expect(alert.textContent).toBe(lost);
  });

  it("leaves the spot to the save-error toast", () => {
    useEditorStore.setState({ saveError: "Server error" });
    render(<PlannerLeavingNotes />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
