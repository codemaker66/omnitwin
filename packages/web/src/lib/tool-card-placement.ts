// ---------------------------------------------------------------------------
// Where a v1 toolbox tool's card sits.
//
// The card used to be drawn inside the toolbar, absolutely placed 58 px right
// of its tool, so the toolbar's own scrolling (overflow) clipped it: in the
// planner's "More planner tools" panel only a sliver of it showed. It is now
// drawn in a portal, fixed to the viewport, and this decides where: beside the
// whole toolbar, on the side with more room, level with its tool, within the
// toolbar's height and kept on screen. It covers none of the toolbar's tools, as the planner chrome's own
// tooltip covers nothing (planner-chrome/Tooltip.tsx, placeTooltip).
// ---------------------------------------------------------------------------

export type ToolCardSide = "left" | "right";

export interface ToolCardPlacement {
  readonly left: number;
  readonly top: number;
  readonly side: ToolCardSide;
  /** The arrow's centre, down from the card's top edge: level with the tool. */
  readonly arrowTop: number;
}

/** Between the toolbar and the card, room for the card's 11 px arrow. */
export const TOOL_CARD_GAP_PX = 14;
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

export function placeToolCard(tool: VerticalEdges, toolbar: Box, card: Size, viewport: Size): ToolCardPlacement {
  const roomRight = viewport.width - toolbar.right - TOOL_CARD_GAP_PX - EDGE_PX;
  const roomLeft = toolbar.left - TOOL_CARD_GAP_PX - EDGE_PX;
  // The rail at the screen's left edge opens right, as it always has; the
  // More panel by the right-hand dock opens left, over the room, not the dock.
  const side: ToolCardSide = roomRight >= roomLeft ? "right" : "left";
  const wantedLeft = side === "right" ? toolbar.right + TOOL_CARD_GAP_PX : toolbar.left - TOOL_CARD_GAP_PX - card.width;
  const left = clamp(wantedLeft, EDGE_PX, viewport.width - EDGE_PX - card.width);
  const middle = (tool.top + tool.bottom) / 2;
  // Within the toolbar's own height, so a first-row card sits level with the
  // toolbar's top, not over the header or the tool pill above it.
  const highest = Math.max(EDGE_PX, toolbar.top);
  const lowest = Math.min(viewport.height - EDGE_PX, toolbar.bottom) - card.height;
  const top = clamp(middle - card.height / 2, highest, lowest);
  const arrowTop = clamp(middle - top, ARROW_INSET_PX, card.height - ARROW_INSET_PX);
  return { left: Math.round(left), top: Math.round(top), side, arrowTop: Math.round(arrowTop) };
}

/** True when the toolbar's scrolling has carried the tool wholly out of its view, so its card should go. */
export function toolScrolledOut(tool: VerticalEdges, toolbar: VerticalEdges): boolean {
  // A toolbar with no height is not laid out (being hidden, or a test DOM):
  // there is no view to leave, and a blur or a mouse leave takes the card down.
  if (toolbar.bottom <= toolbar.top) return false;
  return tool.bottom <= toolbar.top || tool.top >= toolbar.bottom;
}
