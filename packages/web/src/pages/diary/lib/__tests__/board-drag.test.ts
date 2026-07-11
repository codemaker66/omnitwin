import { describe, expect, it } from "vitest";
import {
  announceDrag,
  beginDrag,
  cancelDrag,
  commitPayload,
  dropDrag,
  ghostValidity,
  moveGhostTo,
  nudgeGhost,
  type DragEnv,
  type DragState,
} from "../board-drag.js";

// ---------------------------------------------------------------------------
// Board drag state machine (T-493; Canon §8/§15) — one pure reducer shared by
// pointer and keyboard drags. 15-minute absolute snap (1-minute with Shift),
// live ghost validity vs active inks with the reason inline, pencils commit
// on drop, ink requires explicit confirmation ("ink resists"), Esc cancels.
// ---------------------------------------------------------------------------

const LANE_A = "00000000-0000-4000-8000-0000000000a1";
const LANE_B = "00000000-0000-4000-8000-0000000000b2";
const LANE_C = "00000000-0000-4000-8000-0000000000c3";

const T17 = Date.parse("2026-09-18T17:00:00.000Z");
const T18 = Date.parse("2026-09-18T18:00:00.000Z");
const T23 = Date.parse("2026-09-18T23:00:00.000Z");

function env(overrides: Partial<DragEnv> = {}): DragEnv {
  return {
    snapMinutes: 15,
    laneOrder: [LANE_A, LANE_B, LANE_C],
    inksByLane: new Map([
      [LANE_B, [{ id: "ink-b", startMs: T18, endMs: T23, title: "Graduation ball" }]],
    ]),
    isInk: false,
    ...overrides,
  };
}

function lifted(overrides: Partial<Parameters<typeof beginDrag>[0]> = {}): DragState {
  return beginDrag({
    blockId: "hold-1",
    title: "MacLeod wedding",
    mode: "keyboard",
    originSpaceId: LANE_A,
    originStartMs: T17,
    originEndMs: T17 + 4 * 3_600_000,
    isInk: false,
    ...overrides,
  });
}

describe("beginDrag", () => {
  it("lifts into a dragging state whose ghost mirrors the origin", () => {
    const state = lifted();
    expect(state.phase).toBe("dragging");
    if (state.phase !== "dragging") return;
    expect(state.ghost.spaceId).toBe(LANE_A);
    expect(state.ghost.startMs).toBe(T17);
    expect(state.ghost.validity.kind).toBe("ok");
  });
});

describe("moveGhostTo (pointer)", () => {
  it("snaps the proposed start to the absolute quarter and preserves duration", () => {
    const state = moveGhostTo(lifted(), LANE_A, T17 + 7 * 60_000, env());
    if (state.phase !== "dragging") throw new Error("expected dragging");
    expect(state.ghost.startMs).toBe(T17);
    const eightMinutes = moveGhostTo(lifted(), LANE_A, T17 + 8 * 60_000, env());
    if (eightMinutes.phase !== "dragging") throw new Error("expected dragging");
    expect(eightMinutes.ghost.startMs).toBe(T17 + 15 * 60_000);
    expect(eightMinutes.ghost.endMs - eightMinutes.ghost.startMs).toBe(4 * 3_600_000);
  });

  it("uses the 1-minute fine step when the env says so (Shift)", () => {
    const state = moveGhostTo(lifted(), LANE_A, T17 + 7 * 60_000, env({ snapMinutes: 1 }));
    if (state.phase !== "dragging") throw new Error("expected dragging");
    expect(state.ghost.startMs).toBe(T17 + 7 * 60_000);
  });
});

describe("nudgeGhost (keyboard)", () => {
  it("arrows move time by the snap step and lanes by order", () => {
    let state = lifted();
    state = nudgeGhost(state, "right", env());
    if (state.phase !== "dragging") throw new Error("expected dragging");
    expect(state.ghost.startMs).toBe(T17 + 15 * 60_000);
    state = nudgeGhost(state, "left", env());
    state = nudgeGhost(state, "down", env());
    if (state.phase !== "dragging") throw new Error("expected dragging");
    expect(state.ghost.spaceId).toBe(LANE_B);
    expect(state.ghost.startMs).toBe(T17);
  });

  it("clamps lane movement at the board edges", () => {
    let state = lifted();
    state = nudgeGhost(state, "up", env());
    if (state.phase !== "dragging") throw new Error("expected dragging");
    expect(state.ghost.spaceId).toBe(LANE_A);
  });
});

describe("ghostValidity", () => {
  it("is ok on a clear lane", () => {
    expect(
      ghostValidity({ spaceId: LANE_C, startMs: T18, endMs: T23 }, env(), "hold-1").kind,
    ).toBe("ok");
  });

  it("warns a pencil dropped under an ink, naming the ink", () => {
    const validity = ghostValidity({ spaceId: LANE_B, startMs: T18, endMs: T23 }, env(), "hold-1");
    expect(validity.kind).toBe("warning");
    if (validity.kind === "ok") return;
    expect(validity.reason).toContain("Graduation ball");
  });

  it("blocks an ink overlapping another ink, naming it", () => {
    const validity = ghostValidity(
      { spaceId: LANE_B, startMs: T18, endMs: T23 },
      env({ isInk: true }),
      "ink-self",
    );
    expect(validity.kind).toBe("blocked");
    if (validity.kind === "ok") return;
    expect(validity.reason).toContain("Graduation ball");
  });

  it("never collides with itself", () => {
    const selfEnv = env({
      isInk: true,
      inksByLane: new Map([[LANE_A, [{ id: "ink-self", startMs: T17, endMs: T23, title: "Self" }]]]),
    });
    expect(
      ghostValidity({ spaceId: LANE_A, startMs: T17, endMs: T23 }, selfEnv, "ink-self").kind,
    ).toBe("ok");
  });

  it("treats touching edges as clear (half-open ranges)", () => {
    expect(
      ghostValidity({ spaceId: LANE_B, startMs: T23, endMs: T23 + 3_600_000 }, env(), "x").kind,
    ).toBe("ok");
  });
});

describe("dropDrag", () => {
  it("commits a pencil drop immediately with an ISO patch of only the changed fields", () => {
    let state = lifted();
    state = nudgeGhost(state, "right", env());
    state = nudgeGhost(state, "down", env());
    const outcome = dropDrag(state, env());
    expect(outcome.effect).toBe("commit");
    expect(outcome.state.phase).toBe("idle");
    if (outcome.effect !== "commit") return;
    expect(outcome.payload.bookingId).toBe("hold-1");
    expect(outcome.payload.patch).toEqual({
      spaceId: LANE_B,
      startsAt: new Date(T17 + 15 * 60_000).toISOString(),
      endsAt: new Date(T17 + 4 * 3_600_000 + 15 * 60_000).toISOString(),
    });
  });

  it("a drop with nothing changed is a no-op", () => {
    const outcome = dropDrag(lifted(), env());
    expect(outcome.effect).toBe("noop");
    expect(outcome.state.phase).toBe("idle");
  });

  it("a blocked ghost rejects the drop (the hook animates the snap-back)", () => {
    let state = lifted({ isInk: true, blockId: "ink-self", title: "Chamber dinner" });
    state = moveGhostTo(state, LANE_B, T18, env({ isInk: true }));
    const outcome = dropDrag(state, env({ isInk: true }));
    expect(outcome.effect).toBe("rejected");
    expect(outcome.state.phase).toBe("idle");
  });

  it("ink resists: a valid ink drop asks for explicit confirmation first", () => {
    let state = lifted({ isInk: true, blockId: "ink-self", title: "Chamber dinner" });
    state = moveGhostTo(state, LANE_C, T18, env({ isInk: true }));
    const outcome = dropDrag(state, env({ isInk: true }));
    expect(outcome.effect).toBe("confirm-required");
    expect(outcome.state.phase).toBe("confirming");
    const confirmed = dropDrag(outcome.state, env({ isInk: true }));
    expect(confirmed.effect).toBe("commit");
    expect(confirmed.state.phase).toBe("idle");
  });
});

describe("commitPayload", () => {
  it("emits only the fields that changed", () => {
    const state = lifted();
    if (state.phase !== "dragging") throw new Error("expected dragging");
    const timeOnly = commitPayload(state.context, {
      ...state.ghost,
      startMs: T17 + 15 * 60_000,
      endMs: T17 + 4 * 3_600_000 + 15 * 60_000,
    });
    expect(timeOnly.patch).not.toHaveProperty("spaceId");
    expect(timeOnly.changed).toBe(true);
    const laneOnly = commitPayload(state.context, { ...state.ghost, spaceId: LANE_C });
    expect(laneOnly.patch).toEqual({ spaceId: LANE_C });
  });
});

describe("cancel and announcements", () => {
  it("Escape returns to idle from any phase", () => {
    expect(cancelDrag(lifted()).phase).toBe("idle");
  });

  it("announces lift, movement, and validity for the live region", () => {
    const liftedState = lifted();
    expect(announceDrag(liftedState)).toContain("MacLeod wedding");
    const warned = moveGhostTo(liftedState, LANE_B, T18, env());
    const announcement = announceDrag(warned);
    expect(announcement).toContain("Graduation ball");
  });

  it("says nothing when idle", () => {
    expect(announceDrag({ phase: "idle" })).toBe("");
  });
});
