import { describe, expect, it, beforeEach } from "vitest";
import { ActionSchema } from "@omnitwin/types";
import { useMarkupStore, type MarkupPoint } from "../markup-store.js";
import { useActionLogStore } from "../action-log-store.js";
import { useAuthStore } from "../auth-store.js";

// G4 Slice 2: markup strokes emit Actions. Markup keeps its LOCAL
// stroke-undo (the T-447 carve-out — it never joins the global timeline),
// so its undo is itself a logged mutation (markup.erase), not a history.*
// meta record. Draft frames and hydration stay silent: only completed
// mutations of the persisted stroke list are Actions.

function loggedIntents(): readonly string[] {
  return useActionLogStore.getState().entries.map((entry) => entry.intent);
}

function lastAction() {
  const entries = useActionLogStore.getState().entries;
  const action = entries[entries.length - 1];
  if (action === undefined) throw new Error("expected a logged action");
  return action;
}

/** Draw one committed two-point stroke through the real gesture path. */
function drawStroke(from: MarkupPoint, to: MarkupPoint): void {
  const markup = useMarkupStore.getState();
  markup.beginStroke(from);
  useMarkupStore.getState().appendPoint(to);
  useMarkupStore.getState().commitStroke();
}

beforeEach(() => {
  useAuthStore.getState().setUser(null);
  useMarkupStore.setState({
    active: true,
    strokes: [],
    draftStroke: null,
    selectedColor: "gold",
    selectedWidth: 0.034,
    nextStrokeIndex: 1,
  });
  useActionLogStore.getState().reset();
  useActionLogStore.getState().beginLog("cfg-markup-test");
});

describe("markup stroke actions", () => {
  it("commitStroke logs one markup.draw; draft frames stay silent", () => {
    const markup = useMarkupStore.getState();
    markup.beginStroke({ x: 0, z: 0 });
    useMarkupStore.getState().appendPoint({ x: 1, z: 0 });
    expect(loggedIntents()).toEqual([]); // the open draft is not a mutation yet

    useMarkupStore.getState().commitStroke();
    expect(loggedIntents()).toEqual(["markup.draw"]);

    const action = lastAction();
    expect(ActionSchema.safeParse(action).success).toBe(true);
    expect(action.provenance).toEqual({ surface: "planner", tool: "markup" });
    const payload = action.payload as { stroke: { id: string; points: unknown[] } };
    expect(payload.stroke.id).toBe("markup-1");
    expect(payload.stroke.points).toHaveLength(2);
    expect(action.inverse).toEqual({ strokeId: "markup-1", restore: null });
  });

  it("a too-short draft discards without logging", () => {
    const markup = useMarkupStore.getState();
    markup.beginStroke({ x: 0, z: 0 });
    useMarkupStore.getState().commitStroke(); // below MIN_STROKE_POINTS
    expect(useMarkupStore.getState().strokes).toHaveLength(0);
    expect(loggedIntents()).toEqual([]);
  });

  it("undoStroke on a committed stroke logs markup.erase with a restoring inverse", () => {
    drawStroke({ x: 0, z: 0 }, { x: 1, z: 0 });
    useMarkupStore.getState().undoStroke();

    expect(useMarkupStore.getState().strokes).toHaveLength(0);
    expect(loggedIntents()).toEqual(["markup.draw", "markup.erase"]);
    const action = lastAction();
    const inverse = action.inverse as { stroke: { id: string } };
    expect(inverse.stroke.id).toBe("markup-1"); // re-drawing it reverts the erase
    expect((action.payload as { via: string }).via).toBe("stroke-undo");
  });

  it("undoStroke with an open draft only cancels the draft — no mutation, no action", () => {
    drawStroke({ x: 0, z: 0 }, { x: 1, z: 0 });
    useMarkupStore.getState().beginStroke({ x: 2, z: 2 });
    useMarkupStore.getState().undoStroke(); // cancels draft, keeps the stroke

    expect(useMarkupStore.getState().strokes).toHaveLength(1);
    expect(loggedIntents()).toEqual(["markup.draw"]);
  });

  it("undoStroke with nothing to remove stays silent", () => {
    useMarkupStore.getState().undoStroke();
    expect(loggedIntents()).toEqual([]);
  });

  it("clearStrokes logs markup.clear with every erased stroke in the inverse", () => {
    drawStroke({ x: 0, z: 0 }, { x: 1, z: 0 });
    drawStroke({ x: 2, z: 2 }, { x: 3, z: 2 });
    useMarkupStore.getState().clearStrokes();

    expect(loggedIntents()).toEqual(["markup.draw", "markup.draw", "markup.clear"]);
    const inverse = lastAction().inverse as { strokes: { id: string }[] };
    expect(inverse.strokes.map((s) => s.id)).toEqual(["markup-1", "markup-2"]);
  });

  it("clearStrokes with no strokes stays silent", () => {
    useMarkupStore.getState().clearStrokes();
    expect(loggedIntents()).toEqual([]);
  });

  it("loadStrokes is hydration, never a logged mutation", () => {
    useMarkupStore.getState().loadStrokes([
      { id: "markup-9", color: "gold", width: 0.034, points: [{ x: 0, z: 0 }, { x: 1, z: 1 }], createdAtMs: 1 },
    ]);
    expect(useMarkupStore.getState().strokes).toHaveLength(1);
    expect(loggedIntents()).toEqual([]);
  });

  it("drawing at the 160-stroke cap records the evicted stroke so the inverse stays truthful", () => {
    const strokes = Array.from({ length: 160 }, (_, i) => ({
      id: `markup-${String(i + 1)}`,
      color: "gold" as const,
      width: 0.034,
      points: [{ x: i, z: 0 }, { x: i, z: 1 }],
      createdAtMs: i,
    }));
    useMarkupStore.getState().loadStrokes(strokes);

    drawStroke({ x: -5, z: -5 }, { x: -4, z: -5 });

    expect(useMarkupStore.getState().strokes).toHaveLength(160); // cap held
    const action = lastAction();
    expect(action.intent).toBe("markup.draw");
    const payload = action.payload as { evicted: { id: string } | null };
    expect(payload.evicted?.id).toBe("markup-1"); // oldest fell off
    const inverse = action.inverse as { strokeId: string; restore: { id: string } | null };
    expect(inverse.restore?.id).toBe("markup-1"); // undoing the draw restores it
  });
});
