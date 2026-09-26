import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { suppressScrollWhileLifted } from "../lib/touch-scroll.js";

// ---------------------------------------------------------------------------
// useBoardDrag (T-493; Canon §8) — the DOM-aware shell around the pure drag
// reducer. Mouse path: 5px activation threshold, pointer capture, Shift for
// the 1-minute fine step, lane hit-testing via data-diary-lane elements.
// Touch and pen (T-619): a finger scrolls the board; a 400ms press lifts the
// block, and only then is the pointer captured and the page's scroll held.
// Keyboard path: Space lifts, arrows nudge, Enter drops, Escape cancels — no
// animation on keyboard commits (they repeat all day).
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
  /** The block a finger or pen is carrying, or null. Only that block takes
   *  `touch-action: none`; every other block keeps the page scrolling. */
  readonly liftedBlockId: string | null;
}

const ACTIVATION_PX = 5;
/** How long a finger rests on a block before it lifts. Below it the gesture
 *  is a scroll, and the board must not take it: a day lane that could not be
 *  panned on a phone was the whole T-619 touch finding. */
const LONG_PRESS_MS = 400;
/** Travel that proves a ripening press was a scroll after all. */
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
   *  itself a scroll or the pointer leaves. */
  longPressTimer: number | null;
  /** Releases the non-passive touchmove listener that holds the page's
   *  scroll once this session lifts (lib/touch-scroll.ts). Null for a mouse. */
  releaseScroll: (() => void) | null;
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
  // The page builds `args` afresh on every render. Handlers read the latest
  // COMMITTED args through this ref (events only fire after a commit), so
  // their identities never change and memoised blocks keep equal props.
  const argsRef = useRef(args);
  useLayoutEffect(() => {
    argsRef.current = args;
  });
  /** Which block a finger is carrying. Rendered as a class, so it is state,
   *  not a ref — and it is only ever set for touch and pen lifts. */
  const [liftedBlockId, setLiftedBlockId] = useState<string | null>(null);

  const clearLongPress = useCallback((session: PointerSession | null): void => {
    if (session === null || session.longPressTimer === null) return;
    window.clearTimeout(session.longPressTimer);
    session.longPressTimer = null;
  }, []);

  /** Begin the drag for a session that has earned it: 5px of mouse travel,
   *  or a ripened long press. One door into the reducer for both. */
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
    const session = pointerRef.current;
    clearLongPress(session);
    session?.releaseScroll?.();
    pointerRef.current = null;
    setLiftedBlockId(null);
  }, [clearLongPress]);

  // Unmounting mid-press must not leave a timer or a document listener behind.
  useEffect(() => () => {
    const session = pointerRef.current;
    clearLongPress(session);
    session?.releaseScroll?.();
  }, [clearLongPress]);

  const envFor = useCallback(
    (isInk: boolean, fine: boolean): DragEnv => ({
      snapMinutes: fine ? 1 : 15,
      laneOrder: argsRef.current.laneOrder,
      inksByLane: argsRef.current.inksByLane,
      isInk,
    }),
    [],
  );

  const settle = useCallback(
    (env: DragEnv): void => {
      const outcome = dropDrag(stateRef.current, env);
      setState(outcome.state);
      if (outcome.effect === "commit") argsRef.current.onCommit(outcome.payload);
      else if (outcome.effect === "rejected") argsRef.current.onRejected();
    },
    [],
  );

  const handlersFor = useCallback(
    (block: DragBlockDescriptor): BlockDragHandlers => ({
      onClick: () => {
        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
        if (stateRef.current.phase === "idle") argsRef.current.onOpenBlock?.(block.id);
      },
      onPointerDown: (event) => {
        suppressClickRef.current = false;
        if (!argsRef.current.writable || event.button !== 0) return;
        if (stateRef.current.phase !== "idle" || pointerRef.current !== null) return;
        // Only a real finger or pen waits. An unknown pointerType (some
        // synthetic events leave it empty) takes the mouse path: demanding a
        // long press from a device that cannot express one would make the
        // board undraggable.
        const needsLongPress = event.pointerType === "touch" || event.pointerType === "pen";
        const session: PointerSession = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          block,
          lifted: false,
          needsLongPress,
          longPressTimer: null,
          releaseScroll: null,
        };
        pointerRef.current = session;
        if (!needsLongPress) {
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }
        // Capture waits for the lift: taking it on touch-down takes the
        // scroll with it. The scroll hold is registered NOW and decides per
        // event — a touch-action change at lift time cannot affect a gesture
        // the browser has already classified as a pan (lib/touch-scroll.ts).
        session.releaseScroll = suppressScrollWhileLifted(() => session.lifted);
        const target = event.currentTarget;
        const pointerId = event.pointerId;
        session.longPressTimer = window.setTimeout(() => {
          if (pointerRef.current !== session) return;
          session.longPressTimer = null;
          // A live refetch can have replaced the element by now; a failed
          // capture must not throw the lift away.
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
            // The finger moved before the press ripened: a scroll. Stand down
            // completely — no late lift, no half-armed session.
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
          session.block.startMs + (dx / argsRef.current.pxPerHour) * MS_PER_HOUR;
        // moveGhostTo returns the previous state inside the same snapped
        // slot, so most pointermoves settle without a render.
        setState((previous) => moveGhostTo(previous, lane, proposedStart, env));
      },
      onPointerUp: (event) => {
        const session = pointerRef.current;
        if (session === null || session.pointerId !== event.pointerId) return;
        const { lifted } = session;
        endPointerSession();
        if (!lifted) return; // a click, or a press released early — open, don't drag
        settle(envFor(session.block.isInk, event.shiftKey));
      },
      onPointerCancel: (event) => {
        const session = pointerRef.current;
        if (session === null || session.pointerId !== event.pointerId) return;
        const { lifted } = session;
        endPointerSession();
        // An unlifted press cancelled is the platform taking its scroll
        // back; there is no drag to unwind.
        if (lifted) setState(cancelDrag(stateRef.current));
      },
      onKeyDown: (event) => {
        const current = stateRef.current;
        const isMine = current.phase !== "idle" && current.context.blockId === block.id;
        if (current.phase === "idle") {
          if (event.key === "Enter") {
            event.preventDefault();
            argsRef.current.onOpenBlock?.(block.id);
            return;
          }
          if (!argsRef.current.writable) return;
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
    [endPointerSession, envFor, liftSession, settle],
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

  // One object per drag state, so a memoised board skips page renders that
  // leave the drag untouched.
  return useMemo(
    () => ({
      state,
      ghost: state.phase === "idle" ? null : state.ghost,
      activeBlockId: state.phase === "idle" ? null : state.context.blockId,
      confirming: state.phase === "confirming",
      announcement: announceDrag(state),
      handlersFor,
      confirmDrop,
      cancel,
      liftedBlockId,
    }),
    [state, handlersFor, confirmDrop, cancel, liftedBlockId],
  );
}
