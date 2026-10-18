// ---------------------------------------------------------------------------
// HallOpeningHour — the hour a plan opens the Grand Hall at
//
// A plan opened for an event (`?eventId`, the link the event carries: there
// is no layout-to-event lookup) shows the hall at the event's start, read by
// the venue's team from the event and by a client from their own shared
// schedule. Any other plan follows the clock. Renders nothing.
// ---------------------------------------------------------------------------

import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useClientEventSchedule } from "../../hooks/use-client-event-schedule.js";
import { useLinkedEvent } from "../../hooks/use-linked-event.js";
import { canReadInternalEventData, isCustomerRole } from "../../lib/event-access.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useHallTimeStore } from "../../stores/hall-time-store.js";

export function HallOpeningHour(): null {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId")?.trim() ?? "";
  const configurationId = useEditorStore((state) => state.configId);
  const venueId = useEditorStore((state) => state.venueId);
  const auth = useAuthStore();
  const staff = canReadInternalEventData(auth);
  const client = !staff && !auth.isLoading && auth.isAuthenticated && isCustomerRole(auth.user?.role);
  const linked = useLinkedEvent(venueId);
  const schedule = useClientEventSchedule(client && eventId.length > 0 ? eventId : null, {
    configurationId,
    expectedVenueId: venueId,
    enabled: client,
  });
  const startsAt = staff ? linked.graph?.event.startsAt ?? null : schedule.data?.event.startsAt ?? null;
  const eventStart = startsAt === null ? Number.NaN : Date.parse(startsAt);
  const plan = `${configurationId ?? ""}|${eventId}`;

  useEffect(() => {
    useHallTimeStore.getState().openFor(plan, Number.isFinite(eventStart) ? eventStart : null);
  }, [eventStart, plan]);

  return null;
}
