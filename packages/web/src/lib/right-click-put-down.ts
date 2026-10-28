import { DRAG_THRESHOLD_PX, screenDistance } from "./selection.js";

// ---------------------------------------------------------------------------
// A right-click puts the piece in hand down; a right-drag is the camera's
// orbit and keeps it in hand.
//
// A drag sends a contextmenu too: Windows at its release, macOS and Linux at
// its press. So the menu decides nothing for the mouse: the release does, and
// within DRAG_THRESHOLD_PX of the press it was a click. A contextmenu with no
// right press behind it (the Menu key, Shift+F10) puts the piece down, the
// keyboard's way out alongside Esc.
//
// It listens on the window's bubble phase, after the canvas's own handlers:
// the selection system's right-click viewpoint stands aside while a piece is
// in hand, so the piece must still be in hand when the canvas hears the release.
// ---------------------------------------------------------------------------

interface RightPress {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  /** Whether a piece was in hand when the button went down. */
  readonly holding: boolean;
  moved: boolean;
  released: boolean;
}

export interface RightClickPutDown {
  /** Whether a piece is in hand now. */
  readonly holding: () => boolean;
  /** Puts the piece in hand down. */
  readonly putDown: () => void;
}

/** Listens on `target` for the right button's put-down; returns the way to stop. */
export function listenForRightClickPutDown(target: Window, { holding, putDown }: RightClickPutDown): () => void {
  let press: RightPress | null = null;

  function onPointerDown(event: PointerEvent): void {
    press = event.button === 2
      ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, holding: holding(), moved: false, released: false }
      : null;
  }
  function onPointerMove(event: PointerEvent): void {
    if (press === null || press.released || event.pointerId !== press.pointerId) return;
    if (screenDistance(press.x, press.y, event.clientX, event.clientY) > DRAG_THRESHOLD_PX) press.moved = true;
  }
  function onPointerUp(event: PointerEvent): void {
    if (event.button !== 2 || press === null || press.released || event.pointerId !== press.pointerId) return;
    press.released = true;
    const click = !press.moved && screenDistance(press.x, press.y, event.clientX, event.clientY) <= DRAG_THRESHOLD_PX;
    if (click && holding()) putDown();
  }
  function onPointerCancel(event: PointerEvent): void {
    if (press !== null && event.pointerId === press.pointerId) press = null;
  }
  function onKeyDown(): void {
    // A key after the release makes the next menu the keyboard's.
    if (press?.released === true) press = null;
  }
  function onContextMenu(event: MouseEvent): void {
    if (press !== null) {
      // The mouse's own menu: the release decides, or has decided.
      if (press.holding) event.preventDefault();
      if (press.released) press = null;
      return;
    }
    if (!holding()) return;
    event.preventDefault();
    putDown();
  }

  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointercancel", onPointerCancel);
  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("contextmenu", onContextMenu);
  return () => {
    target.removeEventListener("pointerdown", onPointerDown);
    target.removeEventListener("pointermove", onPointerMove);
    target.removeEventListener("pointerup", onPointerUp);
    target.removeEventListener("pointercancel", onPointerCancel);
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("contextmenu", onContextMenu);
  };
}
