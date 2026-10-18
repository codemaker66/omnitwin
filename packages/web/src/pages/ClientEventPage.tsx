import { Link, useParams } from "react-router-dom";
import { useClientEventSchedule } from "../hooks/use-client-event-schedule.js";
import { ClientEventHeading, ClientEventPhases, ClientEventScheduleState } from "../components/events/ClientEventSchedule.js";
import { ClientRequests } from "../components/events/ClientRequests.js";
import { useAuthStore } from "../stores/auth-store.js";
import { CLIENT_SIDE_ROLES, hasRole } from "../lib/role-capabilities.js";
import { CLIENT_HOME_ROUTE } from "../lib/role-routing.js";

export function ClientEventPage(): React.ReactElement {
  const { eventId } = useParams<{ eventId: string }>();
  const result = useClientEventSchedule(eventId ?? null);
  // The client's side goes back to their own events; anyone else to the front door.
  const clientSide = useAuthStore((state) => hasRole(CLIENT_SIDE_ROLES, state.user?.role));
  const data = result.data;
  return <main className="client-event-page"><section aria-label="Your event">
    {clientSide
      ? <Link to={CLIENT_HOME_ROUTE} className="client-event-back">All your events</Link>
      : <Link to="/" className="client-event-back">Venviewer home</Link>}
    {data === null ? <><h1>Your event</h1><ClientEventScheduleState result={result} /></> : <>
      <ClientEventHeading data={data} />
      <button type="button" className="client-event-button" onClick={result.refresh} style={{ marginTop: 20 }}>Refresh schedule</button>
      <ClientEventPhases data={data} />
      {/* Goal 19 S4: the client asks the house about a slot from here. */}
      <ClientRequests eventId={data.event.id} slots={data.slots} timeZone={data.venue.timezone} />
      <section className="client-event-layouts" aria-label="Your saved layouts"><h2>Your saved layouts</h2>
        {data.layouts.length === 0 ? <p className="client-event-empty">No saved layout has been shared with your account for this event yet. Your venue team can help connect it.</p>
          : <ul>{data.layouts.map((layout) => <li key={layout.id}><Link className="client-event-button" to={`/plan/${encodeURIComponent(layout.id)}?eventId=${encodeURIComponent(data.event.id)}`}>
            <strong>{layout.name}</strong><small>{layout.space.name} · Open layout</small>
          </Link></li>)}</ul>}
      </section>
    </>}
  </section></main>;
}
