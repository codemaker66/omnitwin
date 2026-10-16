import type { Space } from "../../../../api/spaces.js";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { useEditorStore } from "../../../../stores/editor-store.js";

// ---------------------------------------------------------------------------
// Who is looking at the planner, and which room is open — the two inputs the
// honest-numbers lenses read through usePlannerTruth. Test files mock
// hooks/use-trades-hall-venue.js themselves (vi.mock is per file) and use these
// to set the viewer and the room.
// ---------------------------------------------------------------------------

export const TRADES_HALL_VENUE_ID = "venue-trades-hall";

export function plannerRoom(slug = "grand-hall", name = "Grand Hall", venueId = TRADES_HALL_VENUE_ID): Space {
  return {
    id: `space-${slug}`,
    venueId,
    name,
    slug,
    widthM: "21",
    lengthM: "10.5",
    heightM: "7",
    floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
  };
}

/** A member of the venue's floor team at its own venue. */
export function viewAsStaff(role = "staff"): void {
  useAuthStore.setState({
    user: { id: "user-staff", email: "staff@example.com", name: "Staff", role, platformRole: "none", venueId: TRADES_HALL_VENUE_ID },
    isAuthenticated: true,
    isLoading: false,
    accessStatus: "ready",
  });
}

/** A signed-in client: the venue's customer, never staff. */
export function viewAsClient(): void {
  useAuthStore.setState({
    user: { id: "user-client", email: "client@example.com", name: "Client", role: "client", platformRole: "none", venueId: null },
    isAuthenticated: true,
    isLoading: false,
    accessStatus: "ready",
  });
}

/** A visitor on the public planner: nobody signed in. */
export function viewAsVisitor(): void {
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, accessStatus: "signed_out" });
}

export function openRoom(space: Space | null): void {
  useEditorStore.setState({ space, venueId: space?.venueId ?? null, configId: space === null ? null : "config-1" });
}

export function resetPlannerTruth(): void {
  viewAsVisitor();
  openRoom(null);
}
