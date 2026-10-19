import { type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { RoomLayoutTimelineDock } from "./RoomLayoutTimelineDock.js";
import { ClientEventScheduleDock } from "./ClientEventScheduleDock.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { canReadInternalEventData } from "../../../lib/event-access.js";
import "./CockpitBottom.css";

/**
 * Whether the client-side schedule card has anything for this person.
 *
 * A signed-in account keeps it: it shows their event's schedule, or says no
 * event is linked to the layout yet. A visitor who arrived by an event link
 * keeps it too, because it tells them to sign in to see that schedule. A
 * visitor with neither has nothing to act on: "No event linked to this
 * layout" only took the bottom of their phone screen, so they see the room.
 * While the sign-in check is still running, nothing is shown yet, so a
 * visitor never sees the card appear and vanish.
 */
export function showsClientEventSchedule(
  auth: { readonly isLoading: boolean; readonly isAuthenticated: boolean },
  eventId: string | null,
): boolean {
  if (eventId !== null && eventId.trim().length > 0) return true;
  return !auth.isLoading && auth.isAuthenticated;
}

/** Production bottom dock for browsing immutable room-layout keyframes. */
export function CockpitBottom({ initiallyCollapsed = false }: { readonly initiallyCollapsed?: boolean }): ReactElement | null {
  const auth = useAuthStore();
  const [searchParams] = useSearchParams();
  if (canReadInternalEventData(auth)) return <RoomLayoutTimelineDock initiallyCollapsed={initiallyCollapsed} />;
  if (!showsClientEventSchedule(auth, searchParams.get("eventId"))) return null;
  return <ClientEventScheduleDock initiallyCollapsed={initiallyCollapsed} />;
}
