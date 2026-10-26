import { useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useClerk } from "@clerk/react";
import type { ClientHomeEvent, ClientHomePlan } from "@omnitwin/types";
import { ActivityIndicator, ActivityStatus } from "../components/shared/Activity.js";
import { useClientHome, type ClientHomeResult } from "../hooks/use-client-home.js";
import { useAuthStore } from "../stores/auth-store.js";
import { isE2EAuthBypassEnabled } from "../lib/e2e-auth-bypass.js";
import { authRouteWithReturnTo } from "../lib/auth-return.js";
import "./ClientHomePage.css";

// ---------------------------------------------------------------------------
// The client's own home (fix-first 12, 17 October 2026).
//
// Clients and planners used to sign in to a page labelled "Staff dashboard".
// They now land here, on their own work: the event the venue has linked them
// to, first and on the forest panel, then any others, then the room plans
// they have saved. With nothing yet, the page says what will appear and
// offers the two ways forward a client actually has: plan a room, or ask the
// venue. The composition is the Enquiries desk's: sage ground, ivory sheet,
// forest panel for the one next thing, copper for the dates that matter.
// ---------------------------------------------------------------------------

export interface EventWhen {
  readonly day: string;
  readonly monthYear: string;
  readonly weekday: string;
  readonly time: string;
}

/** An event's date on the venue's own clock, or null while it has none. */
export function eventWhen(event: Pick<ClientHomeEvent, "startsAt" | "endsAt" | "venue">): EventWhen | null {
  if (event.startsAt === null) return null;
  const starts = new Date(event.startsAt);
  const timeZone = event.venue.timezone;
  const part = (options: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(starts);
  const clock = (date: Date): string => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  const time = event.endsAt === null ? clock(starts) : `${clock(starts)} to ${clock(new Date(event.endsAt))}`;
  return { day: part({ day: "numeric" }), monthYear: part({ month: "long", year: "numeric" }), weekday: part({ weekday: "long" }), time };
}

/** Over once its end, or its start when it has no end, has passed. */
export function eventIsPast(event: Pick<ClientHomeEvent, "startsAt" | "endsAt">, nowMs: number): boolean {
  const last = event.endsAt ?? event.startsAt;
  return last !== null && Date.parse(last) < nowMs;
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;
}

/** The one-line account of what the page holds. Facts only. */
export function homeSummary(upcoming: number, earlier: number, plans: number): string {
  if (upcoming === 0 && earlier === 0) {
    return plans === 0 ? "Nothing is linked to your account yet." : `No event is linked to your account yet. You have ${plural(plans, "saved plan", "saved plans")}.`;
  }
  const events = upcoming > 0 ? `${plural(upcoming, "event", "events")} coming up` : plural(earlier, "past event", "past events");
  return `${events} and ${plural(plans, "saved plan", "saved plans")}.`;
}

function savedOn(iso: string): string {
  return `Saved ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso))}`;
}

export function planHref(plan: Pick<ClientHomePlan, "id" | "eventId">): string {
  const base = `/plan/${encodeURIComponent(plan.id)}`;
  return plan.eventId === null ? base : `${base}?eventId=${encodeURIComponent(plan.eventId)}`;
}

function eventFacts(event: ClientHomeEvent, when: EventWhen | null): string {
  return [
    when === null ? null : `${when.weekday}, ${when.time}`,
    event.venue.name,
    plural(event.guestCount, "guest", "guests"),
  ].filter((fact): fact is string => fact !== null).join(" · ");
}

function DateBlock({ when }: { readonly when: EventWhen | null }): ReactElement {
  if (when === null) return <span className="client-home__date client-home__date--unset">Date not set</span>;
  return <span className="client-home__date"><span className="client-home__day">{when.day}</span><span className="client-home__month">{when.monthYear}</span></span>;
}

function NextEvent({ event }: { readonly event: ClientHomeEvent }): ReactElement {
  const when = eventWhen(event);
  return (
    <section className="client-home__next" aria-labelledby="client-home-next-title">
      <p className="client-home__next-kicker">Next</p>
      <div className="client-home__next-body">
        <DateBlock when={when} />
        <div className="client-home__next-copy">
          <h2 id="client-home-next-title">{event.name}</h2>
          <p>{eventFacts(event, when)}</p>
          <p>{event.layoutCount === 1 ? "1 of your layouts is linked to it." : `${event.layoutCount.toLocaleString("en-GB")} of your layouts are linked to it.`}</p>
        </div>
      </div>
      <Link className="client-home__cta" to={`/events/${encodeURIComponent(event.id)}`}>Open your event</Link>
    </section>
  );
}

function EventRows({ id, title, events, quiet = false }: {
  readonly id: string;
  readonly title: string;
  readonly events: readonly ClientHomeEvent[];
  readonly quiet?: boolean;
}): ReactElement | null {
  if (events.length === 0) return null;
  return (
    <section className={`client-home__section${quiet ? " client-home__section--quiet" : ""}`} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <ul className="client-home__rows">
        {events.map((event) => {
          const when = eventWhen(event);
          return (
            <li key={event.id}>
              <Link className="client-home__row" to={`/events/${encodeURIComponent(event.id)}`}>
                <DateBlock when={when} />
                <span className="client-home__row-copy">
                  <strong>{event.name}</strong>
                  <span>{eventFacts(event, when)}</span>
                </span>
                <span className="client-home__row-go" aria-hidden="true">Open</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PlanRows({ plans, planTotal, events }: {
  readonly plans: readonly ClientHomePlan[];
  readonly planTotal: number;
  readonly events: readonly ClientHomeEvent[];
}): ReactElement {
  const eventNames = new Map(events.map((event) => [event.id, event.name]));
  return (
    <section className="client-home__section" aria-labelledby="client-home-plans">
      <div className="client-home__section-head">
        <h2 id="client-home-plans">Your room plans</h2>
        <Link className="client-home__quiet" to="/plan?new=1">Start a new plan</Link>
      </div>
      {plans.length === 0
        ? <p className="client-home__note">You have not saved a room plan yet.</p>
        : <ul className="client-home__rows">
          {plans.map((plan) => {
            const eventName = plan.eventId === null ? null : eventNames.get(plan.eventId) ?? null;
            return (
              <li key={plan.id}>
                <Link className="client-home__row client-home__row--plan" to={planHref(plan)}>
                  <span className="client-home__row-copy">
                    <strong>{plan.name}</strong>
                    <span>{plan.space.name} · {plan.venue.name}{eventName === null ? "" : ` · For ${eventName}`}</span>
                  </span>
                  <span className="client-home__saved">{savedOn(plan.updatedAt)}</span>
                </Link>
              </li>
            );
          })}
        </ul>}
      {planTotal > plans.length && <p className="client-home__note">Showing your {plans.length.toLocaleString("en-GB")} most recently saved plans of {planTotal.toLocaleString("en-GB")}.</p>}
    </section>
  );
}

function NothingYet(): ReactElement {
  return (
    <section className="client-home__next client-home__next--empty" aria-labelledby="client-home-empty-title">
      <h2 id="client-home-empty-title">When the venue links your event, it opens here</h2>
      <p>Its timings, your layouts and your questions to the venue team sit together on one page. Until then, you can plan a room or send the venue an enquiry.</p>
      <div className="client-home__actions">
        <Link className="client-home__cta" to="/plan">Plan a room</Link>
        <Link className="client-home__cta client-home__cta--secondary" to="/#enquire">Send an enquiry</Link>
      </div>
    </section>
  );
}

function ClerkSignOut({ onLocalSignOut }: { readonly onLocalSignOut: () => void }): ReactElement {
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const handle = async (): Promise<void> => {
    setSigningOut(true);
    setFailed(false);
    try {
      onLocalSignOut();
      await signOut({ redirectUrl: "/login" });
    } catch {
      setFailed(true);
    } finally {
      setSigningOut(false);
    }
  };
  return (
    <>
      <button type="button" className="client-home__signout" disabled={signingOut} aria-busy={signingOut} onClick={() => { void handle(); }}>
        {signingOut && <ActivityIndicator size={16} />}
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
      {failed && <p role="alert" className="client-home__bar-alert">Sign out did not finish. Please try again.</p>}
    </>
  );
}

/** Under the E2E auth bypass there is no Clerk provider to ask. */
function LocalSignOut({ onLocalSignOut }: { readonly onLocalSignOut: () => void }): ReactElement {
  const navigate = useNavigate();
  return <button type="button" className="client-home__signout" onClick={() => { onLocalSignOut(); void navigate("/login"); }}>Sign out</button>;
}

function HomeBody({ result }: { readonly result: ClientHomeResult }): ReactElement {
  if (result.status === "loading") {
    return <ActivityStatus variant="panel" className="client-home__activity">Opening your events…</ActivityStatus>;
  }
  if (result.status === "sign-in-required") {
    return (
      <div className="client-home__notice">
        <p>Sign in to see your events and plans.</p>
        <Link className="client-home__cta" to={authRouteWithReturnTo("/login", "/events")}>Sign in</Link>
      </div>
    );
  }
  if (result.status === "error" || result.data === null) {
    return (
      <div className="client-home__notice" role="alert">
        <p>Your events could not be loaded just now. Nothing on them has changed.</p>
        <button type="button" className="client-home__cta" onClick={result.refresh}>Try again</button>
      </div>
    );
  }
  const { events, plans, planTotal } = result.data;
  const nowMs = Date.now();
  const upcoming = events.filter((event) => !eventIsPast(event, nowMs));
  // Earlier events read newest first: the one just gone is the one wanted.
  const earlier = events.filter((event) => eventIsPast(event, nowMs)).reverse();
  const [next, ...later] = upcoming;
  return (
    <>
      <p className="client-home__summary">{homeSummary(upcoming.length, earlier.length, planTotal)}</p>
      {next !== undefined && <NextEvent event={next} />}
      {events.length === 0 && <NothingYet />}
      <EventRows id="client-home-coming-up" title="Coming up" events={later} />
      <EventRows id="client-home-earlier" title="Earlier" events={earlier} quiet />
      {(plans.length > 0 || events.length > 0) && <PlanRows plans={plans} planTotal={planTotal} events={events} />}
      {events.length > 0 && <p className="client-home__provenance">Dates, times and guest numbers are as the venue team holds them.</p>}
    </>
  );
}

export function ClientHomePage(): ReactElement {
  const result = useClientHome();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  return (
    <main className="client-home" aria-labelledby="client-home-title">
      <div className="client-home__sheet">
        {/* On the sheet, not the ground: the sage ground never carries text. */}
        <div className="client-home__bar">
          <Link className="client-home__mark" to="/">Venviewer</Link>
          {user !== null && <div className="client-home__account">
            <span>{user.name}</span>
            {isE2EAuthBypassEnabled() ? <LocalSignOut onLocalSignOut={logout} /> : <ClerkSignOut onLocalSignOut={logout} />}
          </div>}
        </div>
        <h1 id="client-home-title">Your events</h1>
        <HomeBody result={result} />
      </div>
    </main>
  );
}
