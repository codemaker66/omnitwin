import { useCallback, useMemo } from "react";
import { TRADES_HALL_PUBLIC_PROFILE } from "@omnitwin/types";
import { useAuthStore } from "../stores/auth-store.js";
import { useEditorStore } from "../stores/editor-store.js";
import {
  plannerViewerIsVenueStaff,
  publishedCapacityFor,
  type PlannerRoomIdentity,
  type PublishedCapacityAnswer,
} from "../lib/planner-truth.js";
import { askFor, type AskAction, type AskTopic } from "../lib/unrecorded-ask.js";
import { useTradesHallVenueStatus } from "./use-trades-hall-venue.js";

// ---------------------------------------------------------------------------
// usePlannerTruth — who is looking, which room is open, and what the venue
// has actually stated about it.
//
// Staff builds on the planner's existing gate, canReadInternalEventData (the
// venue's floor: admin, manager, staff, hallkeeper; or a platform
// administrator), the same check PlannerCockpit uses to show booking time,
// narrowed to the venue whose room is open (plannerViewerIsVenueStaff).
// Everyone else (a client, a planner, a visitor, another venue's team) sees
// only stated figures.
// ---------------------------------------------------------------------------

export interface PlannerTruth {
  /** The viewer is on this venue's floor team (or administers the platform). */
  readonly staff: boolean;
  /** The open room's display name, e.g. "Grand Hall", or null before it loads. */
  readonly roomName: string | null;
  /** The venue's published capacity for the open room. */
  readonly published: PublishedCapacityAnswer;
  /** The venue's published enquiry address when it publishes one. */
  readonly venueEmail: string | null;
  /** The named person to ask about a fact nobody recorded. */
  readonly ask: (topic: AskTopic) => AskAction;
}

export function usePlannerTruth(): PlannerTruth {
  const space = useEditorStore((state) => state.space);
  const editorVenueId = useEditorStore((state) => state.venueId);
  const configId = useEditorStore((state) => state.configId);
  const spaceLoadFailed = useEditorStore((state) => state.spaceLoadFailed);
  const venueId = space?.venueId ?? editorVenueId;
  const staff = useAuthStore((auth) => plannerViewerIsVenueStaff(auth, venueId));
  const venueStatus = useTradesHallVenueStatus(venueId);

  const room = useMemo((): PlannerRoomIdentity | null | "reading" => {
    // The room is still being read only while its read is in flight; a failed
    // read ends the working state and the honest "not recorded" view shows.
    if (space === null) return venueId !== null && !spaceLoadFailed ? "reading" : null;
    return {
      slug: space.slug,
      tradesHall: venueStatus === "reading" ? null : venueStatus === "trades-hall",
    };
  }, [space, venueId, venueStatus, spaceLoadFailed]);

  const published = useMemo(
    (): PublishedCapacityAnswer => (room === "reading" ? { kind: "reading" } : publishedCapacityFor(room)),
    [room],
  );

  const venueEmail = venueStatus === "trades-hall" ? TRADES_HALL_PUBLIC_PROFILE.email : null;
  const roomName = space?.name ?? null;
  const planUrl = configId !== null && typeof window !== "undefined"
    ? `${window.location.origin}/plan/${configId}`
    : null;

  const ask = useCallback(
    (topic: AskTopic): AskAction => askFor(topic, {
      audience: staff ? "staff" : "guest",
      roomName,
      venueEmail,
      planUrl,
    }),
    [staff, roomName, venueEmail, planUrl],
  );

  return { staff, roomName, published, venueEmail, ask };
}
