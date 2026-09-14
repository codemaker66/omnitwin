import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronDown, ChevronUp } from "lucide-react";
import { useClientEventSchedule } from "../../../hooks/use-client-event-schedule.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { customerEventPath } from "../../../lib/event-access.js";
import { ClientEventPhases, ClientEventScheduleState } from "../../events/ClientEventSchedule.js";
import { ActivityStatus } from "../../shared/Activity.js";

export function ClientEventScheduleDock({ initiallyCollapsed = false }: { readonly initiallyCollapsed?: boolean }): React.ReactElement {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId");
  const configurationId = useEditorStore((state) => state.configId);
  const expectedVenueId = useEditorStore((state) => state.venueId);
  const result = useClientEventSchedule(eventId, { configurationId, expectedVenueId });
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  return <footer className={`cockpit-bottom client-event-dock${collapsed ? " is-collapsed" : ""}`} aria-label="Your event schedule">
    <div className="client-event-dock__header">
      <div className="client-event-dock__identity"><CalendarDays size={21} aria-hidden="true" /><div>
        <strong>{result.data?.event.name ?? "Your event schedule"}</strong>
        <small>{result.data !== null ? "Planning schedule · Working plan" : result.status === "none" ? "No event linked to this layout"
          : result.status === "loading" ? collapsed ? <ActivityStatus>Opening your schedule…</ActivityStatus> : "Your room plan"
            : result.status === "sign-in-required" ? "Sign in to view your schedule" : "Schedule unavailable · open for details"}</small>
      </div></div>
      <div className="client-event-dock__actions">
        {result.data !== null && eventId !== null && <Link to={customerEventPath(eventId)}>Event details</Link>}
        <button type="button" className="client-event-button" aria-expanded={!collapsed} aria-label={collapsed ? "Show event schedule" : "Hide event schedule"} onClick={() => { setCollapsed((value) => !value); }}>
          {collapsed ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
        </button>
      </div>
    </div>
    {!collapsed && <div className="client-event-dock__body">
      <ClientEventScheduleState result={result} />
      {result.data !== null && <ClientEventPhases data={result.data} />}
    </div>}
  </footer>;
}
