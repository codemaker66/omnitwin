import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlueprintPage } from "../pages/BlueprintPage.js";

// ---------------------------------------------------------------------------
// The /blueprint demo's keys go through the planner's one keyboard owner
// (T-671 slice 5): one Escape steps back one layer, the shortcuts sheet first
// and the selection after it, and a form control keeps its own keys.
// ---------------------------------------------------------------------------

function press(key: string, init: KeyboardEventInit & { readonly target?: EventTarget } = {}): KeyboardEvent {
  const { target, ...rest } = init;
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...rest });
  act(() => { (target ?? window).dispatchEvent(event); });
  return event;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("the blueprint demo's keys", () => {
  it("closes the shortcuts sheet on the first Escape and deselects on the second", () => {
    render(<BlueprintPage />);
    expect(screen.getByRole("button", { name: "Lock item" })).toBeDefined();

    press("?", { code: "Slash", shiftKey: true });
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeDefined();

    press("Escape", { code: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
    expect(screen.getByRole("button", { name: "Lock item" })).toBeDefined();

    press("Escape", { code: "Escape" });
    expect(screen.queryByRole("button", { name: "Lock item" })).toBeNull();
  });

  it("toggles the shortcuts sheet with ? while it is open, and leaves keys typed in a field alone", () => {
    render(<BlueprintPage />);
    press("?", { code: "Slash", shiftKey: true });
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeDefined();
    press("?", { code: "Slash", shiftKey: true });
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();

    const field = document.createElement("input");
    field.type = "checkbox";
    document.body.append(field);
    field.focus();
    const typed = press("?", { code: "Slash", shiftKey: true, target: field });
    expect(typed.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
    press("Escape", { code: "Escape", target: field });
    expect(screen.getByRole("button", { name: "Lock item" })).toBeDefined();
    field.remove();
  });
});
