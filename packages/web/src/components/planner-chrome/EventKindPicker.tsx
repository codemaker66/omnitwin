import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { PencilLine } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import type { PlannerEventKind } from "../../stores/planner-event-store.js";
import type { SpringConfig } from "../../lib/springs.js";
import { useSpringCssVariable } from "../../lib/use-spring-value.js";
import { prefersReducedMotion } from "../../lib/reduced-motion.js";
import { useEscapeLayer } from "../../lib/planner-keys.js";
import {
  EVENT_KIND_WORDS,
  PLANNER_EVENT_KINDS,
  answerEventKind,
  changeEventKind,
  deviceAsksEventKind,
  dismissEventKindReceipt,
  eventKindFloorTaken,
  keepEventKind,
  settleEventKindQuestion,
  shouldAskEventKind,
  useEventKindQuestion,
} from "../../lib/event-kind-record.js";
import { EventKindInk } from "./EventKindInk.js";
import "./event-kind-picker.css";

// ---------------------------------------------------------------------------
// "What are you planning?" (Blake, 26 Oct 2026; T-674)
//
// The first time a new, empty layout opens, the planner asks what the event
// is with three big panels, the way a game asks what you want to play: one
// tap and the room is set up for it (the chair a new seat gets, the shape Lay
// out starts with). "Not sure yet" or Escape skips, and that layout is never
// asked again. A layout that was not new as it opened is never asked, so the
// question never interrupts work. The room's name and the receipt open it
// again to change the answer. lib/event-kind-record keeps the answer and
// decides when to ask.
//
// It is a native modal <dialog> in the top layer, as the arrival's welcome
// is, so whichever opens later sits on top and the other waits beneath: the
// question either asks while the room is still arriving or meets the room
// once it has. Its keys stay inside it, and while it is the dialog on top it
// holds the planner's keymap (a "modal" Escape layer), so no shortcut acts on
// the room beneath it wherever focus has gone. One press of Escape, or a
// phone's back gesture, can reach every dialog opened together: a press that
// reached the welcome first was meant for the welcome, and the question stays.
// ---------------------------------------------------------------------------

/** The ink drawing itself in: critically damped (ζ = 1), about a second, never past a line. */
const INK_SPRING: SpringConfig = { stiffness: 36, damping: 12 };
/** A panel rising as it comes into hand (focus, moved by the keys or carried by a mouse): quick, one soft overshoot (ζ ≈ 0.67). */
const LIFT_SPRING: SpringConfig = { stiffness: 320, damping: 24 };
/** The pick: the chosen panel comes forward as the others fall away (ζ ≈ 0.88). */
const PICK_SPRING: SpringConfig = { stiffness: 220, damping: 26 };
const SPRING_OPTIONS = { unit: "", epsilon: 0.002 } as const;

/** How long the pick shows before the room is handed back, ms (the fade is the last 180 ms, event-kind-picker.css). */
export const EVENT_KIND_LEAVE_MS = 420;
/** Each panel starts drawing this long after the one before it, ms. */
const DRAW_STAGGER_MS = 110;
/** How long the receipt stays once nothing holds it (a pointer over it, focus in it), ms. */
export const EVENT_KIND_RECEIPT_MS = 7000;

const DIGIT_CODE = /^(?:Digit|Numpad)([1-3])$/u;

/**
 * The open dialogs, oldest first. The planner's are all modal (the arrival's
 * welcome and this question), and each portals itself to the end of the page
 * as it opens, so the last is the one on top.
 */
function openDialogs(): HTMLDialogElement[] {
  return Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]"));
}

/** Hands focus to the event's name where it can be seen, the lasting way to see and change the event. */
function focusEventName(): void {
  const names = Array.from(document.querySelectorAll<HTMLElement>("button.ekp-name"));
  const name = names.find((node) => node.getClientRects().length > 0) ?? names[0];
  name?.focus({ preventScroll: true });
}

/**
 * Hands focus back as a change closes: to the control that opened it while it
 * is still there, as the browser itself does, or else to the event's name. A
 * change opened from the receipt loses its Change button as it opens.
 */
function returnFocusAfterChange(opener: Element | null): void {
  if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
    opener.focus({ preventScroll: true });
    return;
  }
  focusEventName();
}

interface PanelProps {
  readonly kind: PlannerEventKind;
  readonly index: number;
  readonly drawn: boolean;
  readonly chosen: boolean;
  readonly leaving: PlannerEventKind | null;
  readonly onPick: (kind: PlannerEventKind) => void;
  readonly register: (index: number, node: HTMLButtonElement | null) => void;
}

function EventKindPanel({ kind, index, drawn, chosen, leaving, onPick, register }: PanelProps): ReactElement {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [focused, setFocused] = useState(false);
  const words = EVENT_KIND_WORDS[kind];
  useSpringCssVariable(ref, "--ekp-ink", drawn ? 1 : 0, INK_SPRING, SPRING_OPTIONS);
  useSpringCssVariable(ref, "--ekp-lift", focused && leaving === null ? 1 : 0, LIFT_SPRING, SPRING_OPTIONS);

  // One panel is in hand at a time: the focused one, which the keys move and a mouse carries. It is read from
  // the button's own focus, not React's onFocus. When the arrival's welcome closes over the question, the
  // browser hands focus back to this panel inside the commit that removes the welcome, while React's events
  // are paused, so onFocus never hears it.
  useEffect(() => {
    const node = ref.current;
    if (node === null) return undefined;
    const rise = (): void => { setFocused(true); };
    const settle = (): void => { setFocused(false); };
    node.addEventListener("focus", rise);
    node.addEventListener("blur", settle);
    setFocused(document.activeElement === node);
    return () => {
      node.removeEventListener("focus", rise);
      node.removeEventListener("blur", settle);
    };
  }, []);
  useSpringCssVariable(ref, "--ekp-pick", leaving === kind ? 1 : 0, PICK_SPRING, SPRING_OPTIONS);
  useSpringCssVariable(ref, "--ekp-away", leaving !== null && leaving !== kind ? 1 : 0, PICK_SPRING, SPRING_OPTIONS);
  return (
    <li className="ekp-slot">
      <button
        ref={(node) => { ref.current = node; register(index, node); }}
        type="button"
        className="ekp-panel"
        data-kind={kind}
        data-testid={`event-kind-${kind}`}
        aria-label={`${words.title}: ${words.line}${chosen ? ", chosen now" : ""}`}
        aria-keyshortcuts={String(index + 1)}
        disabled={leaving !== null}
        onPointerEnter={(event) => {
          // A touch has no hover; a mouse or pen over a panel takes it in hand.
          if (event.pointerType === "mouse" || event.pointerType === "pen") event.currentTarget.focus({ preventScroll: true });
        }}
        onClick={() => { onPick(kind); }}
      >
        <span className="ekp-art"><EventKindInk kind={kind} /></span>
        <span className="ekp-words">
          <span className="ekp-title">{words.title}</span>
          <span className="ekp-line">{words.line}</span>
        </span>
        <kbd className="ekp-key" aria-hidden="true">{index + 1}</kbd>
        {chosen && <span className="ekp-current" aria-hidden="true">Chosen now</span>}
      </button>
    </li>
  );
}

interface DialogProps {
  /** Opened from the room's name or the receipt, to change an answer. */
  readonly changing: boolean;
  /** The layout's answer, marked while changing it. */
  readonly current: PlannerEventKind | null;
  readonly leaving: PlannerEventKind | null;
  readonly onPick: (kind: PlannerEventKind) => void;
  readonly onSkip: () => void;
}

function EventKindDialog({ changing, current, leaving, onPick, onSkip }: DialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panels = useRef<(HTMLButtonElement | null)[]>([]);
  const closing = useRef(false);
  const firstFocus = useRef(changing && current !== null ? PLANNER_EVENT_KINDS.indexOf(current) : 0);
  const openedToChange = useRef(changing);
  /** What had focus as it opened, where a change hands focus back. */
  const opener = useRef<Element | null>(null);
  /** A close request reached another dialog first in this press: it was meant for that one. */
  const pressedForAnother = useRef(false);
  /** Whose close request the last cancel was: this question's, or a dialog's above it. */
  const lastCancel = useRef<"ours" | "theirs" | null>(null);
  const headingId = useId();
  const subId = useId();
  const [drawn, setDrawn] = useState(0);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    opener.current = document.activeElement;
    if (!dialog.open) dialog.showModal();
    panels.current[firstFocus.current]?.focus({ preventScroll: true });
    return () => {
      closing.current = true;
      if (dialog.open) dialog.close();
      if (openedToChange.current) returnFocusAfterChange(opener.current);
    };
  }, []);

  // A close request reaches the dialogs opened together in one task, the top one first, and on a page nobody
  // has touched yet none of them may refuse it. Another dialog's cancel heard just before this one's means the
  // press was aimed at that dialog; the flag lasts only until the task is over.
  useEffect(() => {
    const own = dialogRef.current;
    const heard = (event: Event): void => {
      if (event.target === own || !(event.target instanceof HTMLDialogElement)) return;
      pressedForAnother.current = true;
      window.setTimeout(() => { pressedForAnother.current = false; }, 0);
    };
    document.addEventListener("cancel", heard, true);
    return () => { document.removeEventListener("cancel", heard, true); };
  }, []);

  // While it is the dialog on top, the question holds the planner's keymap: no shortcut runs beneath it, and an
  // Escape that reaches the page itself (focus lost during the leave, or a click on its blank space) still skips.
  useEscapeLayer("modal", {
    open: () => {
      const open = openDialogs();
      return open.length > 0 && open[open.length - 1] === dialogRef.current;
    },
    onEscape: () => { if (leaving === null) onSkip(); },
  });

  // The three drawings ink themselves in, one after another.
  useEffect(() => {
    if (drawn >= PLANNER_EVENT_KINDS.length) return;
    const timer = window.setTimeout(() => { setDrawn((count) => count + 1); }, DRAW_STAGGER_MS);
    return () => { window.clearTimeout(timer); };
  }, [drawn]);

  const register = useCallback((index: number, node: HTMLButtonElement | null) => {
    panels.current[index] = node;
  }, []);

  /** Shows the question again after the browser closed it for a press meant for another dialog. */
  const reopen = (): void => {
    const dialog = dialogRef.current;
    if (dialog === null || dialog.open) return;
    dialog.showModal();
    panels.current[firstFocus.current]?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>): void => {
    // The question holds the keyboard: none of its keys reach the planner's keymap.
    event.stopPropagation();
    if (leaving !== null || event.ctrlKey || event.metaKey || event.altKey) return;
    const digit = DIGIT_CODE.exec(event.code);
    if (digit !== null) {
      const kind = PLANNER_EVENT_KINDS[Number(digit[1]) - 1];
      if (kind !== undefined) {
        event.preventDefault();
        onPick(kind);
      }
      return;
    }
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const at = panels.current.findIndex((node) => node !== null && node === document.activeElement);
    const count = PLANNER_EVENT_KINDS.length;
    panels.current[at === -1 ? 0 : (at + step + count) % count]?.focus();
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className={`ekp${leaving !== null ? " is-leaving" : ""}`}
      aria-labelledby={headingId}
      aria-describedby={subId}
      data-testid="event-kind-picker"
      onKeyDown={onKeyDown}
      onKeyUp={(event) => { event.stopPropagation(); }}
      onCancel={(event) => {
        event.preventDefault();
        if (pressedForAnother.current) {
          lastCancel.current = "theirs";
          return;
        }
        lastCancel.current = "ours";
        if (leaving === null) onSkip();
      }}
      onClose={() => {
        const cancel = lastCancel.current;
        lastCancel.current = null;
        if (closing.current || leaving !== null) return;
        // The browser closed it anyway, on a press it does not let a page refuse.
        if (cancel === "theirs") {
          reopen();
          return;
        }
        // Closed with no cancel heard: the browser's own second Escape, a skip too.
        if (cancel === null) onSkip();
      }}
    >
      <div className="ekp-sheet">
        <h2 id={headingId} className="ekp-heading">What are you planning?</h2>
        <p id={subId} className="ekp-sub">
          {changing
            ? "New seats follow your choice. Seats already placed keep their chairs."
            : "One tap sets up the room for it. You can change it any time."}
        </p>
        <ul className="ekp-panels">
          {PLANNER_EVENT_KINDS.map((kind, index) => (
            <EventKindPanel
              key={kind}
              kind={kind}
              index={index}
              drawn={drawn > index}
              chosen={changing && current === kind}
              leaving={leaving}
              onPick={onPick}
              register={register}
            />
          ))}
        </ul>
        <button type="button" className="ekp-skip" data-testid="event-kind-skip" disabled={leaving !== null} onClick={onSkip}>
          {changing ? "Keep it as it is" : "Not sure yet"}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

/**
 * Whether no dialog holds the page. While one does, everything outside it is
 * inert, and words written into a live region there are never read out; so
 * the receipt waits until every dialog has closed, and a frame more, before it
 * speaks. `dialogOpen` is the question's own state, checked again as it
 * changes; any dialog's closing is heard as it happens.
 */
function usePageFree(dialogOpen: boolean): boolean {
  const [free, setFree] = useState(() => openDialogs().length === 0);
  useEffect(() => {
    let frame = 0;
    const check = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => { setFree(openDialogs().length === 0); });
    };
    check();
    document.addEventListener("close", check, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("close", check, true);
    };
  }, [dialogOpen]);
  return free;
}

/** One receipt: it stays while a pointer is over it or focus is in it, and goes the set time after neither is. */
function ReceiptCard({ seq, words }: { readonly seq: number; readonly words: string }): ReactElement {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (hovered || focused) return;
    const timer = window.setTimeout(() => { dismissEventKindReceipt(seq); }, EVENT_KIND_RECEIPT_MS);
    return () => { window.clearTimeout(timer); };
  }, [hovered, focused, seq]);
  return (
    <div
      className="ekp-receipt"
      data-testid="event-kind-receipt"
      onPointerEnter={() => { setHovered(true); }}
      onPointerLeave={() => { setHovered(false); }}
      onFocus={() => { setFocused(true); }}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setFocused(false);
      }}
    >
      <span>{words}</span>
      <button type="button" className="ekp-receipt-change" onClick={changeEventKind}>Change</button>
    </div>
  );
}

/** What the planner just set, and where to change it; polite, and gone a few seconds after it is left be. */
function EventKindReceipt({ dialogOpen }: { readonly dialogOpen: boolean }): ReactElement {
  const { receipt, save } = useEventKindQuestion(useShallow((state) => ({
    receipt: state.receipt,
    save: state.save,
  })));
  const free = usePageFree(dialogOpen);
  const said = receipt === null ? null
    : receipt.answer === null ? "Noted. You can add the event any time, by the room's name."
      : EVENT_KIND_WORDS[receipt.answer].receipt;
  const kept = save === "retrying" ? " Not saved yet." : save === "this-visit" ? " Kept for this visit only." : "";
  // The live region is always there, so what appears in it is read out.
  return createPortal(
    <div className="ekp-receipt-region" role="status" aria-live="polite">
      {receipt !== null && said !== null && free && <ReceiptCard key={receipt.seq} seq={receipt.seq} words={`${said}${kept}`} />}
    </div>,
    document.body,
  );
}

/**
 * The event, beside the room's name: what it is, and the one way to change
 * it (it opens the picker). Until the layout's answer has been read, and
 * while the layout is locked for review or previewing a phase, its row is
 * kept empty, so nothing below it moves as the layout opens or locks.
 */
export function EventKindName({ className = "" }: { readonly className?: string }): ReactElement {
  const { layout, known, answer } = useEventKindQuestion(useShallow((state) => ({
    layout: state.configId,
    known: state.known,
    answer: state.answer,
  })));
  const configId = useEditorStore((state) => state.configId);
  const unlocked = useEditorStore((state) => state.lockReason === null);
  const previewing = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const classes = ["ekp-name", className].filter(Boolean).join(" ");
  if (configId === null || layout !== configId || !known || !unlocked || previewing) {
    return <span className={`${classes} is-reserved`} aria-hidden="true" />;
  }
  const label = answer === undefined || answer === null ? null : EVENT_KIND_WORDS[answer].label;
  return (
    <button
      type="button"
      className={classes}
      data-testid="event-kind-name"
      // Unanswered, the visible words are its whole name, so a voice saying them reaches it.
      aria-label={label === null ? undefined : `The event: ${label}. Change it`}
      onClick={changeEventKind}
    >
      <span>{label ?? "Add the event"}</span>
      <PencilLine size={12} aria-hidden="true" />
    </button>
  );
}

/**
 * The question and its receipt. The layout's answer is read as the layout
 * opens (editor-store's load hands it to lib/event-kind-record); this asks
 * only once that answer is known, and only a layout that was new as it
 * opened. Mounted once, in the v1 planner's comms layer (EditorPage), outside
 * its 3D and 2D views, so the room's name opens it in either; the v2 chrome
 * mounts it by lane C's one line. `eventLinked`: the layout was opened from
 * an event; read from the address (`?eventId=`) when the chrome does not say.
 */
export function EventKindPicker({ eventLinked }: { readonly eventLinked?: boolean } = {}): ReactElement | null {
  const configId = useEditorStore((state) => state.configId);
  const floorEmpty = useEditorStore((state) => state.objects.length === 0);
  const unlocked = useEditorStore((state) => state.lockReason === null);
  const previewing = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const [address] = useState(() => (typeof window === "undefined" ? "" : window.location.search));
  const fromEvent = eventLinked ?? (new URLSearchParams(address).get("eventId")?.trim() ?? "") !== "";
  const [deviceAsks] = useState(() => deviceAsksEventKind(address));
  const question = useEventKindQuestion(useShallow((state) => ({
    layout: state.configId,
    known: state.known,
    answer: state.answer,
    askable: state.askable,
    changing: state.changing,
  })));
  const [leaving, setLeaving] = useState<PlannerEventKind | null>(null);

  // Something stands on the floor: the layout is no longer new, and is never asked however empty it becomes.
  useEffect(() => {
    if (!floorEmpty && question.askable && configId !== null && question.layout === configId) eventKindFloorTaken(configId);
  }, [floorEmpty, question.askable, question.layout, configId]);

  // A change or a receipt in hand goes with the planner, so neither comes back unasked.
  useEffect(() => () => { settleEventKindQuestion(); }, []);

  useEffect(() => {
    if (leaving === null) return;
    const timer = window.setTimeout(() => { setLeaving(null); }, EVENT_KIND_LEAVE_MS);
    return () => { window.clearTimeout(timer); };
  }, [leaving]);

  const pick = useCallback((kind: PlannerEventKind) => {
    const { changing, answer } = useEventKindQuestion.getState();
    if (changing && answer === kind) {
      keepEventKind();
      return;
    }
    if (!prefersReducedMotion()) setLeaving(kind);
    answerEventKind(kind);
  }, []);

  const skip = useCallback(() => {
    if (useEventKindQuestion.getState().changing) keepEventKind();
    else answerEventKind(null);
  }, []);

  const asking = configId !== null && question.layout === configId && shouldAskEventKind({
    editable: unlocked && !previewing,
    askable: question.askable,
    floorEmpty,
    eventLinked: fromEvent,
    known: question.known,
    answer: question.answer,
    deviceAsks,
  });
  const open = asking || question.changing || leaving !== null;
  const current = question.answer === undefined ? null : question.answer;

  return (
    <>
      {open && (
        <EventKindDialog
          changing={question.changing}
          current={current}
          leaving={leaving}
          onPick={pick}
          onSkip={skip}
        />
      )}
      <EventKindReceipt dialogOpen={open} />
    </>
  );
}
