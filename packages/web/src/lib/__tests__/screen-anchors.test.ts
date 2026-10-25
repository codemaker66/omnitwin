import { afterEach, describe, expect, it } from "vitest";
import { projectScreenAnchors, registerScreenAnchor, requestScreenAnchorFrame, screenAnchorCount, setScreenAnchorFrame, type ScreenPoint, type WorldPoint } from "../screen-anchors.js";

// ---------------------------------------------------------------------------
// Points in the room that the chrome follows on screen (T-671 slice 11′; the
// approved spec §6.6 "Following"): the caption registers its piece; one
// projector inside the canvas writes each anchor's screen point every frame,
// with no React render; an anchor with no point is reported hidden.
// ---------------------------------------------------------------------------

const leave: (() => void)[] = [];
afterEach(() => { leave.splice(0).forEach((undo) => { undo(); }); });

/** A stand-in camera: a world point's x and z become screen pixels; behind is z < 0. */
const flat = (world: WorldPoint): ScreenPoint => ({ x: world[0] * 10, y: world[2] * 10, visible: world[2] >= 0 });

describe("screen anchors", () => {
  it("writes each anchor's screen point when the frame projects", () => {
    const seen: ScreenPoint[] = [];
    leave.push(registerScreenAnchor("table-8", () => [1, 0, 2], (point) => { seen.push(point); }));
    projectScreenAnchors(flat);
    expect(seen).toEqual([{ x: 10, y: 20, visible: true }]);
  });

  it("follows the point as it moves, frame by frame", () => {
    let at: WorldPoint = [1, 0, 2];
    const seen: number[] = [];
    leave.push(registerScreenAnchor("table-8", () => at, (point) => { seen.push(point.x); }));
    projectScreenAnchors(flat);
    at = [3, 0, 2];
    projectScreenAnchors(flat);
    expect(seen).toEqual([10, 30]);
  });

  it("reports an anchor whose point is gone as hidden, without projecting it", () => {
    const seen: ScreenPoint[] = [];
    let projected = 0;
    leave.push(registerScreenAnchor("gone", () => null, (point) => { seen.push(point); }));
    projectScreenAnchors((world) => { projected += 1; return flat(world); });
    expect(projected).toBe(0);
    expect(seen).toEqual([{ x: 0, y: 0, visible: false }]);
  });

  it("forgets an anchor when it leaves, and a newer one under the same id wins", () => {
    const first: number[] = [];
    const second: number[] = [];
    const undoFirst = registerScreenAnchor("caption", () => [1, 0, 1], (point) => { first.push(point.x); });
    leave.push(registerScreenAnchor("caption", () => [2, 0, 1], (point) => { second.push(point.x); }));
    undoFirst(); // the older one leaving must not remove the newer
    expect(screenAnchorCount()).toBe(1);
    projectScreenAnchors(flat);
    expect(first).toEqual([]);
    expect(second).toEqual([20]);
    leave.splice(0).forEach((undo) => { undo(); });
    expect(screenAnchorCount()).toBe(0);
  });
});

describe("frames on demand", () => {
  it("asks the canvas for a frame when an anchor arrives, and on request, and not once the canvas has gone", () => {
    let frames = 0;
    const unset = setScreenAnchorFrame(() => { frames += 1; });
    leave.push(registerScreenAnchor("caption", () => [0, 0, 0], () => undefined));
    expect(frames).toBe(1); // a still camera draws no frame of its own
    requestScreenAnchorFrame();
    expect(frames).toBe(2);
    unset();
    requestScreenAnchorFrame();
    expect(frames).toBe(2);
  });
});
