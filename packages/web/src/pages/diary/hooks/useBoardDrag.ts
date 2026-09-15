import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  announceDrag,
  beginDrag,
  cancelDrag,
  dropDrag,
  moveGhostTo,
  nudgeGhost,
  type CommitPayload,
  type DragEnv,
  type DragState,
  type Ghost,
  type InkSpan,
  type NudgeDirection,
} from "../lib/board-drag.js";

// ---------------------------------------------------------------------------
// useBoardDrag (T-493; Canon §8) — the DOM-aware shell around the pure drag
// reducer. Pointer path: 5px activation threshold, pointer capture, Shift for
// the 1-minute fine step, lane hit-testing via data-diary-lane elements.
// Keyboard path: Enter/Space lifts, arrows nudge, Enter drops, Escape
// cancels — no animation on keyboard commits (they repeat all day).
// ---------------------------------------------------------------------------

export interface DragBlockDescriptor {
  readonly id: string;
  readonly title: string;
  readonly spaceId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly isInk: boolean;
}

export interface BoardDragArgs {
  readonly laneOrder: readonly string[];
  readonly inksByLane: ReadonlyMap<string, readonly InkSpan[]>;
  readonly pxPerHour: number;
  readonly writable: boolean;
  readonly onCommit: (payload: CommitPayload) => void;
  readonly onRejected: () => void;
  /** Enter on an idle block opens it (the drawer); Space lifts for drag. */
  readonly onOpenBlock?: (blockId: string) => void;
}

export interface BlockDragHandlers {
  readonly onClick: () => void;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export interface BoardDrag {
  readonly state: DragState;
  readonly ghost: Ghost | null;
  readonly activeBlockId: string | null;
  readonly confirming: boolean;
  readonly announcement: string;
  readonly handlersFor: (block: DragBlockDescriptor) => BlockDragHandlers;
  readonly confirmDrop: () => void;
  readonly cancel: () => void;
  /** The block a finger is currently carrying, or null. Only that block
   *  takes `touch-action: none`; every other block keeps the page
   *  scrolling under it (T-619). */
  readonly liftedBlockId: string | null;
}

const ACTIVATION_PX = 5;
/** A finger must rest this long on a block before it lifts. Below it, the
 *  gesture is a scroll and the board must not steal it — a day lane that
 *  could not be panned on a phone was the whole T-619 touch finding. */
const LONG_PRESS_MS = 400;
/** Travel that proves the press was a scroll after all. */
const LONG_PRESS_SLOP_PX = 8;
const MS_PER_HOUR = 3_600_000;

interface PointerSession {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly block: DragBlockDescriptor;
  lifted: boolean;
  /** Touch and pen wait for the long press; a mouse lifts on movement,
   *  because a mouse has no scroll gesture to take away. */
  readonly needsLongPress: boolean;
  /** The pending long-press timer, cleared the moment the gesture proves
   *  itself a scroll (or the pointer leaves). */
  longPressTimer: number | null;
}

function laneFromPoint(clientX: number, clientY: number): string | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const element of stack) {
    if (!(element instanceof HTMLElement)) continue;
    const laneId = element.dataset["diaryLane"];
    if (laneId !== undefined) return laneId;
  }
  return null;
}

export function useBoardDrag(args: BoardDragArgs): BoardDrag {
  const [state, setState] = useState<DragState>({ phase: "idle" });
  const stateRef = useRef<DragState>(state);
  stateRef.current = state;
  const pointerRef = useRef<PointerSession | null>(null);
  const suppressClickRef = useRef(false);
  /** Which block a finger is carrying. Rendered as a class, so it is state,
   *  not a ref — but it is only ever set for touch/pen lifts. */
  const [liftedBlockId, setLiftedBlockId] = useState<string | null>(null);

  const clearLongPress = useCallback((session: PointerSession | null): void => {
    if (session === null || session.longPressTimer === null) return;
    window.clearTimeout(session.longPressTimer);
    session.longPressTimer = null;
  }, []);

  /** Begin the drag for a session that has earned it. Shared by the mouse
   *  path (5px of travel) and the touch path (a ripened long press) so both
   *  enter the reducer through exactly one door. */
  const liftSession = useCallback((session: PointerSession): void => {
    session.lifted = true;
    suppressClickRef.current = true;
    if (session.needsLongPress) setLiftedBlockId(session.block.id);
    setState(
      beginDrag({
        blockId: session.block.id,
        title: session.block.title,
        mode: "pointer",
        originSpaceId: session.block.spaceId,
        originStartMs: session.block.startMs,
        originEndMs: session.block.endMs,
        isInk: session.block.isInk,
      }),
    );
  }, []);

  const endPointerSession = useCallback((): void => {
    clearLongPress(pointerRef.current);
    pointerRef.current = null;
    setLiftedBlockId(null);
  }, [clearLongPress]);

  useEffect(() => () => { clearLongPress(pointerRef.current); }, [clearLongPress]);

  const envFor = useCallback(
    (isInk: boolean, fine: boolean): DragEnv => ({
      snapMinutes: fine ? 1 : 15,
      laneOrder: args.laneOrder,
      inksByLane: args.inksByLane,
      isInk,
    }),
    [args.laneOrder, args.inksByLane],
  );

  const settle = useCallback(
    (env: DragEnv): void => {
      const outcome = dropDrag(stateRef.current, env);
      setState(outcome.state);
      if (outcome.effect === "commit") args.onCommit(outcome.payload);
      else if (outcome.effect === "rejected") args.onRejected();
    },
    [args],
  );

  const handlersFor = useCallback(
    (block: DragBlockDescriptor): BlockDragHandlers => ({
      onClick: () => {
        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
        if (stateRef.current.phase === "idle") args.onOpenBlock?.(block.id);
      },
      onPointerDown: (event) => {
        suppressClickRef.current = false;
        if (!args.writable || event.button !== 0) return;
        if (stateRef.current.phase !== "idle" || pointerRef.current !== null) return;
        // Only a real finger or pen waits. An unknown pointerType (some
        // synthetic events leave it empty) takes the mouse path: requiring
        // a long press from a device that cannot express one would make the
        // board undraggable, which is a worse failure than the reverse.
        const needsLongPress = event.pointerType === "touch" || event.pointerType === "pen";
        const session: PointerSession = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          block,
          lifted: false,
          needsLongPress,
          longPressTimer: null,
        };
        pointerRef.current = session;
        // Pointer capture is what makes a drag survive leaving the block —
        // but taking it on touch-down also takes the scroll. Capture is
        // therefore deferred until the press has ripened into a lift.
        if (!needsLongPress) {
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }
        const target = event.currentTarget;
        const pointerId = event.pointerId;
        session.longPressTimer = window.setTimeout(() => {
          if (pointerRef.current !== session) return;
          session.longPressTimer = null;
          // The element can be gone by now (a live refetch re-rendered the
          // lane); a failed capture must not throw away the lift.
          try {
            target.setPointerCapture(pointerId);
          } catch {
            // Capture is an optimisation here, not a precondition.
          }
          liftSession(session);
        }, LONG_PRESS_MS);
      },
      onPointerMove: (event) => {
        const session = pointerRef.current;
        if (session === null || session.pointerId !== event.pointerId) return;
        const dx = event.clientX - session.startClientX;
        const dy = event.clientY - session.startClientY;
        if (!session.lifted) {
          const travel = Math.hypot(dx, dy);
          if (session.needsLongPress) {
            // The finger moved before the press ripened: this was a scroll.
            // Stand down completely — no lift, and no half-armed session
            // waiting to grab the next move.
            if (travel > LONG_PRESS_SLOP_PX) endPointerSession();
            return;
          }
          if (travel < ACTIVATION_PX) return;
          liftSession(session);
        }
        const env = envFor(session.block.isInk, event.shiftKey);
        const current = stateRef.current;
        const fallbackLane =
          current.phase === "idle" ? session.block.spaceId : current.ghost.spaceId;
        const lane = laneFromPoint(event.clientX, event.clientY) ?? fallbackLane;
        const proposedStart =
          session.block.startMs + (dx / args.pxPerHour) * MS_PER_HOUR;
        setState((previous) => moveGhostTo(previous, lane, proposedStart, env));
      },
      onPointerUp: (event) => {
        const session = pointerRef.current;
        if (session === null || session.pointerId !== event.pointerId) return;
        const { lifted } = session;
        endPointerSession();
        if (!lifted) return; // a tap, or a press released early — open, don't drag
        settle(envFor(session.block.isInk, event.shiftKey));
      },
      onPointerCancel: (event) => {
        const session = pointerRef.current;
        if (session === null || session.pointerId !== event.pointerId) return;
        const { lifted } = session;
        endPointerSession();
        // Cancelling an unlifted press is just the platform reclaiming the
        // gesture (a scroll took over). There is no drag state to unwind.
        if (lifted) setState(cancelDrag(stateRef.current));
      },
      onKeyDown: (event) => {
        const current = stateRef.current;
        const isMine = current.phase !== "idle" && current.context.blockId === block.id;
        if (current.phase === "idle") {
          if (event.key === "Enter") {
            event.preventDefault();
            args.onOpenBlock?.(block.id);
            return;
          }
          if (!args.writable) return;
          if (event.key === " ") {
            event.preventDefault();
            setState(
              beginDrag({
                blockId: block.id,
                title: block.title,
                mode: "keyboard",
                originSpaceId: block.spaceId,
                originStartMs: block.startMs,
                originEndMs: block.endMs,
                isInk: block.isInk,
              }),
            );
          }
          return;
        }
        if (!isMine) return;
        const env = envFor(block.isInk, event.shiftKey);
        if (event.key === "Escape") {
          event.preventDefault();
          setState(cancelDrag(current));
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          settle(env);
          return;
        }
        const direction: NudgeDirection | null =
          event.key === "ArrowLeft"
            ? "left"
            : event.key === "ArrowRight"
              ? "right"
              : event.key === "ArrowUp"
                ? "up"
                : event.key === "ArrowDown"
                  ? "down"
                  : null;
        if (direction !== null && current.phase === "dragging") {
          event.preventDefault();
          setState((previous) => nudgeGhost(previous, direction, env));
        }
      },
    }),
    [args, endPointerSession, envFor, liftSession, settle],
  );

  const confirmDrop = useCallback(() => {
    const current = stateRef.current;
    if (current.phase !== "confirming") return;
    settle(envFor(current.context.isInk, false));
  }, [envFor, settle]);

  const cancel = useCallback(() => {
    endPointerSession();
    suppressClickRef.current = false;
    setState(cancelDrag(stateRef.current));
  }, [endPointerSession]);

  return {
    state,
    ghost: state.phase === "idle" ? null : state.ghost,
    activeBlockId: state.phase === "idle" ? null : state.context.blockId,
    confirming: state.phase === "confirming",
    announcement: announceDrag(state),
    handlersFor,
    confirmDrop,
    cancel,
    liftedBlockId,
  };
}
