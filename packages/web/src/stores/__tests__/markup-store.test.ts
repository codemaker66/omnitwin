import { describe, it, expect, beforeEach } from "vitest";
import {
  parsePlannerMarkup,
  serializePlannerMarkup,
  useMarkupStore,
  type MarkupStroke,
} from "../markup-store.js";

function resetStore(): void {
  useMarkupStore.setState({
    active: false,
    strokes: [],
    draftStroke: null,
    selectedColor: "gold",
    selectedWidth: 0.034,
    nextStrokeIndex: 1,
    clearedStrokes: null,
  });
}

function drawStroke(from: number): void {
  const store = useMarkupStore.getState();
  store.setActive(true);
  store.beginStroke({ x: from, z: 0 });
  useMarkupStore.getState().appendPoint({ x: from + 0.5, z: 0.5 });
  useMarkupStore.getState().commitStroke();
}

beforeEach(resetStore);

describe("markup store", () => {
  it("does not start drawing when inactive", () => {
    useMarkupStore.getState().beginStroke({ x: 1, z: 2 });

    expect(useMarkupStore.getState().draftStroke).toBeNull();
  });

  it("commits a meaningful glowing floor stroke", () => {
    useMarkupStore.getState().setActive(true);
    useMarkupStore.getState().setColor("ruby");
    useMarkupStore.getState().beginStroke({ x: 0, z: 0 });
    useMarkupStore.getState().appendPoint({ x: 0.02, z: 0.02 });
    useMarkupStore.getState().appendPoint({ x: 0.4, z: 0.2 });
    useMarkupStore.getState().commitStroke();

    const stroke = useMarkupStore.getState().strokes[0];
    expect(stroke?.id).toBe("markup-1");
    expect(stroke?.color).toBe("ruby");
    expect(stroke?.points).toEqual([{ x: 0, z: 0 }, { x: 0.4, z: 0.2 }]);
    expect(useMarkupStore.getState().nextStrokeIndex).toBe(2);
  });

  it("throws away tap-only marks instead of creating tiny accidental dots", () => {
    useMarkupStore.getState().setActive(true);
    useMarkupStore.getState().beginStroke({ x: 0, z: 0 });
    useMarkupStore.getState().commitStroke();

    expect(useMarkupStore.getState().strokes).toHaveLength(0);
    expect(useMarkupStore.getState().draftStroke).toBeNull();
  });

  it("undo removes a draft before removing committed strokes", () => {
    useMarkupStore.getState().setActive(true);
    useMarkupStore.getState().beginStroke({ x: 0, z: 0 });
    useMarkupStore.getState().appendPoint({ x: 0.4, z: 0.2 });
    useMarkupStore.getState().commitStroke();
    useMarkupStore.getState().beginStroke({ x: 1, z: 1 });

    useMarkupStore.getState().undoStroke();
    expect(useMarkupStore.getState().draftStroke).toBeNull();
    expect(useMarkupStore.getState().strokes).toHaveLength(1);

    useMarkupStore.getState().undoStroke();
    expect(useMarkupStore.getState().strokes).toHaveLength(0);
  });

  it("serializes and parses persisted planner markup safely", () => {
    const strokes: readonly MarkupStroke[] = [{
      id: "markup-8",
      color: "gold",
      width: 0.034,
      points: [{ x: 1, z: 2 }, { x: 2, z: 3 }],
      createdAtMs: 42,
    }];

    const raw = serializePlannerMarkup(strokes);
    expect(parsePlannerMarkup(raw)).toEqual(strokes);
    expect(parsePlannerMarkup("{not-json")).toEqual([]);
    expect(parsePlannerMarkup(JSON.stringify({ version: 1, strokes: [{ ...strokes[0], color: "bad" }] }))).toEqual([]);
  });

  it("loads persisted strokes and advances the next generated id", () => {
    const stroke: MarkupStroke = {
      id: "markup-12",
      color: "cyan",
      width: 0.04,
      points: [{ x: 0, z: 0 }, { x: 1, z: 1 }],
      createdAtMs: 100,
    };

    useMarkupStore.getState().loadStrokes([stroke]);
    useMarkupStore.getState().setActive(true);
    useMarkupStore.getState().beginStroke({ x: 2, z: 2 });

    expect(useMarkupStore.getState().draftStroke?.id).toBe("markup-13");
  });
});

// T-635 N5, item 9: "Clear" could not be undone; the drawing was gone.
describe("markup store Clear", () => {
  it("brings a cleared drawing back on Undo", () => {
    drawStroke(0);
    drawStroke(2);
    const drawing = useMarkupStore.getState().strokes;
    useMarkupStore.getState().clearStrokes();
    expect(useMarkupStore.getState().strokes).toEqual([]);

    useMarkupStore.getState().undoStroke();
    expect(useMarkupStore.getState().strokes).toEqual(drawing);
    expect(useMarkupStore.getState().clearedStrokes).toBeNull();
  });

  it("undoes strokes drawn after a Clear first, then brings the cleared drawing back", () => {
    drawStroke(0);
    const drawing = useMarkupStore.getState().strokes;
    useMarkupStore.getState().clearStrokes();
    drawStroke(4);

    useMarkupStore.getState().undoStroke();
    expect(useMarkupStore.getState().strokes).toEqual([]);
    useMarkupStore.getState().undoStroke();
    expect(useMarkupStore.getState().strokes).toEqual(drawing);
  });

  it("forgets a cleared drawing when another layout's markup loads", () => {
    drawStroke(0);
    useMarkupStore.getState().clearStrokes();
    useMarkupStore.getState().loadStrokes([]);
    useMarkupStore.getState().undoStroke();
    expect(useMarkupStore.getState().strokes).toEqual([]);
  });
});
