// ---------------------------------------------------------------------------
// Where a v1 toolbox tool's card sits.
//
// The card used to be drawn inside the toolbar, absolutely placed 58 px right
// of its tool, so the toolbar's own scrolling (overflow) clipped it: in the
// planner's "More planner tools" panel only a sliver of it showed. It is now
// drawn in a portal, fixed to the viewport, and this decides where: beside the
// whole toolbar, on the side its layout opens toward (the room, not the chrome
// beside it), level with its tool, within the toolbar's height and on screen.
//
// It never crosses the toolbar while either side has a readable width of room:
// where the room is narrower than the card, the card narrows to it (down to
// 180 px), so it covers none of the toolbar's tools, its own least of all. The
// More panel leaves 190 px beside it in a 683 px window (a 1366 px laptop at
// 200 % zoom, WCAG 1.4.4), where a whole card would lie over the panel.
// ---------------------------------------------------------------------------

export type ToolCardSide = "left" | "right";

export interface ToolCardPlacement {
  readonly left: number;
  readonly top: number;
  readonly side: ToolCardSide;
  /** The card's width: its own, or narrowed to the room beside the toolbar. */
  readonly width: number;
  /** The arrow's centre, down from the card's top edge: level with the tool. */
  readonly arrowTop: number;
}

/** Between the toolbar and the card, room for the card's 11 px arrow. */
export const TOOL_CARD_GAP_PX = 14;
/** The narrowest a card is drawn to keep it off its toolbar; narrower, its words stop reading. */
export const TOOL_CARD_MIN_WIDTH_PX = 180;
const EDGE_PX = 8;
/** Keeps the arrow off the card's rounded (16 px) corners. */
const ARROW_INSET_PX = 24;

type VerticalEdges = Pick<DOMRect, "top" | "bottom">;
type Box = Pick<DOMRect, "left" | "right" | "top" | "bottom">;
interface Size {
  readonly width: number;
  readonly height: number;
}

/** Clamps to [low, high]; when the range is empty, the low edge wins, so the card's start stays on screen. */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/**
 * @param card    the card's own width (measured unplaced) and its height as drawn now
 * @param toward  the side the toolbar's layout opens its cards toward: the
 *                rail at the screen's left edge opens right; the More panel,
 *                by the right-hand dock, opens left over the room
 */
export function placeToolCard(tool: VerticalEdges, toolbar: Box, card: Size, viewport: Size, toward: ToolCardSide): ToolCardPlacement {
  const room: Readonly<Record<ToolCardSide, number>> = {
    right: viewport.width - toolbar.right - TOOL_CARD_GAP_PX - EDGE_PX,
    left: toolbar.left - TOOL_CARD_GAP_PX - EDGE_PX,
  };
  const away: ToolCardSide = toward === "right" ? "left" : "right";
  const readable = Math.min(card.width, TOOL_CARD_MIN_WIDTH_PX);
  let side = toward;
  if (room[toward] < readable) {
    if (room[away] >= readable || room[away] > room[toward]) side = away;
  }
  const width = Math.floor(Math.min(card.width, Math.max(room[side], readable)));
  const wantedLeft = side === "right" ? toolbar.right + TOOL_CARD_GAP_PX : toolbar.left - TOOL_CARD_GAP_PX - width;
  const left = clamp(wantedLeft, EDGE_PX, viewport.width - EDGE_PX - width);
  const middle = (tool.top + tool.bottom) / 2;
  // Within the toolbar's own height where it fits, so a first-row card sits
  // level with the toolbar's top, not over the header or the tool pill above;
  // on screen always.
  const withinToolbar = clamp(
    middle - card.height / 2,
    Math.max(EDGE_PX, toolbar.top),
    Math.min(viewport.height - EDGE_PX, toolbar.bottom) - card.height,
  );
  const top = clamp(withinToolbar, EDGE_PX, viewport.height - EDGE_PX - card.height);
  const arrowTop = clamp(middle - top, ARROW_INSET_PX, card.height - ARROW_INSET_PX);
  return { left: Math.round(left), top: Math.round(top), side, width, arrowTop: Math.round(arrowTop) };
}

/** True when the toolbar's scrolling has carried the tool wholly out of its view. */
export function toolScrolledOut(tool: VerticalEdges, toolbar: VerticalEdges): boolean {
  // A toolbar with no height is not laid out (being hidden, or a test DOM):
  // there is no view to leave, and a blur or a mouse leave takes the card down.
  if (toolbar.bottom <= toolbar.top) return false;
  return tool.bottom <= toolbar.top || tool.top >= toolbar.bottom;
}
