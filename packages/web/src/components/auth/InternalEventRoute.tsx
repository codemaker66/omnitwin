import type { ReactNode } from "react";
import { useAuthStore } from "../../stores/auth-store.js";
import { canReadInternalEventData } from "../../lib/event-access.js";
import { awaitsVenue } from "../../lib/role-capabilities.js";
import { DashboardLayout } from "../dashboard/DashboardLayout.js";
import { VenueNotConnected } from "../dashboard/VenueNotConnected.js";
import { ProtectedRoute } from "./ProtectedRoute.js";

/** Internal event tools require current operational or platform authority.
 *  A venue's own account not connected to one yet is told so, as on the Day
 *  Board and the dashboard, rather than sent to ask its venue admin, who
 *  cannot connect it. */
export function InternalEventRoute({ children }: { readonly children: ReactNode }): React.ReactElement {
  const auth = useAuthStore();
  if (!auth.isLoading && auth.isAuthenticated && awaitsVenue(auth.user)) {
    return (
      <DashboardLayout mainLabel="Events" surface="rota">
        <VenueNotConnected title="Events" consequence="there are no events to show" />
      </DashboardLayout>
    );
  }
  const allowed = canReadInternalEventData(auth);
  return <ProtectedRoute {...(allowed ? {} : { allowedRoles: [] })}>{allowed ? children : null}</ProtectedRoute>;
}
