import { describe, expect, it } from "vitest";
import { placeToolCard, TOOL_CARD_GAP_PX, TOOL_CARD_MIN_WIDTH_PX, toolScrolledOut } from "../tool-card-placement.js";

const DESKTOP = { width: 1280, height: 800 } as const;
const CARD = { width: 280, height: 150 } as const;
/** The desktop rail: 68 px wide, down the screen's left edge, below the 70 px header. */
const RAIL = { left: 0, right: 68, top: 70, bottom: 800 } as const;
/** A first-row tool in the More panel, whose top is 82 px down. */
const FIRST_ROW = { top: 91, bottom: 147 } as const;

/**
 * The More planner tools panel as ReferenceViewer.css lays it out: 238 px wide,
 * 28 px in from the right-hand dock, whose width (--reference-right) is 248 px,
 * 230 px at 1200 px and below, and 205 px at 980 px and below.
 */
function morePanel(windowWidth: number): { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number } {
  const dock = windowWidth <= 980 ? 205 : windowWidth <= 1200 ? 230 : 248;
  const right = windowWidth - dock - 28;
  return { left: right - 238, right, top: 82, bottom: 523 };
}

function coversToolbar(left: number, width: number, toolbar: { readonly left: number; readonly right: number }): boolean {
  return left < toolbar.right && left + width > toolbar.left;
}

describe("placeToolCard", () => {
  it("opens the rail's card to the right at its own width, level with its tool, as the rail always has", () => {
    const placed = placeToolCard({ top: 300, bottom: 356 }, RAIL, CARD, DESKTOP, "right");
    expect(placed.side).toBe("right");
    expect(placed.width).toBe(CARD.width);
    expect(placed.left).toBe(RAIL.right + TOOL_CARD_GAP_PX);
    expect(placed.top).toBe(328 - CARD.height / 2);
    expect(placed.arrowTop).toBe(CARD.height / 2);
  });

  it("opens the More panel's card to the left, over the room, level with the panel's top for a first-row tool", () => {
    const panel = morePanel(1280);
    const placed = placeToolCard(FIRST_ROW, panel, CARD, DESKTOP, "left");
    expect(placed.side).toBe("left");
    expect(placed.width).toBe(CARD.width);
    expect(placed.left).toBe(panel.left - TOOL_CARD_GAP_PX - CARD.width);
    expect(coversToolbar(placed.left, placed.width, panel)).toBe(false);
    // Off the tool pill above the panel; the arrow still level with the tool.
    expect(placed.top).toBe(panel.top);
    expect(placed.arrowTop).toBe(119 - panel.top);
  });

  it("narrows the card to the room beside the More panel in a 683 px window, rather than lay it over the panel", () => {
    // A 1366 px laptop window at 200 % zoom (WCAG 1.4.4), or snapped to half the screen.
    const panel = morePanel(683);
    const placed = placeToolCard(FIRST_ROW, panel, CARD, { width: 683, height: 641 }, "left");
    expect(placed.side).toBe("left");
    expect(placed.width).toBe(190);
    expect(placed.left).toBe(8);
    expect(coversToolbar(placed.left, placed.width, panel)).toBe(false);
  });

  it("narrows it a little at 768 px (1536 px at 200 %)", () => {
    const panel = morePanel(768);
    const placed = placeToolCard(FIRST_ROW, panel, CARD, { width: 768, height: 704 }, "left");
    expect(placed.side).toBe("left");
    expect(placed.width).toBe(275);
    expect(coversToolbar(placed.left, placed.width, panel)).toBe(false);
  });

  it("opens over the dock only when the room side is below a readable width, still clear of the panel", () => {
    const panel = morePanel(641);
    const placed = placeToolCard(FIRST_ROW, panel, CARD, { width: 641, height: 641 }, "left");
    expect(placed.side).toBe("right");
    expect(placed.width).toBe(211);
    expect(coversToolbar(placed.left, placed.width, panel)).toBe(false);
  });

  it("never covers the More panel, nor leaves the screen, nor draws under a readable width, at any desktop window from 641 to 1600 px", () => {
    for (let windowWidth = 641; windowWidth <= 1600; windowWidth += 1) {
      const panel = morePanel(windowWidth);
      for (const cardWidth of [240, 260, 280, 300]) {
        const placed = placeToolCard(FIRST_ROW, panel, { width: cardWidth, height: 150 }, { width: windowWidth, height: 641 }, "left");
        const where = `${String(windowWidth)} px window, ${String(cardWidth)} px card`;
        expect(coversToolbar(placed.left, placed.width, panel), where).toBe(false);
        expect(placed.left, where).toBeGreaterThanOrEqual(8);
        expect(placed.left + placed.width, where).toBeLessThanOrEqual(windowWidth - 8);
        expect(placed.width, where).toBeGreaterThanOrEqual(TOOL_CARD_MIN_WIDTH_PX);
      }
    }
  });

  it("keeps a top tool's card off the header above the rail, its arrow still level with the tool", () => {
    const placed = placeToolCard({ top: 72, bottom: 128 }, RAIL, CARD, DESKTOP, "right");
    expect(placed.top).toBe(RAIL.top);
    expect(placed.arrowTop).toBe(100 - RAIL.top);
  });

  it("keeps a bottom tool's card on screen and its arrow off the card's rounded corner", () => {
    const placed = placeToolCard({ top: 760, bottom: 790 }, RAIL, CARD, DESKTOP, "right");
    expect(placed.top).toBe(DESKTOP.height - 8 - CARD.height);
    expect(placed.arrowTop).toBe(CARD.height - 24);
  });

  it("keeps a card taller than the toolbar's view on screen, the screen before the toolbar", () => {
    // 683 x 320: the 1366 x 641 window at 200 %; the panel shows two rows.
    const panel = { ...morePanel(683), bottom: 202 };
    const placed = placeToolCard(FIRST_ROW, panel, { width: 280, height: 260 }, { width: 683, height: 320 }, "left");
    expect(placed.top).toBe(320 - 8 - 260);
  });

  it("keeps the card on screen when neither side has a readable width of room", () => {
    const placed = placeToolCard({ top: 300, bottom: 356 }, RAIL, CARD, { width: 200, height: 800 }, "right");
    expect(placed.width).toBe(TOOL_CARD_MIN_WIDTH_PX);
    expect(placed.left).toBe(200 - 8 - TOOL_CARD_MIN_WIDTH_PX);
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
