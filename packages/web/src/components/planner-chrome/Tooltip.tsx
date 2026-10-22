import { useCallback, useEffect, useId, useLayoutEffect, useRef, type FocusEvent, type PointerEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { useEscapeLayer } from "../../lib/planner-keys.js";
import { Kbd } from "./Kbd.js";
import "./chrome.css";

// ---------------------------------------------------------------------------
// Tooltip — names a control and its keys (spec 7.4, 4.2), placed where it
// covers nothing.
//
// One tooltip shows at a time, from one host. The first waits 400 ms under a
// resting mouse; a neighbour shown within 300 ms of the last one hiding
// appears at once, so running the pointer along the dock reads like a
// caption. Keyboard focus shows it at once. It stays while the pointer moves
// onto it and goes on Escape (WCAG 1.4.13), and it never shows for touch: on a
// phone the words are on the controls. The tooltip repeats what the control's
// accessible name already says, so it is hidden from assistive technology.
// ---------------------------------------------------------------------------

export type TooltipSide = "above" | "below";

export const TOOLTIP_FIRST_DELAY_MS = 400;
export const TOOLTIP_NEIGHBOUR_WINDOW_MS = 300;
/** The pause before a tooltip leaves, so the pointer can cross onto it. */
const TOOLTIP_LEAVE_GRACE_MS = 100;
const GAP_PX = 8;
const EDGE_PX = 8;

interface TooltipContent {
  readonly ownerId: string;
  readonly text: string;
  readonly keys: readonly string[];
  readonly side: TooltipSide;
  readonly anchor: DOMRect;
}

interface TooltipState {
  readonly current: TooltipContent | null;
  /** When the last tooltip went, for the neighbour rule. */
  readonly lastHiddenAt: number;
  readonly show: (content: TooltipContent) => void;
  readonly hide: (ownerId?: string) => void;
}

export const useTooltipStore = create<TooltipState>()((set, get) => ({
  current: null,
  lastHiddenAt: Number.NEGATIVE_INFINITY,
  show: (content) => { set({ current: content }); },
  hide: (ownerId) => {
    const current = get().current;
    if (current === null) return;
    if (ownerId !== undefined && current.ownerId !== ownerId) return;
    set({ current: null, lastHiddenAt: performance.now() });
  },
}));

let leaveTimer: number | null = null;

function cancelLeave(): void {
  if (leaveTimer !== null) window.clearTimeout(leaveTimer);
  leaveTimer = null;
}

function leaveSoon(ownerId: string): void {
  cancelLeave();
  leaveTimer = window.setTimeout(() => {
    leaveTimer = null;
    useTooltipStore.getState().hide(ownerId);
  }, TOOLTIP_LEAVE_GRACE_MS);
}

export interface TooltipOptions {
  /** What the tooltip says; null shows none. */
  readonly text: string | null;
  readonly keys?: readonly string[];
  readonly side?: TooltipSide;
  /** Show without the first delay (Undo names its step at once, spec 6.9). */
  readonly immediate?: boolean;
}

export interface TooltipAnchorProps {
  readonly onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
  readonly onBlur: (event: FocusEvent<HTMLElement>) => void;
}

const NO_KEYS: readonly string[] = [];

/** Whether focus arrived from the keyboard. An engine without :focus-visible says no. */
function focusedByKeyboard(element: HTMLElement): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

/** The handlers that make an element a tooltip's anchor. */
export function useTooltip({ text, keys = NO_KEYS, side = "above", immediate = false }: TooltipOptions): TooltipAnchorProps {
  const ownerId = useId();
  const showTimer = useRef<number | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const latest = useRef({ text, keys, side });
  latest.current = { text, keys, side };
  const keysSignature = keys.join("\u0000");

  const clearShowTimer = useCallback((): void => {
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
    showTimer.current = null;
  }, []);

  const showNow = useCallback((): void => {
    const anchor = anchorRef.current;
    const { text: words, keys: chord, side: placement } = latest.current;
    if (anchor === null || words === null || !anchor.isConnected) return;
    cancelLeave();
    useTooltipStore.getState().show({ ownerId, text: words, keys: chord, side: placement, anchor: anchor.getBoundingClientRect() });
  }, [ownerId]);

  // A tooltip already up follows what its control says now (Undo's step).
  useEffect(() => {
    const current = useTooltipStore.getState().current;
    if (current?.ownerId !== ownerId) return;
    if (text === null) {
      useTooltipStore.getState().hide(ownerId);
      return;
    }
    if (current.text !== text || current.keys.join("\u0000") !== keysSignature || current.side !== side) showNow();
  }, [keysSignature, ownerId, showNow, side, text]);

  useEffect(() => () => {
    clearShowTimer();
    useTooltipStore.getState().hide(ownerId);
  }, [clearShowTimer, ownerId]);

  return {
    onPointerEnter: (event) => {
      if (event.pointerType !== "mouse") return;
      anchorRef.current = event.currentTarget;
      clearShowTimer();
      const { current, lastHiddenAt } = useTooltipStore.getState();
      const neighbour = current !== null || performance.now() - lastHiddenAt < TOOLTIP_NEIGHBOUR_WINDOW_MS;
      if (immediate || neighbour) {
        showNow();
        return;
      }
      showTimer.current = window.setTimeout(() => {
        showTimer.current = null;
        showNow();
      }, TOOLTIP_FIRST_DELAY_MS);
    },
    onPointerLeave: () => {
      clearShowTimer();
      leaveSoon(ownerId);
    },
    onPointerDown: () => {
      clearShowTimer();
      useTooltipStore.getState().hide(ownerId);
    },
    onFocus: (event) => {
      anchorRef.current = event.currentTarget;
      // Only a keyboard's focus shows it; a click's focus does not.
      if (!focusedByKeyboard(event.currentTarget)) return;
      showNow();
    },
    onBlur: () => {
      clearShowTimer();
      useTooltipStore.getState().hide(ownerId);
    },
  };
}

/** Where the tooltip sits: on its side of the anchor, flipped if there is no room, kept on screen. */
export function placeTooltip(
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  size: { readonly width: number; readonly height: number },
  side: TooltipSide,
  viewport: { readonly width: number; readonly height: number },
): { readonly left: number; readonly top: number; readonly side: TooltipSide } {
  const roomAbove = anchor.top - GAP_PX - EDGE_PX;
  const roomBelow = viewport.height - anchor.bottom - GAP_PX - EDGE_PX;
  let placed: TooltipSide = side;
  if (side === "above" && roomAbove < size.height && roomBelow >= size.height) placed = "below";
  if (side === "below" && roomBelow < size.height && roomAbove >= size.height) placed = "above";
  const top = placed === "above" ? anchor.top - GAP_PX - size.height : anchor.bottom + GAP_PX;
  const centre = (anchor.left + anchor.right) / 2;
  const left = Math.min(Math.max(EDGE_PX, centre - size.width / 2), viewport.width - EDGE_PX - size.width);
  return { left: Math.round(left), top: Math.round(top), side: placed };
}

/** The one place tooltips draw. Mount once inside the chrome. */
export function TooltipHost(): ReactElement | null {
  const current = useTooltipStore((state) => state.current);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || current === null) return;
    const placed = placeTooltip(current.anchor, { width: element.offsetWidth, height: element.offsetHeight }, current.side, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    element.style.setProperty("left", `${String(placed.left)}px`);
    element.style.setProperty("top", `${String(placed.top)}px`);
    element.style.setProperty("--pc-tooltip-origin", placed.side === "above" ? "50% 100%" : "50% 0%");
    element.dataset.side = placed.side;
    // Placed while hidden, then shown on the next frame so it scales from its edge.
    element.classList.remove("is-shown");
    const frame = window.requestAnimationFrame(() => { element.classList.add("is-shown"); });
    return () => { window.cancelAnimationFrame(frame); };
  }, [current]);

  // Esc dismisses a tooltip on screen, and that is all the press does: the
  // tooltip is the first layer of the planner's one Escape order.
  useEscapeLayer("tooltip", { open: current !== null, onEscape: () => { useTooltipStore.getState().hide(); } });

  useEffect(() => {
    if (current === null) return;
    const onMove = (): void => { useTooltipStore.getState().hide(); };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [current]);

  if (current === null || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      className="pc-tooltip pc-root"
      role="tooltip"
      aria-hidden="true"
      data-testid="planner-chrome-tooltip"
      onPointerEnter={cancelLeave}
      onPointerLeave={() => { leaveSoon(current.ownerId); }}
    >
      <span>{current.text}</span>
      {current.keys.length > 0 ? (
        <span className="pc-tooltip__keys">{current.keys.map((key) => <Kbd key={key}>{key}</Kbd>)}</span>
      ) : null}
    </div>,
    document.body,
  );
}
