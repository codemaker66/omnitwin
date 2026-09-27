import type { ReactElement } from "react";
import type { CalendarBookingEntry } from "@omnitwin/types";
import { bookingStateLabel } from "../lib/board-overview.js";
import { BOARD_COPY } from "../board-copy.js";

/** A booking's state as the board says it, with a live hold's option in
 *  copper (roadmap N3's encoding by luminance). The words are the state label's
 *  own, so a card reads the same to a screen reader as before. */
export function BookingState({ entry }: { readonly entry: CalendarBookingEntry }): ReactElement {
  if (entry.status !== "active" || entry.kind !== "hold" || entry.rank === null) return <>{bookingStateLabel(entry)}</>;
  return <>{`${BOARD_COPY.legend.hold} · `}<span className="diary-option">{BOARD_COPY.decisions.option(entry.rank, entry.jointFlag)}</span></>;
}
