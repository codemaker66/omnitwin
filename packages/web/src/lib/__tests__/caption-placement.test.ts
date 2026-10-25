import { describe, expect, it } from "vitest";
import { CAPTION_GAP_PX, CAPTION_MARGIN_PX, placeCaption } from "../caption-placement.js";

// ---------------------------------------------------------------------------
// Where the caption sits (T-671 slice 11′; approved spec §6.6): beside its
// piece, joined to the pin by a hairline; on the other side when the screen's
// edge is near; never over the dock; and, when the piece leaves the view,
// docked to the nearest edge with an arrow pointing to it.
// ---------------------------------------------------------------------------

const area = { width: 1600, height: 1000 };
const box = { width: 340, height: 180 };
/** The dock and rail begin here: the caption stays above. */
const floor = 860;

describe("beside its piece", () => {
  it("sits to the right of the pin, centred on it, with a hairline to its near edge", () => {
    const placed = placeCaption({ x: 600, y: 400, visible: true }, box, area, floor);
    expect(placed).toMatchObject({ x: 600 + CAPTION_GAP_PX, y: 400 - 90, side: "right" });
    expect(placed.line).toEqual({ x1: 600, y1: 400, x2: 600 + CAPTION_GAP_PX, y2: 400 });
  });

  it("goes to the left when the right edge is near", () => {
    const placed = placeCaption({ x: 1400, y: 400, visible: true }, box, area, floor);
    expect(placed).toMatchObject({ x: 1400 - CAPTION_GAP_PX - 340, side: "left" });
    expect(placed.line?.x2).toBe(1400 - CAPTION_GAP_PX);
  });

  it("never covers the dock, and never leaves the top", () => {
    const low = placeCaption({ x: 600, y: 840, visible: true }, box, area, floor);
    expect(low.y + box.height).toBeLessThanOrEqual(floor - CAPTION_MARGIN_PX);
    const high = placeCaption({ x: 600, y: 20, visible: true }, box, area, floor);
    expect(high.y).toBe(CAPTION_MARGIN_PX);
    // The hairline still meets the box where it can.
    expect(high.line?.y2).toBe(Math.max(20, CAPTION_MARGIN_PX));
  });
});

describe("when its piece leaves the view", () => {
  it("docks to the nearest edge, with no hairline and an arrow towards the piece", () => {
    const right = placeCaption({ x: 1900, y: 400, visible: false }, box, area, floor);
    expect(right).toMatchObject({ side: "docked", x: area.width - CAPTION_MARGIN_PX - box.width, line: null });
    expect(right.arrowDeg).toBeCloseTo(0, 0); // pointing right
    const above = placeCaption({ x: 800, y: -300, visible: false }, box, area, floor);
    expect(above).toMatchObject({ side: "docked", y: CAPTION_MARGIN_PX });
    expect(above.arrowDeg).toBeCloseTo(-90, 0); // pointing up
  });

  it("docks bottom-centre, above the dock, when it knows nothing of where the piece went", () => {
    const lost = placeCaption({ x: 0, y: 0, visible: false }, box, area, floor, true);
    expect(lost).toMatchObject({ side: "docked", x: (area.width - box.width) / 2, y: floor - CAPTION_MARGIN_PX - box.height, arrowDeg: null });
  });
});
