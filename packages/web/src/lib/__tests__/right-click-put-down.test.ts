import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listenForRightClickPutDown } from "../right-click-put-down.js";

// ---------------------------------------------------------------------------
// A right-click puts the piece in hand down; a right-drag, the camera's orbit,
// keeps it in hand, whichever order the drag's contextmenu comes in (Windows
// after the release, macOS and Linux at the press). The keyboard's menu (the
// Menu key, Shift+F10) puts it down, alongside Esc.
// ---------------------------------------------------------------------------

let held = true;
const putDown = vi.fn(() => { held = false; });
let stop: () => void = () => undefined;

beforeEach(() => {
  held = true;
  putDown.mockClear();
  stop = listenForRightClickPutDown(window, { holding: () => held, putDown });
});

afterEach(() => {
  stop();
});

function pointer(type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number): void {
  const button = type === "pointermove" ? -1 : 2;
  window.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button, buttons: type === "pointerup" ? 0 : 2, clientX: x, clientY: y }));
}

/** A contextmenu: whether the browser's own menu was kept away. */
function menu(): boolean {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function menuKey(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ContextMenu", code: "ContextMenu" }));
}

describe("a right-click puts the piece in hand down", () => {
  it("at the release, with its menu after it kept away (Windows)", () => {
    pointer("pointerdown", 100, 100);
    pointer("pointerup", 101, 101);
    expect(putDown).toHaveBeenCalledTimes(1);
    expect(menu()).toBe(true);
    expect(putDown).toHaveBeenCalledTimes(1);
  });

  it("at the release, with its menu at the press kept away (macOS and Linux)", () => {
    pointer("pointerdown", 100, 100);
    expect(menu()).toBe(true);
    expect(putDown).not.toHaveBeenCalled();
    pointer("pointerup", 100, 100);
    expect(putDown).toHaveBeenCalledTimes(1);
  });

  it("when the press strays no further than the drag threshold", () => {
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 103, 103);
    pointer("pointerup", 104, 102);
    expect(putDown).toHaveBeenCalledTimes(1);
  });
});

describe("a right-drag orbits and keeps the piece in hand", () => {
  it("with its menu after the release (Windows)", () => {
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 140, 104);
    pointer("pointerup", 240, 110);
    expect(menu()).toBe(true);
    expect(putDown).not.toHaveBeenCalled();
    expect(held).toBe(true);
  });

  it("with its menu at the press (macOS and Linux)", () => {
    pointer("pointerdown", 100, 100);
    expect(menu()).toBe(true);
    pointer("pointermove", 140, 104);
    pointer("pointerup", 240, 110);
    expect(putDown).not.toHaveBeenCalled();
  });

  it("even when it ends where it began", () => {
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 160, 100);
    pointer("pointerup", 100, 100);
    expect(menu()).toBe(true);
    expect(putDown).not.toHaveBeenCalled();
  });
});

describe("the keyboard's menu puts the piece down", () => {
  it("with no right press behind it (the Menu key, Shift+F10)", () => {
    menuKey();
    expect(menu()).toBe(true);
    expect(putDown).toHaveBeenCalledTimes(1);
  });

  it("right after a right-drag whose menu came at the press", () => {
    pointer("pointerdown", 100, 100);
    menu();
    pointer("pointermove", 160, 100);
    pointer("pointerup", 200, 100);
    menuKey();
    expect(menu()).toBe(true);
    expect(putDown).toHaveBeenCalledTimes(1);
  });
});

describe("with nothing in hand", () => {
  it("puts nothing down and leaves the browser's menu alone", () => {
    held = false;
    pointer("pointerdown", 100, 100);
    pointer("pointerup", 100, 100);
    expect(menu()).toBe(false);
    menuKey();
    expect(menu()).toBe(false);
    expect(putDown).not.toHaveBeenCalled();
  });
});

describe("stopping", () => {
  it("hears nothing once stopped", () => {
    stop();
    pointer("pointerdown", 100, 100);
    pointer("pointerup", 100, 100);
    expect(menu()).toBe(false);
    expect(putDown).not.toHaveBeenCalled();
  });
});
