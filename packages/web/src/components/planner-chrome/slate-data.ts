import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { CalendarBookingEntry, EventPhaseGraph } from "@omnitwin/types";
import { getCalendar } from "../../api/diary.js";
import { useClientEventSchedule } from "../../hooks/use-client-event-schedule.js";
import { useLinkedEvent } from "../../hooks/use-linked-event.js";
import { canReadInternalEventData, isCustomerRole } from "../../lib/event-access.js";
import { eventHoldWords } from "../../lib/slate-facts.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useEditorStore } from "../../stores/editor-store.js";

// ---------------------------------------------------------------------------
// What the slate knows about the event this layout serves (T-671 slice 7),
// as far as the person may read it: staff through the event's graph, a client
// through their own schedule, a guest not at all (the slate then names only
// the room). The hold is staff-only: clients never see the Diary's terms.
// ---------------------------------------------------------------------------

export interface SlateEvent {
  readonly id: string;
  readonly name: string;
  readonly startsAt: string | null;
  readonly guestCount: number | null;
  /** The venue's zone, when the read carried it. */
  readonly timeZone: string | null;
  /** The event's own layouts, as the client's schedule lists them. */
  readonly layouts: readonly { readonly id: string; readonly name: string; readonly spaceName: string }[];
}

export interface SlateAudience {
  readonly event: SlateEvent | null;
  /** Staff only: the event's acts and which layout each reads. */
  readonly graph: EventPhaseGraph | null;
  /** Venue staff: the hold chip, the Diary and each act's layout. */
  readonly staff: boolean;
  /** Signed in: the planner keeps their layouts; a guest keeps a draft. */
  readonly signedIn: boolean;
  /** The event the address names, whether or not it could be read. */
  readonly eventId: string | null;
}

export function useSlateAudience(): SlateAudience {
  const venueId = useEditorStore((state) => state.venueId);
  const configId = useEditorStore((state) => state.configId);
  const auth = useAuthStore();
  const staff = canReadInternalEventData(auth);
  const customer = !staff && !auth.isLoading && auth.isAuthenticated && isCustomerRole(auth.user?.role);
  const [searchParams] = useSearchParams();
  const requested = searchParams.get("eventId")?.trim() ?? "";
  const eventId = requested.length === 0 ? null : requested;
  const linked = useLinkedEvent(venueId);
  const schedule = useClientEventSchedule(eventId, { configurationId: configId, expectedVenueId: venueId, enabled: customer });

  let event: SlateEvent | null = null;
  if (staff && linked.graph !== null) {
    const { event: graphEvent } = linked.graph;
    event = { id: graphEvent.id, name: graphEvent.name, startsAt: graphEvent.startsAt, guestCount: graphEvent.guestCount, timeZone: null, layouts: [] };
  } else if (customer && schedule.data !== null) {
    const { event: own, venue, layouts } = schedule.data;
    event = {
      id: own.id, name: own.name, startsAt: own.startsAt, guestCount: own.guestCount, timeZone: venue.timezone,
      layouts: layouts.map((layout) => ({ id: layout.id, name: layout.name, spaceName: layout.space.name })),
    };
  }
  return { event, graph: staff ? linked.graph : null, staff, signedIn: !auth.isLoading && auth.isAuthenticated, eventId };
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface HoldRead {
  readonly key: string;
  readonly words: string | null;
}

/**
 * The hold chip's words for this event, read from the Diary around its day
 * (staff only). A failed read shows no chip rather than a guess; the Diary
 * itself stays the place to see the booking.
 */
export function useEventHold(venueId: string | null, event: SlateEvent | null, enabled: boolean): string | null {
  const startsAt = event?.startsAt ?? null;
  const eventId = event?.id ?? null;
  const key = !enabled || venueId === null || eventId === null || startsAt === null ? null : JSON.stringify([venueId, eventId, startsAt]);
  const [read, setRead] = useState<HoldRead | null>(null);
  useEffect(() => {
    if (key === null || venueId === null || eventId === null || startsAt === null) return;
    const controller = new AbortController();
    const at = Date.parse(startsAt);
    getCalendar(venueId, new Date(at - DAY_MS).toISOString(), new Date(at + DAY_MS).toISOString(), controller.signal)
      .then((calendar) => {
        const bookings = calendar.entries.filter((entry): entry is CalendarBookingEntry => entry.entryType === "booking");
        setRead({ key, words: eventHoldWords(bookings, eventId) });
      })
      .catch(() => { if (!controller.signal.aborted) setRead({ key, words: null }); });
    return () => { controller.abort(); };
  }, [eventId, key, startsAt, venueId]);
  return read !== null && read.key === key ? read.words : null;
}
