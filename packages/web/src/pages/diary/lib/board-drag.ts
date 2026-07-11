import { formatWallTime, snapMs } from "./board-time.js";

// ---------------------------------------------------------------------------
// Board drag state machine (T-493; Canon §8/§15).
//
// One pure reducer shared by pointer and keyboard drags — the DOM-aware hook
// translates pixels/keys into these transitions. Doctrine:
//
// - 15-minute absolute snap; 1-minute fine step while Shift is held.
// - The ghost carries its validity WITH the reason inline (R4.2): overlap
//   with an active ink is `blocked` for inks (the DB would refuse it with
//   23P01 anyway) and `warning` for pencils (the ladder allows it, the
//   conversion cannot happen while the ink stands).
// - Pencils commit on drop. Ink RESISTS: a valid ink drop enters a
//   `confirming` phase and commits only on explicit confirmation.
// - Escape cancels from any phase. Announcements feed the live region so the
//   keyboard drag is a first-class citizen, not an afterthought.
//
// Copy here is planning-support language — no compliance claims.
// ---------------------------------------------------------------------------

export type DragMode = "pointer" | "keyboard";

export interface DragContext {
  readonly blockId: string;
  readonly title: string;
  readonly mode: DragMode;
  readonly originSpaceId: string;
  readonly originStartMs: number;
  readonly originEndMs: number;
  readonly isInk: boolean;
}

export interface GhostRect {
  readonly spaceId: string;
  readonly startMs: number;
  readonly endMs: number;
}

export type GhostValidity =
  | { readonly kind: "ok" }
  | { readonly kind: "warning"; readonly reason: string }
  | { readonly kind: "blocked"; readonly reason: string };

export interface Ghost extends GhostRect {
  readonly validity: GhostValidity;
}

export type DragState =
  | { readonly phase: "idle" }
  | { readonly phase: "dragging"; readonly context: DragContext; readonly ghost: Ghost }
  | { readonly phase: "confirming"; readonly context: DragContext; readonly ghost: Ghost };

export interface InkSpan {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly title: string;
}

export interface DragEnv {
  readonly snapMinutes: number;
  readonly laneOrder: readonly string[];
  readonly inksByLane: ReadonlyMap<string, readonly InkSpan[]>;
  readonly isInk: boolean;
}

export interface MovePatch {
  readonly spaceId?: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
}

export interface CommitPayload {
  readonly bookingId: string;
  readonly patch: MovePatch;
  readonly changed: boolean;
}

export type DropOutcome =
  | { readonly state: DragState; readonly effect: "commit"; readonly payload: CommitPayload }
  | { readonly state: DragState; readonly effect: "confirm-required" | "rejected" | "noop" };

const MINUTE_MS = 60_000;

export function ghostValidity(
  rect: GhostRect,
  env: DragEnv,
  selfId: string,
): GhostValidity {
  const inks = env.inksByLane.get(rect.spaceId) ?? [];
  for (const ink of inks) {
    if (ink.id === selfId) continue;
    // Half-open overlap: touching edges are clear.
    if (rect.startMs < ink.endMs && ink.startMs < rect.endMs) {
      if (env.isInk) {
        return {
          kind: "blocked",
          reason: `Overlaps "${ink.title}" — two inked bookings cannot share a room.`,
        };
      }
      return {
        kind: "warning",
        reason: `Lands under "${ink.title}" — a pencil here cannot convert while that ink stands.`,
      };
    }
  }
  return { kind: "ok" };
}

export function beginDrag(context: DragContext): DragState {
  return {
    phase: "dragging",
    context,
    ghost: {
      spaceId: context.originSpaceId,
      startMs: context.originStartMs,
      endMs: context.originEndMs,
      // The origin is where the block already legally sits.
      validity: { kind: "ok" },
    },
  };
}

function withGhost(state: DragState, rect: GhostRect, env: DragEnv): DragState {
  if (state.phase === "idle") return state;
  return {
    phase: "dragging",
    context: state.context,
    ghost: { ...rect, validity: ghostValidity(rect, env, state.context.blockId) },
  };
}

/** Pointer path: propose a raw start instant in a lane; the reducer snaps it
 *  and preserves the block's duration. */
export function moveGhostTo(
  state: DragState,
  spaceId: string,
  proposedStartMs: number,
  env: DragEnv,
): DragState {
  if (state.phase === "idle") return state;
  const duration = state.context.originEndMs - state.context.originStartMs;
  const startMs = snapMs(proposedStartMs, env.snapMinutes);
  return withGhost(state, { spaceId, startMs, endMs: startMs + duration }, env);
}

export type NudgeDirection = "left" | "right" | "up" | "down";

/** Keyboard path: arrows shift time by the snap step and lanes by board
 *  order, clamped at the edges. */
export function nudgeGhost(state: DragState, direction: NudgeDirection, env: DragEnv): DragState {
  if (state.phase === "idle") return state;
  const { ghost } = state;
  if (direction === "left" || direction === "right") {
    const delta = (direction === "right" ? 1 : -1) * env.snapMinutes * MINUTE_MS;
    const startMs = snapMs(ghost.startMs + delta, env.snapMinutes);
    return withGhost(
      state,
      { spaceId: ghost.spaceId, startMs, endMs: startMs + (ghost.endMs - ghost.startMs) },
      env,
    );
  }
  const laneIndex = env.laneOrder.indexOf(ghost.spaceId);
  const nextIndex = Math.min(
    env.laneOrder.length - 1,
    Math.max(0, laneIndex + (direction === "down" ? 1 : -1)),
  );
  const spaceId = env.laneOrder[nextIndex] ?? ghost.spaceId;
  return withGhost(state, { spaceId, startMs: ghost.startMs, endMs: ghost.endMs }, env);
}

export function commitPayload(context: DragContext, ghost: GhostRect): CommitPayload {
  const timeChanged =
    ghost.startMs !== context.originStartMs || ghost.endMs !== context.originEndMs;
  const laneChanged = ghost.spaceId !== context.originSpaceId;
  const patch: MovePatch = {
    ...(laneChanged ? { spaceId: ghost.spaceId } : {}),
    ...(timeChanged
      ? {
          startsAt: new Date(ghost.startMs).toISOString(),
          endsAt: new Date(ghost.endMs).toISOString(),
        }
      : {}),
  };
  return { bookingId: context.blockId, patch, changed: laneChanged || timeChanged };
}

export function dropDrag(state: DragState, env: DragEnv): DropOutcome {
  if (state.phase === "idle") return { state, effect: "noop" };
  if (state.phase === "confirming") {
    return {
      state: { phase: "idle" },
      effect: "commit",
      payload: commitPayload(state.context, state.ghost),
    };
  }
  // Re-validate against the CURRENT env — the board may have refreshed while
  // the ghost was in flight, and a stale "ok" must not slip through.
  const validity = ghostValidity(state.ghost, env, state.context.blockId);
  if (validity.kind === "blocked") {
    return { state: { phase: "idle" }, effect: "rejected" };
  }
  const payload = commitPayload(state.context, state.ghost);
  if (!payload.changed) {
    return { state: { phase: "idle" }, effect: "noop" };
  }
  if (state.context.isInk) {
    return {
      state: { phase: "confirming", context: state.context, ghost: state.ghost },
      effect: "confirm-required",
    };
  }
  return { state: { phase: "idle" }, effect: "commit", payload };
}

export function cancelDrag(_state: DragState): DragState {
  return { phase: "idle" };
}

/** Live-region narration for keyboard (and pointer) drags. */
export function announceDrag(state: DragState): string {
  if (state.phase === "idle") return "";
  const { context, ghost } = state;
  const window = `${formatWallTime(ghost.startMs)} to ${formatWallTime(ghost.endMs)}`;
  const validity =
    ghost.validity.kind === "ok" ? "The slot is clear." : ghost.validity.reason;
  if (state.phase === "confirming") {
    return `Confirm moving the inked booking ${context.title} to ${window}. ${validity} Press Enter to confirm or Escape to cancel.`;
  }
  return `${context.title}, ${window}. ${validity} Arrow keys move, Enter drops, Escape cancels.`;
}
