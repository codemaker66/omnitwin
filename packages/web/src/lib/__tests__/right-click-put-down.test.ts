import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RIGHT_RELEASE_MENU_MS, listenForRightClickPutDown } from "../right-click-put-down.js";

// ---------------------------------------------------------------------------
// A right-click puts the piece in hand down; a right-drag, the camera's orbit
// or Human POV's look, keeps it in hand, whichever order the drag's
// contextmenu comes in (Windows after the release, macOS and Linux at the
// press). The keyboard's menu (the Menu key, Shift+F10) puts it down.
// ---------------------------------------------------------------------------

let held = true;
let clock = 0;
const later: (() => void)[] = [];
const putDown = vi.fn(() => { held = false; });
let stop: () => void = () => undefined;
let canvas: HTMLCanvasElement;

beforeEach(() => {
  held = true;
  clock = 0;
  later.length = 0;
  putDown.mockClear();
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  stop = listenForRightClickPutDown(window, { holding: () => held, putDown, now: () => clock, defer: (task) => { later.push(task); } });
});

afterEach(() => {
  stop();
  canvas.remove();
});

/** Runs what waits for the next task: a click's put-down. */
function nextTask(): void {
  for (const task of later.splice(0)) task();
}

function pointer(type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number, on: EventTarget = canvas): void {
  const button = type === "pointermove" ? -1 : 2;
  on.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button, buttons: type === "pointerup" ? 0 : 2, clientX: x, clientY: y }));
}

/** A contextmenu: whether the browser's own menu was kept away. */
function menu(on: EventTarget = canvas): boolean {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
  on.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("a right-click puts the piece in hand down", () => {
  it("after the release, with its menu after it kept away (Windows)", () => {
    pointer("pointerdown", 100, 100);
    pointer("pointerup", 101, 101);
    expect(menu()).toBe(true);
    nextTask();
    expect(putDown).toHaveBeenCalledTimes(1);
  });

  it("after the release, with its menu at the press kept away (macOS and Linux)", () => {
    pointer("pointerdown", 100, 100);
    expect(menu()).toBe(true);
    pointer("pointerup", 100, 100);
    nextTask();
    expect(putDown).toHaveBeenCalledTimes(1);
  });

  it("only once the canvas has heard the release, with the piece still in hand", () => {
    let heldWhenCanvasHeard: boolean | null = null;
    canvas.addEventListener("pointerup", () => { heldWhenCanvasHeard = held; });
    pointer("pointerdown", 100, 100);
    pointer("pointerup", 100, 100);
    expect(heldWhenCanvasHeard).toBe(true);
    expect(putDown).not.toHaveBeenCalled();
    nextTask();
    expect(putDown).toHaveBeenCalledTimes(1);
  });

  it("when the press strays no further than the drag threshold", () => {
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 103, 103);
    pointer("pointerup", 104, 102);
    nextTask();
    expect(putDown).toHaveBeenCalledTimes(1);
  });
});

describe("a right-drag keeps the piece in hand", () => {
  it("with its menu after the release (Windows)", () => {
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 140, 104);
    pointer("pointerup", 240, 110);
    expect(menu()).toBe(true);
    nextTask();
    expect(putDown).not.toHaveBeenCalled();
    expect(held).toBe(true);
  });

  it("with its menu at the press (macOS and Linux)", () => {
    pointer("pointerdown", 100, 100);
    expect(menu()).toBe(true);
    pointer("pointermove", 140, 104);
    pointer("pointerup", 240, 110);
    nextTask();
    expect(putDown).not.toHaveBeenCalled();
  });

  it("even when it ends where it began", () => {
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 160, 100);
    pointer("pointerup", 100, 100);
    expect(menu()).toBe(true);
    nextTask();
    expect(putDown).not.toHaveBeenCalled();
  });

  it("in Human POV, whose look-drag the canvas keeps from propagating", () => {
    for (const type of ["pointerdown", "pointermove", "pointerup"] as const) {
      canvas.addEventListener(type, (event) => { event.stopPropagation(); });
    }
    pointer("pointerdown", 100, 100);
    expect(menu()).toBe(true);
    pointer("pointermove", 180, 100);
    pointer("pointerup", 220, 100);
    expect(menu()).toBe(true);
    nextTask();
    expect(putDown).not.toHaveBeenCalled();
    // A plain right-click there still puts it down.
    pointer("pointerdown", 100, 100);
    pointer("pointerup", 100, 100);
    nextTask();
    expect(putDown).toHaveBeenCalledTimes(1);
  });
});

describe("the keyboard's menu puts the piece down", () => {
  it("with no right press behind it (the Menu key, Shift+F10)", () => {
    expect(menu(window)).toBe(true);
    expect(putDown).toHaveBeenCalledTimes(1);
  });

  it("after a right-drag whose menu came at the press, once the release is long gone", () => {
    pointer("pointerdown", 100, 100);
    menu();
    pointer("pointermove", 160, 100);
    pointer("pointerup", 200, 100);
    clock += RIGHT_RELEASE_MENU_MS + 1;
    expect(menu(window)).toBe(true);
    expect(putDown).toHaveBeenCalledTimes(1);
  });

  it("but a menu straight after a drag's release is the drag's own (Windows)", () => {
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 160, 100);
    pointer("pointerup", 200, 100);
    clock += 8;
    expect(menu()).toBe(true);
    expect(putDown).not.toHaveBeenCalled();
  });

  it("after a press whose release went outside the window (blur forgets it)", () => {
    pointer("pointerdown", 100, 100);
    window.dispatchEvent(new Event("blur"));
    expect(menu(window)).toBe(true);
    expect(putDown).toHaveBeenCalledTimes(1);
  });
});

describe("with nothing in hand", () => {
  it("puts nothing down and leaves the browser's menu alone", () => {
    held = false;
    pointer("pointerdown", 100, 100);
    pointer("pointerup", 100, 100);
    expect(menu()).toBe(false);
    nextTask();
    clock += 1_000;
    expect(menu(window)).toBe(false);
    expect(putDown).not.toHaveBeenCalled();
  });
});

describe("stopping", () => {
  it("hears nothing once stopped, and a click waiting on its task puts nothing down", () => {
    pointer("pointerdown", 100, 100);
    pointer("pointerup", 100, 100);
    stop();
    nextTask();
    pointer("pointerdown", 100, 100);
    pointer("pointerup", 100, 100);
    nextTask();
    expect(menu()).toBe(false);
    expect(putDown).not.toHaveBeenCalled();
  });
});
