import { useCallback, useRef, useState } from "react";
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
}

const ACTIVATION_PX = 5;
const MS_PER_HOUR = 3_600_000;

interface PointerSession {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly block: DragBlockDescriptor;
  lifted: boolean;
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
      onPointerDown: (event) => {
        if (!args.writable || event.button !== 0) return;
        if (stateRef.current.phase !== "idle" || pointerRef.current !== null) return;
        pointerRef.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          block,
          lifted: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event) => {
        const session = pointerRef.current;
        if (session === null || session.pointerId !== event.pointerId) return;
        const dx = event.clientX - session.startClientX;
        const dy = event.clientY - session.startClientY;
        if (!session.lifted) {
          if (Math.hypot(dx, dy) < ACTIVATION_PX) return;
          session.lifted = true;
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
        pointerRef.current = null;
        if (!session.lifted) return; // plain click — focus behaviour, no drag
        settle(envFor(session.block.isInk, event.shiftKey));
      },
      onPointerCancel: (event) => {
        const session = pointerRef.current;
        if (session === null || session.pointerId !== event.pointerId) return;
        pointerRef.current = null;
        setState(cancelDrag(stateRef.current));
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
    [args, envFor, settle],
  );

  const confirmDrop = useCallback(() => {
    const current = stateRef.current;
    if (current.phase !== "confirming") return;
    settle(envFor(current.context.isInk, false));
  }, [envFor, settle]);

  const cancel = useCallback(() => {
    setState(cancelDrag(stateRef.current));
  }, []);

  return {
    state,
    ghost: state.phase === "idle" ? null : state.ghost,
    activeBlockId: state.phase === "idle" ? null : state.context.blockId,
    confirming: state.phase === "confirming",
    announcement: announceDrag(state),
    handlersFor,
    confirmDrop,
    cancel,
  };
}
