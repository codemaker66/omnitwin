import { lazy, type ReactNode } from "react";
import { useAuthStore } from "../../stores/auth-store.js";
import { canReadInternalEventData } from "../../lib/event-access.js";
import { awaitsVenue, hasRole, VENUE_FLOOR_ROLES } from "../../lib/role-capabilities.js";
import { ProtectedRoute } from "./ProtectedRoute.js";

// The router loads this route with the script every visitor loads; the staff
// shell the notice sits in is loaded only when it is shown.
const EventsNotConnected = lazy(() => import("./EventsNotConnected.js").then((module) => ({ default: module.EventsNotConnected })));

/** Internal event tools require current operational or platform authority.
 *  An account on the venue floor not connected to a venue yet is told so, as
 *  on the Day Board and the dashboard, rather than sent to ask its venue
 *  admin, who cannot connect it. */
export function InternalEventRoute({ children }: { readonly children: ReactNode }): React.ReactElement {
  const auth = useAuthStore();
  if (!auth.isLoading && auth.isAuthenticated && awaitsVenue(auth.user) && hasRole(VENUE_FLOOR_ROLES, auth.user?.role)) {
    return <EventsNotConnected />;
  }
  const allowed = canReadInternalEventData(auth);
  return <ProtectedRoute {...(allowed ? {} : { allowedRoles: [] })}>{allowed ? children : null}</ProtectedRoute>;
}
