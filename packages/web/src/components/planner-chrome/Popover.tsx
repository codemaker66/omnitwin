import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useEscapeLayer } from "../../lib/planner-keys.js";
import "./chrome.css";

// ---------------------------------------------------------------------------
// Popover — a panel opened by a key (spec 4.5, 8, 12).
//
// It opens from its key's edge, 8 px off the bar that holds the key, scaling
// in from that edge. It sits at the top of the page (a portal), so no panel
// or bar beside it can paint over it. Focus goes into it on opening and back
// to the key on Esc, which is its layer in the planner's one Escape order
// (after the operation in progress, before an open panel); a press anywhere
// else closes it. It never traps focus:
// Shift Tab from its first stop goes back to the key and Tab from its last
// goes on to whatever follows the key, as if the panel sat beside it. It is a
// non-modal dialog: Off · Quiet · Full is a choice, not a list of commands.
// ---------------------------------------------------------------------------

/** The gap between the bar that holds the key and the panel. */
export const POPOVER_GAP_PX = 8;

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

/** The elements Tab stops on inside a container, in order. */
function tabStops(container: ParentNode): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.tabIndex >= 0 && !element.hasAttribute("disabled"),
  );
}

export interface PopoverState {
  readonly open: boolean;
  readonly panelId: string;
  readonly triggerRef: RefObject<HTMLButtonElement>;
  readonly toggle: () => void;
  /** Closes it; with focus back on the key when it was the keyboard's doing. */
  readonly close: (returnFocus: boolean) => void;
  /** For the key: what it opens. */
  readonly triggerProps: {
    readonly "aria-haspopup": "dialog";
    readonly "aria-controls": string | undefined;
  };
}

export function usePopoverState(): PopoverState {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const toggle = useCallback((): void => { setOpen((was) => !was); }, []);
  const close = useCallback((returnFocus: boolean): void => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);
  // Esc closes it, wherever focus is, and the key takes focus back.
  useEscapeLayer("popover", { open, onEscape: () => { close(false); }, returnFocusTo: triggerRef });
  return useMemo(() => ({
    open,
    panelId,
    triggerRef,
    toggle,
    close,
    triggerProps: {
      "aria-haspopup": "dialog",
      "aria-controls": open ? panelId : undefined,
    },
  }), [close, open, panelId, toggle]);
}

export interface PopoverProps {
  readonly state: PopoverState;
  /** The panel's accessible name ("Sound"). */
  readonly label: string;
  /** Lined up with the bar's right edge ("end") or its left. */
  readonly align?: "start" | "end";
  /** Below the bar (the slate, the utilities) or above it (the dock). */
  readonly side?: "below" | "above";
  /** The evidence capture's name for this surface. */
  readonly chrome?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

export function Popover({ state, label, align = "end", side = "below", chrome, className, children }: PopoverProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const { open, close, triggerRef, panelId } = state;

  // Placed off the bar that holds its key, then shown on the next frame so it scales from that edge.
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (panel === null || trigger === null) return;
    const place = (): void => {
      // A surface that carries more than its bar (the slate with its plane) marks itself as the anchor.
      const bar = (trigger.closest("[data-pc-popover-anchor]") ?? trigger.closest(".pc-lacquer") ?? trigger).getBoundingClientRect();
      if (side === "below") panel.style.setProperty("--pc-popover-top", `${String(Math.round(bar.bottom + POPOVER_GAP_PX))}px`);
      else panel.style.setProperty("--pc-popover-bottom", `${String(Math.round(window.innerHeight - bar.top + POPOVER_GAP_PX))}px`);
      if (align === "end") panel.style.setProperty("--pc-popover-right", `${String(Math.round(window.innerWidth - bar.right))}px`);
      else panel.style.setProperty("--pc-popover-left", `${String(Math.round(bar.left))}px`);
    };
    place();
    tabStops(panel)[0]?.focus();
    const frame = window.requestAnimationFrame(() => { panel.classList.add("is-shown"); });
    window.addEventListener("resize", place);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
    };
  }, [align, open, side, triggerRef]);

  // A press anywhere but the panel and its key closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && (panelRef.current?.contains(target) === true || triggerRef.current?.contains(target) === true)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => { document.removeEventListener("pointerdown", onDown, true); };
  }, [close, open, triggerRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (panel === null || event.key !== "Tab") return;
    const stops = tabStops(panel);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      close(true);
    } else if (!event.shiftKey && document.activeElement === last && trigger !== null) {
      // On to whatever follows the key, as if the panel sat beside it.
      event.preventDefault();
      const page = tabStops(document.body).filter((element) => !panel.contains(element));
      const after = page[page.indexOf(trigger) + 1];
      close(after === undefined);
      after?.focus();
    }
  };

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-label={label}
      className={["pc-popover", "pc-lacquer", "pc-lacquer--raised", `pc-popover--${align}`, `pc-popover--${side}`, className ?? ""].filter(Boolean).join(" ")}
      data-pc-chrome={chrome}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        // Focus leaving for somewhere else on the page closes it.
        const next = event.relatedTarget;
        if (!(next instanceof Node)) return;
        if (panelRef.current?.contains(next) === true || triggerRef.current?.contains(next) === true) return;
        close(false);
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
