import { CalendarDays, Clock3, MapPin } from "lucide-react";
import type { ClientEventSchedule } from "@omnitwin/types";
import { Link, useLocation } from "react-router-dom";
import { ActivityStatus } from "../shared/Activity.js";
import type { useClientEventSchedule } from "../../hooks/use-client-event-schedule.js";
import { authRouteWithReturnTo } from "../../lib/auth-return.js";
import "./client-event-schedule.css";

export function scheduleTimeLabel(startsAt: string | null, durationMinutes: number, timeZone: string): string {
  if (startsAt === null) return "Time to be confirmed";
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const startDay = day.format(start);
  const endDay = day.format(end);
  return `${startDay} · ${time.format(start)}${durationMinutes === 0 ? "" : `–${endDay === startDay ? "" : `${endDay} · `}${time.format(end)}`}`;
}

export function ClientEventPhases({ data }: { readonly data: ClientEventSchedule }): React.ReactElement {
  return <>
    <p className="client-event-disclosure">Working plan · Times may change. All times are shown in {data.venue.timezone}.</p>
    {data.phases.length === 0 ? <p className="client-event-empty">Your venue team has not added the event schedule yet. You can continue planning your room.</p>
      : <ol className="client-event-phases" aria-label="Event planning schedule">
        {data.phases.map((phase, index) => <li key={phase.id}>
          <span className="client-event-phase-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <div className="client-event-phase-copy"><h3>{phase.name}</h3>
            <p><Clock3 size={14} aria-hidden="true" />{scheduleTimeLabel(phase.startsAt, phase.durationMinutes, data.venue.timezone)}</p>
            <p><MapPin size={14} aria-hidden="true" />{phase.space?.name ?? "Room to be confirmed"}</p>
          </div>
        </li>)}
      </ol>}
  </>;
}

export function ClientEventScheduleState({ result }: { readonly result: ReturnType<typeof useClientEventSchedule> }): React.ReactElement | null {
  const location = useLocation();
  if (result.status === "loaded") return null;
  if (result.status === "loading") return <ActivityStatus>Opening your event schedule…</ActivityStatus>;
  if (result.status === "none") return <p>No event is linked to this layout yet. You can keep working on your room plan.</p>;
  if (result.status === "sign-in-required") return <div className="client-event-state">
    <p>Sign in to see the event shared with your account.</p>
    <Link to={authRouteWithReturnTo("/login", location.pathname + location.search)} className="vv-button">Sign in</Link>
  </div>;
  return <div className="client-event-state" role="alert">
    <p>{result.status === "unavailable" ? "This event is not available to your account. If access has changed, ask your venue team to check it." : "Your event schedule could not be loaded. Your saved layout is unchanged."}</p>
    <button type="button" className="client-event-button" onClick={result.refresh}>Try again</button>
  </div>;
}

export function ClientEventHeading({ data }: { readonly data: ClientEventSchedule }): React.ReactElement {
  return <div className="client-event-heading">
    <p className="client-event-kicker"><CalendarDays size={15} aria-hidden="true" />Your event</p>
    <h1>{data.event.name}</h1>
    <p>{data.venue.name} <span aria-hidden="true">·</span> {data.event.guestCount.toLocaleString("en-GB")} guests</p>
  </div>;
}
