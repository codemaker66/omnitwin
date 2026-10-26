import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ESCAPE_ORDER,
  hasPlannerKeyListener,
  lastInputWasKeys,
  registerEscapeLayer,
  registerKeyBindings,
  type EscapeLayerKind,
} from "../planner-keys.js";
import { setLayoutTimelineMutationLock } from "../layout-timeline-preview-lock.js";

// ---------------------------------------------------------------------------
// The planner's one keyboard owner (T-671, slice 5; spec 4.5 and 11).
//
// Every press is a real KeyboardEvent dispatched on the window or on a
// focused element, so the owner is tested as the browser drives it: one
// listener, exactly one thing done per key, Escape stepping back one layer.
// ---------------------------------------------------------------------------

const cleanups: (() => void)[] = [];

function track(cleanup: () => void): void {
  cleanups.push(cleanup);
}

function press(key: string, init: KeyboardEventInit & { readonly target?: EventTarget } = {}): KeyboardEvent {
  const { target, ...rest } = init;
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...rest });
  (target ?? window).dispatchEvent(event);
  return event;
}

function release(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keyup", { code, key: code, bubbles: true }));
}

function layer(kind: EscapeLayerKind, open: () => boolean, onEscape: () => void, returnFocusTo?: () => HTMLElement | null): void {
  track(registerEscapeLayer({ kind, isOpen: open, escape: onEscape, returnFocusTo }));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  setLayoutTimelineMutationLock(false);
});

describe("the Escape order", () => {
  it("runs placing, popover, panel and selection in that order, one layer per press", () => {
    const steps: string[] = [];
    const open = new Set(["operation", "popover", "panel", "selection"]);
    // Registered in the reverse order, so the order is the kind's, not the registration's.
    for (const kind of ["selection", "panel", "popover", "operation"] as const) {
      layer(kind, () => open.has(kind), () => { steps.push(kind); open.delete(kind); });
    }

    for (let i = 0; i < 5; i += 1) press("Escape");

    expect(steps).toEqual(["operation", "popover", "panel", "selection"]);
  });

  it("puts a dialog that holds the keyboard above everything but a tooltip on screen", () => {
    expect(ESCAPE_ORDER.slice(0, 2)).toEqual(["tooltip", "modal"]);
    const steps: string[] = [];
    layer("operation", () => true, () => { steps.push("operation"); });
    layer("modal", () => true, () => { steps.push("modal"); });
    layer("tooltip", () => steps.length === 0, () => { steps.push("tooltip"); });
    press("Escape");
    press("Escape");
    expect(steps).toEqual(["tooltip", "modal"]);
  });

  it("skips layers with nothing open and claims the key only when something stepped back", () => {
    const onEscape = vi.fn();
    layer("selection", () => false, onEscape);
    const event = press("Escape");
    expect(onEscape).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    layer("panel", () => true, () => undefined);
    expect(press("Escape").defaultPrevented).toBe(true);
  });

  it("prefers the most recently opened layer of the same kind", () => {
    const steps: string[] = [];
    layer("panel", () => true, () => { steps.push("first"); });
    layer("panel", () => true, () => { steps.push("second"); });
    press("Escape");
    expect(steps).toEqual(["second"]);
  });

  it("returns focus to the key that opened a panel", () => {
    const trigger = document.createElement("button");
    const field = document.createElement("input");
    document.body.append(trigger, field);
    field.focus();
    layer("panel", () => true, () => { field.remove(); }, () => trigger);

    press("Escape", { target: field });

    expect(document.activeElement).toBe(trigger);
  });

  it("knows Escape by its code alone, as some keyboards and synthetic events send it", () => {
    const onEscape = vi.fn();
    layer("selection", () => true, onEscape);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true }));
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("does not step back on a held Escape's repeats, or while composing text", () => {
    const onEscape = vi.fn();
    layer("selection", () => true, onEscape);
    press("Escape", { repeat: true });
    press("Escape", { isComposing: true });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("leaves Escape to an open native dialog, which closes on it by itself", () => {
    const onEscape = vi.fn();
    layer("operation", () => true, onEscape);
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    const button = document.createElement("button");
    dialog.append(button);
    document.body.append(dialog);
    const event = press("Escape", { target: button });
    expect(onEscape).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves a press something else already claimed", () => {
    const onEscape = vi.fn();
    layer("selection", () => true, onEscape);
    const field = document.createElement("input");
    document.body.append(field);
    field.addEventListener("keydown", (event) => { event.preventDefault(); });
    press("Escape", { target: field });
    expect(onEscape).not.toHaveBeenCalled();
  });
});

describe("the keymap", () => {
  it("matches modifiers exactly: M is not Shift M, and Ctrl and Cmd are one", () => {
    const measure = vi.fn();
    const sound = vi.fn();
    const undo = vi.fn();
    track(registerKeyBindings([
      { keys: [{ code: "KeyM" }], run: measure },
      { keys: [{ code: "KeyM", shift: true }], run: sound },
      { keys: [{ code: "KeyZ", mod: true }], run: undo },
    ]));

    press("M", { code: "KeyM", shiftKey: true });
    expect(sound).toHaveBeenCalledTimes(1);
    expect(measure).not.toHaveBeenCalled();

    press("m", { code: "KeyM" });
    expect(measure).toHaveBeenCalledTimes(1);

    press("m", { code: "KeyM", ctrlKey: true });
    press("m", { code: "KeyM", altKey: true });
    expect(measure).toHaveBeenCalledTimes(1);

    press("z", { code: "KeyZ", metaKey: true });
    press("z", { code: "KeyZ", ctrlKey: true });
    press("z", { code: "KeyZ" });
    expect(undo).toHaveBeenCalledTimes(2);
  });

  it("does one thing per key: the higher priority wins, and a binding may decline", () => {
    const steps: string[] = [];
    let placing = true;
    track(registerKeyBindings([
      { keys: [{ code: "KeyQ" }], run: () => { steps.push("selection"); }, priority: 10 },
      { keys: [{ code: "KeyQ" }], run: () => { steps.push("placing"); }, priority: 20, when: () => placing },
    ]));
    press("q", { code: "KeyQ" });
    placing = false;
    press("q", { code: "KeyQ" });
    expect(steps).toEqual(["placing", "selection"]);

    const declined = vi.fn((): false => false);
    const next = vi.fn();
    track(registerKeyBindings([
      { keys: [{ code: "KeyC" }], run: next, priority: 1 },
      { keys: [{ code: "KeyC" }], run: declined, priority: 2 },
    ]));
    press("c", { code: "KeyC" });
    expect(declined).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("leaves letters to text fields, arrows to sliders, and Space and Enter to buttons", () => {
    const letter = vi.fn();
    const arrow = vi.fn();
    const space = vi.fn();
    track(registerKeyBindings([
      { keys: [{ code: "KeyD" }], run: letter },
      { keys: [{ code: "ArrowUp", shift: "any", alt: "any" }], run: arrow, repeat: true },
      { keys: [{ code: "Space" }], run: space },
    ]));
    const text = document.createElement("input");
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    slider.tabIndex = 0;
    const range = document.createElement("input");
    range.type = "range";
    const button = document.createElement("button");
    document.body.append(text, slider, range, button);

    press("d", { code: "KeyD", target: text });
    press("ArrowUp", { code: "ArrowUp", target: slider });
    press("ArrowUp", { code: "ArrowUp", target: range });
    press(" ", { code: "Space", target: button });
    expect(letter).not.toHaveBeenCalled();
    expect(arrow).not.toHaveBeenCalled();
    expect(space).not.toHaveBeenCalled();

    // A button keeps no claim on letters or arrows: after a click on the dock
    // the room still answers them (F-21).
    press("d", { code: "KeyD", target: button });
    press("ArrowUp", { code: "ArrowUp", target: button });
    expect(letter).toHaveBeenCalledTimes(1);
    expect(arrow).toHaveBeenCalledTimes(1);
  });

  it("gives the arrows back to the room after a toolbar key is pressed with the pointer, not after Tab", () => {
    const arrow = vi.fn();
    track(registerKeyBindings([{ keys: [{ code: "ArrowLeft" }], run: arrow }]));
    const toolbar = document.createElement("div");
    toolbar.setAttribute("role", "toolbar");
    const key = document.createElement("button");
    const icon = document.createElement("span");
    key.append(icon);
    toolbar.append(key);
    document.body.append(toolbar);

    press("ArrowLeft", { code: "ArrowLeft", target: key });
    expect(arrow).not.toHaveBeenCalled();

    icon.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    press("ArrowLeft", { code: "ArrowLeft", target: key });
    expect(arrow).toHaveBeenCalledTimes(1);

    press("Tab", { code: "Tab" });
    press("ArrowLeft", { code: "ArrowLeft", target: key });
    expect(arrow).toHaveBeenCalledTimes(1);
  });

  it("ignores a held key's repeats unless the binding asks for them", () => {
    const toggle = vi.fn();
    const nudge = vi.fn();
    track(registerKeyBindings([
      { keys: [{ code: "KeyX" }], run: toggle },
      { keys: [{ code: "ArrowLeft" }], run: nudge, repeat: true },
    ]));
    press("x", { code: "KeyX", repeat: true });
    press("ArrowLeft", { code: "ArrowLeft", repeat: true });
    expect(toggle).not.toHaveBeenCalled();
    expect(nudge).toHaveBeenCalledTimes(1);
  });

  it("stands aside while a dialog holds the keyboard, except for the dialog's own keys", () => {
    const shortcut = vi.fn();
    const dialogKey = vi.fn();
    track(registerKeyBindings([
      { keys: [{ code: "KeyG" }], run: shortcut },
      { keys: [{ code: "Enter" }], run: dialogKey, duringModal: true },
    ]));
    layer("modal", () => true, () => undefined);
    press("g", { code: "KeyG" });
    press("Enter", { code: "Enter" });
    expect(shortcut).not.toHaveBeenCalled();
    expect(dialogKey).toHaveBeenCalledTimes(1);
  });

  it("swallows a change to the layout while an act's layout is previewed", () => {
    const remove = vi.fn();
    track(registerKeyBindings([{ keys: [{ code: "Delete" }], run: remove, mutates: true }]));
    setLayoutTimelineMutationLock(true);
    const event = press("Delete", { code: "Delete" });
    expect(remove).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("matches symbols by the character, whatever Shift it took to type", () => {
    const more = vi.fn();
    track(registerKeyBindings([{ keys: [{ key: "+" }, { key: "=" }], run: more }]));
    press("+", { code: "Equal", shiftKey: true });
    press("=", { code: "Equal" });
    expect(more).toHaveBeenCalledTimes(2);
  });

  it("lets held keys go on keyup and when the window loses focus", () => {
    const held = new Set<string>();
    track(registerKeyBindings([{
      keys: [{ code: "ArrowLeft" }, { code: "ArrowRight" }, { key: "w" }, { key: "W" }],
      run: (event) => { held.add(event.code === "" ? event.key.toLowerCase() : event.code); },
      release: (event) => {
        if (event === null) held.clear();
        else held.delete(event.code === "" ? event.key.toLowerCase() : event.code);
      },
      repeat: true,
    }]));
    press("ArrowLeft", { code: "ArrowLeft" });
    press("ArrowRight", { code: "ArrowRight" });
    press("W", { shiftKey: true });
    release("ArrowLeft");
    // Shift let go before the key: the keyup reads "w", and still lets go of it.
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "w", bubbles: true }));
    expect([...held]).toEqual(["ArrowRight"]);
    window.dispatchEvent(new Event("blur"));
    expect(held.size).toBe(0);
  });

  it("knows whether the last input was a key or the pointer, so motion can answer keys at once", () => {
    track(registerKeyBindings([{ keys: [{ code: "KeyX" }], run: () => undefined }]));
    expect(lastInputWasKeys()).toBe(false);
    press("x", { code: "KeyX" });
    expect(lastInputWasKeys()).toBe(true);
    window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(lastInputWasKeys()).toBe(false);
    // A key another widget claimed is still a key press.
    const claimed = new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", bubbles: true, cancelable: true });
    claimed.preventDefault();
    window.dispatchEvent(claimed);
    expect(lastInputWasKeys()).toBe(true);
  });

  it("listens only while something is registered", () => {
    expect(hasPlannerKeyListener()).toBe(false);
    const stop = registerKeyBindings([{ keys: [{ code: "KeyX" }], run: () => undefined }]);
    expect(hasPlannerKeyListener()).toBe(true);
    stop();
    expect(hasPlannerKeyListener()).toBe(false);
  });
});
