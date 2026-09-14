import { Link, useParams } from "react-router-dom";
import { useClientEventSchedule } from "../hooks/use-client-event-schedule.js";
import { ClientEventHeading, ClientEventPhases, ClientEventScheduleState } from "../components/events/ClientEventSchedule.js";

export function ClientEventPage(): React.ReactElement {
  const { eventId } = useParams<{ eventId: string }>();
  const result = useClientEventSchedule(eventId ?? null);
  const data = result.data;
  return <main className="client-event-page"><section aria-label="Your event">
    <Link to="/" className="client-event-back">Venviewer home</Link>
    {data === null ? <><h1>Your event</h1><ClientEventScheduleState result={result} /></> : <>
      <ClientEventHeading data={data} />
      <button type="button" className="client-event-button" onClick={result.refresh} style={{ marginTop: 20 }}>Refresh schedule</button>
      <ClientEventPhases data={data} />
      <section className="client-event-layouts" aria-label="Your saved layouts"><h2>Your saved layouts</h2>
        {data.layouts.length === 0 ? <p className="client-event-empty">No saved layout has been shared with your account for this event yet. Your venue team can help connect it.</p>
          : <ul>{data.layouts.map((layout) => <li key={layout.id}><Link className="client-event-button" to={`/plan/${encodeURIComponent(layout.id)}?eventId=${encodeURIComponent(data.event.id)}`}>
            <strong>{layout.name}</strong><small>{layout.space.name} · Open layout</small>
          </Link></li>)}</ul>}
      </section>
    </>}
  </section></main>;
}
