import { useEffect, useState } from "react";
import type { BookingKind } from "@omnitwin/types";
import { resolveEventLinkedLayouts, type LinkedLayoutChoice } from "../../../lib/event-linked-layouts.js";
import { describeSlotSheet, type SlotSheetState } from "./day-board-sheet.js";

// ---------------------------------------------------------------------------
// The setup-sheet door of a slot: which layout of its event serves its room.
// Shared by the slot's own sheet link and the changeover, which needs the
// layout of the booking before it as well.
// ---------------------------------------------------------------------------

export interface SlotSheetResult {
  readonly status: "loading" | "ready" | "error";
  readonly state: SlotSheetState | null;
  readonly error: string | null;
}

/**
 * Resolve the slot's setup-sheet door. One resolution per event+room; the
 * `isCurrent` guard is the same superseded-request discipline the planner
 * bootstrap uses, so a board that rolls over midnight (or a room filter
 * change) can never paint a stale room's layouts onto a slot.
 */
export function useSlotSheet(eventId: string | null, roomSlug: string, roomName: string, bookingKind: BookingKind): SlotSheetResult {
  const [layouts, setLayouts] = useState<readonly LinkedLayoutChoice[] | null>(null);
  const [unavailable, setUnavailable] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (eventId === null) {
      setLayouts([]);
      setUnavailable(0);
      setError(null);
      return;
    }
    let current = true;
    setLayouts(null);
    setError(null);
    void resolveEventLinkedLayouts({ eventId, spaceSlug: roomSlug, isCurrent: () => current })
      .then((resolved) => {
        if (!current) return;
        setLayouts(resolved.layouts);
        setUnavailable(resolved.unavailableCount);
      })
      .catch(() => {
        if (!current) return;
        setError("The setup sheet link could not be checked.");
      });
    return () => { current = false; };
  }, [eventId, roomSlug]);

  if (error !== null) return { status: "error", state: null, error };
  if (layouts === null) return { status: "loading", state: null, error: null };
  return {
    status: "ready",
    state: describeSlotSheet({ eventId, bookingKind, roomName, layouts, unavailableCount: unavailable }),
    error: null,
  };
}
