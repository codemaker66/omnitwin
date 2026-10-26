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
import {
  EVENT_KIND_WORDS,
  PLANNER_EVENT_KINDS,
  answerEventKind,
  changeEventKind,
  deviceAsksEventKind,
  dismissEventKindReceipt,
  keepEventKind,
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
// asked again. The room's name and the receipt open it again to change the
// answer. lib/event-kind-record keeps the answer and decides when to ask.
//
// It is a native modal <dialog> in the top layer, as the arrival's welcome
// is, so whichever opens later sits on top and the other waits beneath: the
// question either asks while the room is still arriving or meets the room
// once it has. Its keys stay inside it; the planner's keymap never hears them.
// ---------------------------------------------------------------------------

/** The ink drawing itself in: critically damped (ζ = 1), about a second, never past a line. */
const INK_SPRING: SpringConfig = { stiffness: 36, damping: 12 };
/** A panel rising to the pointer or the focus: quick, one soft overshoot (ζ ≈ 0.67). */
const LIFT_SPRING: SpringConfig = { stiffness: 320, damping: 24 };
/** The pick: the chosen panel comes forward as the others fall away (ζ ≈ 0.88). */
const PICK_SPRING: SpringConfig = { stiffness: 220, damping: 26 };
const SPRING_OPTIONS = { unit: "", epsilon: 0.002 } as const;

/** How long the pick shows before the room is handed back, ms (the fade is the last 180 ms, event-kind-picker.css). */
export const EVENT_KIND_LEAVE_MS = 420;
/** Each panel starts drawing this long after the one before it, ms. */
const DRAW_STAGGER_MS = 110;
/** How long the receipt stays, ms. */
export const EVENT_KIND_RECEIPT_MS = 7000;

const DIGIT_CODE = /^(?:Digit|Numpad)([1-3])$/u;

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
  const [lifted, setLifted] = useState(false);
  const words = EVENT_KIND_WORDS[kind];
  useSpringCssVariable(ref, "--ekp-ink", drawn ? 1 : 0, INK_SPRING, SPRING_OPTIONS);
  useSpringCssVariable(ref, "--ekp-lift", lifted && leaving === null ? 1 : 0, LIFT_SPRING, SPRING_OPTIONS);
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
        onPointerEnter={() => { setLifted(true); }}
        onPointerLeave={() => { setLifted(false); }}
        onFocus={() => { setLifted(true); }}
        onBlur={() => { setLifted(false); }}
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
  const headingId = useId();
  const subId = useId();
  const [drawn, setDrawn] = useState(0);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (!dialog.open) dialog.showModal();
    panels.current[firstFocus.current]?.focus({ preventScroll: true });
    return () => {
      closing.current = true;
      if (dialog.open) dialog.close();
    };
  }, []);

  // The three drawings ink themselves in, one after another.
  useEffect(() => {
    if (drawn >= PLANNER_EVENT_KINDS.length) return;
    const timer = window.setTimeout(() => { setDrawn((count) => count + 1); }, DRAW_STAGGER_MS);
    return () => { window.clearTimeout(timer); };
  }, [drawn]);

  const register = useCallback((index: number, node: HTMLButtonElement | null) => {
    panels.current[index] = node;
  }, []);

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
        if (leaving === null) onSkip();
      }}
      onClose={() => {
        // The browser can close a modal on a second Escape without asking; that is a skip too.
        if (!closing.current && leaving === null) onSkip();
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

/** What the planner just set, and where to change it; polite, gone after a few seconds. */
function EventKindReceipt(): ReactElement {
  const { receipt, unsaved, guest } = useEventKindQuestion(useShallow((state) => ({
    receipt: state.receipt,
    unsaved: state.unsaved,
    guest: state.guest,
  })));
  useEffect(() => {
    if (receipt === null) return;
    const timer = window.setTimeout(() => { dismissEventKindReceipt(receipt.seq); }, EVENT_KIND_RECEIPT_MS);
    return () => { window.clearTimeout(timer); };
  }, [receipt]);
  const said = receipt === null ? null
    : receipt.answer === null ? "Noted. You can say what the event is any time, from the room's name."
      : EVENT_KIND_WORDS[receipt.answer].receipt;
  const kept = !unsaved ? "" : guest ? " Kept for this visit only." : " Not saved yet.";
  // The live region is always there, so what appears in it is read out.
  return createPortal(
    <div className="ekp-receipt-region" role="status" aria-live="polite">
      {said !== null && (
        <div className="ekp-receipt" data-testid="event-kind-receipt">
          <span>{said}{kept}</span>
          <button type="button" className="ekp-receipt-change" onClick={changeEventKind}>Change</button>
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * The event, beside the room's name: what it is, and the one way to change
 * it (it opens the picker). Hidden until the layout's answer has been read,
 * and while the layout is locked for review or previewing a phase.
 */
export function EventKindName({ className = "" }: { readonly className?: string }): ReactElement | null {
  const { layout, known, answer } = useEventKindQuestion(useShallow((state) => ({
    layout: state.configId,
    known: state.known,
    answer: state.answer,
  })));
  const configId = useEditorStore((state) => state.configId);
  const unlocked = useEditorStore((state) => state.lockReason === null);
  const previewing = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  if (configId === null || layout !== configId || !known || !unlocked || previewing) return null;
  const label = answer === undefined || answer === null ? null : EVENT_KIND_WORDS[answer].label;
  return (
    <button
      type="button"
      className={["ekp-name", className].filter(Boolean).join(" ")}
      data-testid="event-kind-name"
      aria-label={label === null ? "Say what the event is" : `The event: ${label}. Change it`}
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
 * only once that answer is known. Mounted once per planner chrome: the v1
 * cockpit at every width, and the v2 chrome by lane C's one line.
 * `eventLinked`: the layout was opened from an event; read from the address
 * (`?eventId=`) when the chrome does not say.
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
    changing: state.changing,
  })));
  const [leaving, setLeaving] = useState<PlannerEventKind | null>(null);

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
      <EventKindReceipt />
    </>
  );
}
