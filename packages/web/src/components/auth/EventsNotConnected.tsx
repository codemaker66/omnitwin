import type { ReactElement } from "react";
import { DashboardLayout } from "../dashboard/DashboardLayout.js";
import { VenueNotConnected } from "../dashboard/VenueNotConnected.js";

/** What the internal event pages show an account on the venue floor that is
 *  not connected to a venue yet, in the staff shell. Loaded only when shown:
 *  the route that shows it is in the script every visitor loads, and the
 *  shell is not. */
export function EventsNotConnected(): ReactElement {
  return (
    <DashboardLayout mainLabel="Events" surface="rota">
      <VenueNotConnected title="Events" consequence="there are no events to show" />
    </DashboardLayout>
  );
}
