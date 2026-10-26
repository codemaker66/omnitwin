import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlateCard, type SlateCardProps } from "../Slate.js";
import { slateSaveState, type SlateSaveInput } from "../../../lib/editor-save-status.js";
import type { PlaneFacts } from "../../../lib/slate-facts.js";

// ---------------------------------------------------------------------------
// The slate (T-671 slice 7; spec 6.1, frames 17 and 19): what this is, whether
// it is saved in plain words, and the figures that decide on the copper plane.
// Status is always words; the dots, the tick and the colour only repeat them.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const steady: SlateSaveInput = {
  hasLayout: true, guest: false, isSaving: false, isDirty: false, pendingChanges: 0, savingChanges: null,
  isOnline: true, keptOnDevice: false, saveError: null, conflict: null, lockReason: null,
  lastSavedAt: new Date("2026-11-28T21:41:00Z"),
};

const seated: PlaneFacts = { guests: 80, seats: 80, tables: 8, format: "dinner", limit: 180, standing: "seated", short: 0 };

function props(patch: Partial<SlateCardProps> = {}): SlateCardProps {
  return {
    crest: null,
    eyebrow: "Sat 28 Nov 2026 · Grand Hall",
    title: "St Andrew's Night dinner",
    hold: "1st option",
    sample: false,
    save: slateSaveState(steady),
    plane: seated,
    menuOpen: false,
    onMenu: vi.fn(),
    onAction: vi.fn(),
    busy: null,
    ...patch,
  };
}

function slate(patch: Partial<SlateCardProps> = {}): ReturnType<typeof render> {
  return render(<SlateCard {...props(patch)} />);
}

describe("the plate", () => {
  it("names the occasion, the day and the room, with the title as the menu's key", () => {
    const onMenu = vi.fn();
    slate({ onMenu });
    const plate = screen.getByRole("region", { name: "St Andrew's Night dinner" });
    expect(within(plate).getByText("Sat 28 Nov 2026 · Grand Hall")).toBeTruthy();
    const title = within(plate).getByRole("button", { name: "St Andrew's Night dinner" });
    expect(title.getAttribute("aria-haspopup")).toBe("dialog");
    expect(title.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(title);
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it("carries the hold, the save state and Sample as words on one line", () => {
    slate({ sample: true });
    const line = screen.getByTestId("slate-line");
    expect(line.textContent).toContain("1st option");
    expect(line.textContent).toContain("Saved");
    expect(line.textContent).toContain("Sample");
    expect(within(line).getByText("Saved").closest("[title]")?.getAttribute("title")).toBe("Saved 21:41");
  });

  it("shows no hold chip where there is no hold", () => {
    slate({ hold: null });
    expect(screen.getByTestId("slate-line").textContent).not.toContain("option");
  });
});

describe("the save line", () => {
  it("works with the house indicator while saving, and counts the changes", () => {
    const { container } = slate({ save: slateSaveState({ ...steady, isSaving: true, savingChanges: 2 }) });
    expect(screen.getByTestId("slate-line").textContent).toContain("Saving");
    expect(screen.getByTestId("slate-line").textContent).toContain("2 changes");
    expect(container.querySelector("[data-activity-indicator]")).not.toBeNull();
  });

  it("says what failed, what is safe, and offers Try again", () => {
    const onAction = vi.fn();
    slate({ onAction, save: slateSaveState({ ...steady, isDirty: true, pendingChanges: 2, keptOnDevice: true, saveError: "x" }) });
    const notice = screen.getByRole("alert");
    expect(notice.textContent).toContain("The last save did not reach Venviewer.");
    expect(notice.textContent).toContain("Your changes are kept on this device.");
    fireEvent.click(within(notice).getByRole("button", { name: "Try again" }));
    expect(onAction).toHaveBeenCalledWith("try-again");
  });

  it("puts the offline notice quietly, and keeps the room working", () => {
    slate({ save: slateSaveState({ ...steady, isOnline: false, isDirty: true, pendingChanges: 3, keptOnDevice: true }) });
    const notice = screen.getByText("The connection to Venviewer has dropped.").closest("[role]");
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.textContent).toContain("sending waits until then");
    expect(screen.getByTestId("slate-line").textContent).toContain("3 changes kept on this device");
  });

  it("offers both versions when the layout changed elsewhere, and shows the one in flight", () => {
    const onAction = vi.fn();
    const save = slateSaveState({
      ...steady, saveError: "x",
      conflict: { changedByName: "Elaine", byYou: false, changedAt: new Date("2026-11-28T21:58:00Z"), theirChange: null },
    });
    const { rerender } = slate({ onAction, save });
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(onAction).toHaveBeenCalledWith("keep-mine");
    fireEvent.click(screen.getByRole("button", { name: "Show Elaine's version" }));
    expect(onAction).toHaveBeenCalledWith("show-theirs");
    rerender(<SlateCard {...props({ onAction, save, busy: "keep-mine" })} />);
    const keeping = screen.getByRole("button", { name: "Keep mine" });
    expect(keeping.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(keeping);
    expect(onAction).toHaveBeenCalledTimes(2);
    // The other way waits, and says why.
    const other = screen.getByRole("button", { name: "Show Elaine's version: Keeping your version" });
    expect(other.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(other);
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("offers a guest the way to keep the draft", () => {
    const onAction = vi.fn();
    slate({ onAction, hold: null, save: slateSaveState({ ...steady, guest: true, isDirty: true, keptOnDevice: true }) });
    fireEvent.click(screen.getByRole("button", { name: "Sign in to keep it" }));
    expect(onAction).toHaveBeenCalledWith("sign-in");
  });

  it("never offers to Save layout", () => {
    const states: SlateSaveInput[] = [steady, { ...steady, isDirty: true }, { ...steady, saveError: "x" }, { ...steady, isOnline: false }, { ...steady, guest: true }];
    for (const input of states) {
      const { container, unmount } = slate({ save: slateSaveState(input) });
      expect(container.textContent).not.toMatch(/save layout/iu);
      unmount();
    }
  });
});

describe("the plane", () => {
  it("carries guests, seats against the room's limit, and tables", () => {
    slate();
    const plane = screen.getByRole("group", { name: "The figures" });
    expect(plane.textContent).toContain("80");
    expect(plane.textContent).toContain("guests");
    expect(plane.textContent).toContain("of 180");
    expect(plane.textContent).toContain("tables");
    // The tick is a word too.
    expect(within(plane).getByText("every guest seated")).toBeTruthy();
  });

  it("says how many are short, and over, in words", () => {
    const { unmount } = slate({ plane: { ...seated, seats: 70, tables: 7, standing: "short", short: 10 } });
    expect(screen.getByRole("group", { name: "The figures" }).textContent).toContain("10 short");
    unmount();
    slate({ plane: { ...seated, seats: 190, standing: "over" } });
    const plane = screen.getByRole("group", { name: "The figures" });
    expect(plane.textContent).toContain("over");
    expect(plane.querySelector("[data-standing='over']")).not.toBeNull();
  });

  it("names an unpublished room's seats without a limit, and a layout with no guests yet", () => {
    slate({ plane: { guests: null, seats: 24, tables: 3, format: "dinner", limit: null, standing: "no-guests", short: 0 } });
    const plane = screen.getByRole("group", { name: "The figures" });
    expect(plane.textContent).not.toContain("of ");
    expect(plane.textContent).toContain("no guests yet");
  });

  it("is left out where the slate drops it (Walk)", () => {
    slate({ plane: null });
    expect(screen.queryByRole("group", { name: "The figures" })).toBeNull();
  });
});
