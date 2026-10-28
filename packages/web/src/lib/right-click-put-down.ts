import { DRAG_THRESHOLD_PX, screenDistance } from "./selection.js";

// ---------------------------------------------------------------------------
// A right-click puts the piece in hand down; a right-drag is the camera's
// orbit and keeps it in hand.
//
// A drag sends a contextmenu too: Windows at its release, macOS and Linux at
// its press. So the menu decides nothing for the mouse: the release does, and
// within DRAG_THRESHOLD_PX of the press it was a click. A contextmenu with no
// right press behind it, or long after the last release (the Menu key,
// Shift+F10), puts the piece down, the keyboard's way out alongside Esc.
//
// It listens on the window's bubble phase, after the canvas's own handlers:
// the selection system's right-click viewpoint stands aside while a piece is
// in hand, so the piece must still be in hand when the canvas hears the release.
// ---------------------------------------------------------------------------

/**
 * How long after a right release a contextmenu is still that release's own.
 * Windows sends it straight after the release; one later than this, with no
 * press since, is the keyboard's. (The planner has one keyboard owner,
 * lib/planner-keys.ts, so this listens for no keys itself.)
 */
export const RIGHT_RELEASE_MENU_MS = 250;

interface RightPress {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  /** Whether a piece was in hand when the button went down. */
  readonly holding: boolean;
  moved: boolean;
  /** When the button came up, on `now`'s clock; null while it is down. */
  releasedAt: number | null;
}

export interface RightClickPutDown {
  /** Whether a piece is in hand now. */
  readonly holding: () => boolean;
  /** Puts the piece in hand down. */
  readonly putDown: () => void;
  /** The clock, milliseconds; performance.now() unless a test steps it. */
  readonly now?: () => number;
}

/** Listens on `target` for the right button's put-down; returns the way to stop. */
export function listenForRightClickPutDown(
  target: Window,
  { holding, putDown, now = () => performance.now() }: RightClickPutDown,
): () => void {
  let press: RightPress | null = null;

  function onPointerDown(event: PointerEvent): void {
    press = event.button === 2
      ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, holding: holding(), moved: false, releasedAt: null }
      : null;
  }
  function onPointerMove(event: PointerEvent): void {
    if (press === null || press.releasedAt !== null || event.pointerId !== press.pointerId) return;
    if (screenDistance(press.x, press.y, event.clientX, event.clientY) > DRAG_THRESHOLD_PX) press.moved = true;
  }
  function onPointerUp(event: PointerEvent): void {
    if (event.button !== 2 || press === null || press.releasedAt !== null || event.pointerId !== press.pointerId) return;
    press.releasedAt = now();
    const click = !press.moved && screenDistance(press.x, press.y, event.clientX, event.clientY) <= DRAG_THRESHOLD_PX;
    if (click && holding()) putDown();
  }
  function onPointerCancel(event: PointerEvent): void {
    if (press !== null && event.pointerId === press.pointerId) press = null;
  }
  function onContextMenu(event: MouseEvent): void {
    // A release long gone leaves the menu to the keyboard.
    if (press !== null && press.releasedAt !== null && now() - press.releasedAt > RIGHT_RELEASE_MENU_MS) press = null;
    if (press !== null) {
      // The mouse's own menu: the release decides, or has decided.
      if (press.holding) event.preventDefault();
      if (press.releasedAt !== null) press = null;
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
  target.addEventListener("contextmenu", onContextMenu);
  return () => {
    target.removeEventListener("pointerdown", onPointerDown);
    target.removeEventListener("pointermove", onPointerMove);
    target.removeEventListener("pointerup", onPointerUp);
    target.removeEventListener("pointercancel", onPointerCancel);
    target.removeEventListener("contextmenu", onContextMenu);
  };
}
