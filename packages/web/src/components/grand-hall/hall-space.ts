import { useEditorStore } from "../../stores/editor-store.js";
import { useTradesHallVenue } from "../../hooks/use-trades-hall-venue.js";

/**
 * Whether a planner space is drawn as the Grand Hall's real-time room: Trades
 * Hall's Grand Hall, by the same name test as the planner's room variant, and
 * never another venue's room of that name. `tradesHallVenue` is null while
 * the venue is still being read; the hall is drawn meanwhile, so it never
 * changes under Trades Hall's own planners.
 */
export function isModelledGrandHall(space: { readonly name: string } | null | undefined, tradesHallVenue: boolean | null): boolean {
  return space?.name === "Grand Hall" && tradesHallVenue !== false;
}

/**
 * The same test for the planner's selected space, so the model, its controls
 * and its captions always agree about which room they serve.
 */
export function useModelledGrandHall(): boolean {
  const space = useEditorStore((state) => state.space);
  const tradesHall = useTradesHallVenue(space?.name === "Grand Hall" ? space.venueId : null);
  return isModelledGrandHall(space, tradesHall);
}
