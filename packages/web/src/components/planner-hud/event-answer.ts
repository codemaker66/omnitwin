import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  answerEventKind,
  deviceAsksEventKind,
  dismissEventKindReceipt,
  eventKindFloorTaken,
  shouldAskEventKind,
  useEventKindQuestion,
  type EventKindAnswer,
} from "../../lib/event-kind-record.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";

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

/**
 * Says what the day is: a kind, or null for someone who would rather not say
 * yet. It goes to the open layout's record, which sets the planner's kind and
 * keeps the answer with the layout. The page mounts a planner only once a
 * layout is open and its record read, so there is always one to tell.
 */
export function tellTheEvent(answer: EventKindAnswer): void {
  answerEventKind(answer);
  // The default planner says what an answer set up in a receipt of its own. This screen says it where the answer
  // was given (the sheet's chosen answer, the hand's cards), so that receipt is put away unseen. Whether the answer
  // was kept is said in Your event (useEventAnswerUnsaved).
  const receipt = useEventKindQuestion.getState().receipt;
  if (receipt !== null) dismissEventKindReceipt(receipt.seq);
}

/** Why the open layout's answer cannot be changed now. */
export type EventAnswerHold = "in-review" | "preview";

/**
 * Whether the open layout's answer is held as it is, and why: while the
 * layout is with the events team, and while one phase of its day is being
 * looked at. The default planner withholds its own control in both. Null
 * when the answer is free to change.
 */
export function useEventAnswerHold(): EventAnswerHold | null {
  const lockReason = useEditorStore((state) => state.lockReason);
  const previewing = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  if (lockReason === "in-review") return "in-review";
  return lockReason !== null || previewing ? "preview" : null;
}

/**
 * What the open layout's record could not yet do with its answer, to be said
 * where the answer is shown: "retrying" (not saved yet, and tried again only
 * while the page is open) or "this-visit" (it will not outlast this visit).
 * Null once the answer is kept.
 */
export function useEventAnswerUnsaved(): "retrying" | "this-visit" | null {
  const configId = useEditorStore((state) => state.configId);
  return useEventKindQuestion((state) => (
    configId !== null && state.configId === configId && (state.save === "retrying" || state.save === "this-visit") ? state.save : null
  ));
}

/**
 * Whether the open layout is one the question is asked of, by the default
 * planner's own rule (shouldAskEventKind): new as it opened, still empty,
 * never answered, free to change, not opened from an event, on a device that
 * asks. `floorEmpty` is the screen's own reading of the floor, which decides
 * only whether the question shows.
 *
 * It also does what that planner's question does for the record while it is
 * mounted: once anything stands on the layout's floor, the layout is no
 * longer new. That is read from the layout's own pieces and nothing else. The
 * floor's pieces are a moment behind when a layout opens and are still the
 * last layout's, so they would mark a new, empty layout as one that had been
 * furnished, and it would never be asked.
 */
export function useTheLayoutsQuestion(floorEmpty: boolean): boolean {
  const configId = useEditorStore((state) => state.configId);
  const layoutEmpty = useEditorStore((state) => state.objects.length === 0);
  const editable = useEventAnswerHold() === null;
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
    if (!layoutEmpty && ours && question.askable) eventKindFloorTaken(configId);
  }, [layoutEmpty, ours, question.askable, configId]);

  const eventLinked = (new URLSearchParams(address).get("eventId")?.trim() ?? "") !== "";
  return ours && shouldAskEventKind({
    editable,
    askable: question.askable,
    floorEmpty,
    eventLinked,
    known: question.known,
    answer: question.answer,
    deviceAsks,
  });
}
