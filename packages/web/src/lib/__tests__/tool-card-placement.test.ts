import { describe, expect, it } from "vitest";
import { placeToolCard, TOOL_CARD_GAP_PX, toolScrolledOut } from "../tool-card-placement.js";

const DESKTOP = { width: 1280, height: 800 } as const;
const CARD = { width: 280, height: 150 } as const;
/** The desktop rail: 68 px wide, down the screen's left edge, below the 70 px header. */
const RAIL = { left: 0, right: 68, top: 70, bottom: 800 } as const;
/** The More planner tools panel at 1280 px: 238 px wide, 276 px in from the right (ReferenceViewer.css). */
const MORE_PANEL = { left: 766, right: 1004, top: 82, bottom: 600 } as const;

function coversToolbar(left: number, width: number, toolbar: { readonly left: number; readonly right: number }): boolean {
  return left < toolbar.right && left + width > toolbar.left;
}

describe("placeToolCard", () => {
  it("opens the rail's card to the right, level with its tool, as the rail always has", () => {
    const placed = placeToolCard({ top: 300, bottom: 356 }, RAIL, CARD, DESKTOP);
    expect(placed.side).toBe("right");
    expect(placed.left).toBe(RAIL.right + TOOL_CARD_GAP_PX);
    expect(placed.top).toBe(328 - CARD.height / 2);
    expect(placed.arrowTop).toBe(CARD.height / 2);
    expect(coversToolbar(placed.left, CARD.width, RAIL)).toBe(false);
  });

  it("opens the More panel's card to the left, over the room, not the dock beside it", () => {
    // 254 px would fit on the right, over the dock; the left has 744.
    const placed = placeToolCard({ top: 91, bottom: 147 }, MORE_PANEL, CARD, DESKTOP);
    expect(placed.side).toBe("left");
    expect(placed.left).toBe(MORE_PANEL.left - TOOL_CARD_GAP_PX - CARD.width);
    expect(coversToolbar(placed.left, CARD.width, MORE_PANEL)).toBe(false);
    // A first-row tool's card sits level with the panel's top, off the tool pill above it.
    expect(placed.top).toBe(MORE_PANEL.top);
    expect(placed.arrowTop).toBe(119 - MORE_PANEL.top);
  });

  it("keeps a top tool's card off the header above the rail, its arrow still level with the tool", () => {
    const placed = placeToolCard({ top: 72, bottom: 128 }, RAIL, CARD, DESKTOP);
    expect(placed.top).toBe(RAIL.top);
    expect(placed.arrowTop).toBe(100 - RAIL.top);
  });

  it("keeps a bottom tool's card on screen and its arrow off the card's rounded corner", () => {
    const placed = placeToolCard({ top: 760, bottom: 790 }, RAIL, CARD, DESKTOP);
    expect(placed.top).toBe(DESKTOP.height - 8 - CARD.height);
    expect(placed.arrowTop).toBe(CARD.height - 24);
  });

  it("keeps the card's start on screen when neither side has room", () => {
    const placed = placeToolCard({ top: 300, bottom: 356 }, RAIL, CARD, { width: 300, height: 800 });
    expect(placed.left).toBe(300 - 8 - CARD.width);
    const tooWide = placeToolCard({ top: 300, bottom: 356 }, RAIL, { width: 400, height: 150 }, { width: 300, height: 800 });
    expect(tooWide.left).toBe(8);
  });
});

describe("toolScrolledOut", () => {
  const panel = { top: 82, bottom: 400 } as const;

  it("is true only when the tool is wholly outside the toolbar's view", () => {
    expect(toolScrolledOut({ top: 20, bottom: 82 }, panel)).toBe(true);
    expect(toolScrolledOut({ top: 400, bottom: 456 }, panel)).toBe(true);
    expect(toolScrolledOut({ top: 60, bottom: 116 }, panel)).toBe(false);
    expect(toolScrolledOut({ top: 200, bottom: 256 }, panel)).toBe(false);
  });

  it("never judges a tool scrolled out of a toolbar that is not laid out", () => {
    expect(toolScrolledOut({ top: 0, bottom: 0 }, { top: 0, bottom: 0 })).toBe(false);
  });
});
