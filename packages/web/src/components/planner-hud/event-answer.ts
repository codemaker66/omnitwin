import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  answerEventKind,
  deviceAsksEventKind,
  dismissEventKindReceipt,
  eventKindFloorTaken,
  eventKindFromSearch,
  shouldAskEventKind,
  useEventKindQuestion,
  type EventKindAnswer,
} from "../../lib/event-kind-record.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { usePlannerEventStore } from "../../stores/planner-event-store.js";

// ---------------------------------------------------------------------------
// The event's answer, kept (lib/event-kind-record).
//
// "What are you planning?" has one kept answer for a layout: the record the
// default planner's question writes, on this device for a guest's draft and in
// the layout itself for someone signed in. This screen asks the same question
// in its own places (the first screen, and Your event), so it tells the same
// record. An answer given here is there after a reload and in the other
// planner, and a layout that has been asked there is not asked again here.
// ---------------------------------------------------------------------------

/** An answer given before the layout had been read: it waits here for it. */
let early: { readonly answer: EventKindAnswer } | null = null;
let stopWaiting: (() => void) | null = null;

/** The open layout's answer has been read. */
function layoutRead(): boolean {
  const { configId, known } = useEventKindQuestion.getState();
  return configId !== null && known;
}

function keep(answer: EventKindAnswer): void {
  answerEventKind(answer);
  // The default planner says what an answer set up in a receipt of its own. This screen says it where the answer
  // was given (the sheet's chosen answer, the hand's cards), so that receipt is put away unseen.
  const receipt = useEventKindQuestion.getState().receipt;
  if (receipt !== null) dismissEventKindReceipt(receipt.seq);
}

/**
 * Says what the day is: a kind, or null for someone who would rather not say
 * yet. It is set at once and kept with the layout. Given before the layout has
 * been read (a slow connection, a quick hand), it is held, and kept the moment
 * the layout is read, unless that layout turns out to hold an answer already,
 * which then stands.
 */
export function tellTheEvent(answer: EventKindAnswer): void {
  if (layoutRead()) {
    early = null;
    keep(answer);
    return;
  }
  usePlannerEventStore.getState().setEventKind(answer);
  early = { answer };
  stopWaiting ??= useEventKindQuestion.subscribe(() => {
    if (!layoutRead()) return;
    stopWaiting?.();
    stopWaiting = null;
    // After the record has finished reading the layout: it sets the planner's kind last, from what it read.
    queueMicrotask(() => {
      const waiting = early;
      early = null;
      if (waiting !== null && layoutRead() && useEventKindQuestion.getState().answer === undefined) keep(waiting.answer);
    });
  });
}

/**
 * Whether the open layout is one the question is asked of, by the default
 * planner's own rule (shouldAskEventKind): new as it opened, still empty,
 * never answered, free to change, not opened from an event, on a device that
 * asks. Before a layout has been read the screen's own facts decide, except
 * where the address already answers (`?event=`) or says not to ask.
 *
 * It also does what that planner's question does for the record while it is
 * mounted: once anything stands on the floor, the layout is no longer new.
 */
export function useTheLayoutsQuestion(floorEmpty: boolean): boolean {
  const configId = useEditorStore((state) => state.configId);
  const unlocked = useEditorStore((state) => state.lockReason === null);
  const previewing = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const [address] = useState(() => (typeof window === "undefined" ? "" : window.location.search));
  const [deviceAsks] = useState(() => deviceAsksEventKind(address));
  const question = useEventKindQuestion(useShallow((state) => ({
    layout: state.configId,
    known: state.known,
    answer: state.answer,
    askable: state.askable,
  })));
  const ours = configId !== null && question.layout === configId;

  useEffect(() => {
    if (!floorEmpty && ours && question.askable) eventKindFloorTaken(configId);
  }, [floorEmpty, ours, question.askable, configId]);

  const eventLinked = (new URLSearchParams(address).get("eventId")?.trim() ?? "") !== "";
  if (!deviceAsks || eventLinked) return false;
  if (!ours || !question.known) return eventKindFromSearch(address) === undefined;
  return shouldAskEventKind({
    editable: unlocked && !previewing,
    askable: question.askable,
    floorEmpty,
    eventLinked,
    known: question.known,
    answer: question.answer,
    deviceAsks,
  });
}

/** Forgets an answer still waiting for its layout (tests). */
export function resetEventAnswerForTesting(): void {
  early = null;
  stopWaiting?.();
  stopWaiting = null;
}
