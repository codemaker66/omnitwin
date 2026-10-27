import { useId, useMemo, useState, type ReactElement } from "react";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { useDoorClearSpaceStore } from "../../../stores/door-clear-space-store.js";
import { doorKeepOuts } from "../../../lib/door-clear-spaces.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { RENDER_SCALE } from "../../../constants/scale.js";
import type { PlacedItem } from "../../../lib/placement.js";
import { countLabel } from "../../../lib/count-label.js";
import { publishedFigureLine, type PublishedFigure } from "../../../lib/auto-fill.js";
import {
  seatShortfallActionLabel,
  seatShortfallDetail,
  seatShortfallDoneLine,
  seatShortfallOffer,
} from "../../../lib/seat-shortfall.js";
import type { AskAction } from "../../../lib/unrecorded-ask.js";
import "./AutoFill.css";

// ---------------------------------------------------------------------------
// SeatShortfallFix — one tap for "Short 16 seats for 80 guests".
//
// Beside the lens line that says the floor is short of seats, one action:
// "Add 16 chairs at the tables", or "Add tables for 16" once the tables are
// full (lib/seat-shortfall). What it will do is said under it before the tap;
// what it did is said after, for as long as the layout is the one it made.
// It runs through the placement store in one step, so Undo takes it back like
// any placement. When neither fits, it says so and offers the person to ask.
// ---------------------------------------------------------------------------

export interface SeatShortfallFixProps {
  readonly testId: string;
  /** Also say the shortfall itself, where the surface does not already. */
  readonly statement?: boolean;
  /** The venue's published figure for the layout, said when nothing fits. */
  readonly published?: PublishedFigure | null;
  /** The person to ask when nothing fits, or null when another line on the
   *  surface already carries that ask. */
  readonly ask?: AskAction | null;
}

interface Done {
  readonly line: string;
  /** The layout the fix produced; the line shows only while it stands. */
  readonly after: readonly PlacedItem[];
}

export function SeatShortfallFix({ testId, statement = false, published = null, ask = null }: SeatShortfallFixProps): ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  // The open room's doors, as the placement store keeps them when it applies the fix.
  const doorSpaces = useDoorClearSpaceStore((state) => state.spaces);
  const guests = useCockpitStore((state) => state.plannedGuestCount);
  const [done, setDone] = useState<Done | null>(null);
  const detailId = useId();

  const offer = useMemo(
    () => seatShortfallOffer({
      placedItems,
      guests,
      roomWidthM: dimensions.width / RENDER_SCALE,
      roomLengthM: dimensions.length / RENDER_SCALE,
      doorSpaces: doorKeepOuts(doorSpaces),
    }),
    [placedItems, guests, dimensions, doorSpaces],
  );
  const label = offer === null ? null : seatShortfallActionLabel(offer);
  const doneLine = done !== null && done.after === placedItems ? done.line : "";

  const apply = (): void => {
    if (guests === null) return;
    const fix = usePlacementStore.getState().fillSeatShortfall(guests);
    if (fix === null) return;
    setDone({ line: seatShortfallDoneLine(fix.offer), after: usePlacementStore.getState().placedItems });
  };

  return (
    <div className="seat-fix" data-testid={testId}>
      {offer !== null && statement && (
        <p className="seat-fix__statement" data-testid={`${testId}-statement`}>
          {countLabel(offer.short, "seat")} short of {countLabel(offer.guests, "guest")}.
        </p>
      )}
      {offer !== null && label !== null && (
        <>
          <button
            type="button"
            className="lens-panel__button seat-fix__action"
            onClick={apply}
            aria-describedby={detailId}
            data-testid={`${testId}-action`}
          >
            {label}
          </button>
          <p id={detailId} className="seat-fix__detail" data-testid={`${testId}-detail`}>{seatShortfallDetail(offer)}</p>
        </>
      )}
      {offer?.kind === "no-room" && (
        <>
          <p className="seat-fix__detail" data-testid={`${testId}-no-room`}>
            {seatShortfallDetail(offer)}{published !== null ? ` ${publishedFigureLine(published)}` : ""}
          </p>
          {ask !== null && (ask.href !== null ? (
            <a className="lens-panel__ask" href={ask.href} data-testid={`${testId}-ask`}>{ask.label}</a>
          ) : (
            <span className="lens-panel__unrecorded-hint" data-testid={`${testId}-ask`}>{ask.fallback}</span>
          ))}
        </>
      )}
      <p className="seat-fix__done" role="status" aria-live="polite" data-testid={`${testId}-done`}>{doneLine}</p>
    </div>
  );
}
