import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/auth-store.js";
import { resolveEventLinkedLayouts, type EventLinkedLayouts } from "../../lib/event-linked-layouts.js";
import { ActivityStatus } from "../shared/Activity.js";

interface Props {
  readonly eventId: string;
  readonly venueSlug?: string;
  readonly spaceSlug: string | null;
  readonly carriedSearch: string;
}
interface Result {
  readonly key: string;
  readonly data: EventLinkedLayouts | null;
  readonly failed: boolean;
}
function authKey(state: ReturnType<typeof useAuthStore.getState>): string {
  return JSON.stringify([state.isLoading, state.isAuthenticated, state.user?.id,
    state.user?.venueId, state.user?.role, state.user?.platformRole]);
}

/** Event links resolve their own saved plans; they never enter anonymous bootstrap. */
export function EventLinkedPlannerBootstrap({ eventId, venueSlug, spaceSlug, carriedSearch }: Props): ReactElement {
  const auth = useAuthStore();
  const authorizationKey = authKey(auth);
  const navigate = useNavigate();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const requestKey = JSON.stringify([eventId, venueSlug, spaceSlug, carriedSearch, authorizationKey, retry]);
  const latestKey = useRef(requestKey);
  useLayoutEffect(() => { latestKey.current = requestKey; }, [requestKey]);
  const search = carriedSearch.length === 0 ? "" : `?${carriedSearch}`;

  useEffect(() => {
    if (auth.isLoading || !auth.isAuthenticated || auth.user === null) return;
    let cancelled = false;
    const isCurrent = (): boolean => !cancelled && latestKey.current === requestKey
      && authKey(useAuthStore.getState()) === authorizationKey;
    setResult(null);
    void resolveEventLinkedLayouts({ eventId, venueSlug, spaceSlug, isCurrent })
      .then((data) => {
        if (!isCurrent()) return;
        setResult({ key: requestKey, data, failed: false });
        const single = data.layouts.length === 1 ? data.layouts[0] : undefined;
        if (single !== undefined) void navigate({ pathname: `/plan/${single.configurationId}`, search }, { replace: true });
      })
      .catch(() => {
        if (isCurrent()) setResult({ key: requestKey, data: null, failed: true });
      });
    return () => { cancelled = true; };
  }, [auth.isAuthenticated, auth.isLoading, auth.user, authorizationKey, eventId, navigate, requestKey, search, spaceSlug, venueSlug]);

  const current = result?.key === requestKey ? result : null;
  const data = current?.data ?? null;
  const openChoice = (configurationId: string): void => {
    if (latestKey.current !== requestKey || authKey(useAuthStore.getState()) !== authorizationKey || current === null
      || current.data === null || !current.data.layouts.some((layout) => layout.configurationId === configurationId)) return;
    void navigate({ pathname: `/plan/${configurationId}`, search }, { replace: true });
  };
  const opsPath = `/ops/events/${encodeURIComponent(eventId)}`;

  return <main className="vv-route-state" aria-label="Event layout selection">
    <section className="vv-state-panel" aria-labelledby="event-layout-heading">
      <p className="vv-state-kicker">Event planner</p>
      {auth.isLoading ? <>
        <h1 id="event-layout-heading">Opening the event's layouts</h1>
        <ActivityStatus>Checking your account…</ActivityStatus>
      </> : !auth.isAuthenticated || auth.user === null ? <>
        <h1 id="event-layout-heading">Sign in to open this event's layouts</h1>
        <p>This link opens saved venue plans. Sign in, then return to the event link.</p>
        <Link className="vv-button primary" to="/login">Sign in</Link>
      </> : current?.failed === true ? <>
        <h1 id="event-layout-heading">Could not open this event's layouts</h1>
        <p role="alert">We could not verify this event's saved layouts, room and access. Retry or return to your workspace.</p>
        <div className="vv-state-actions"><button className="vv-button primary" type="button" onClick={() => { setRetry((value) => value + 1); }}>Retry</button><Link className="vv-button" to="/dashboard">Return to workspace</Link></div>
      </> : data === null || data.layouts.length === 1 ? <>
        <h1 id="event-layout-heading">Opening the event's layouts</h1>
        <ActivityStatus>Checking linked saved layouts…</ActivityStatus>
      </> : <>
        <h1 id="event-layout-heading">{data.layouts.length === 0 ? "No linked layout for this room" : "Choose a saved layout"}</h1>
        <p>{data.eventName}{data.roomName === null ? "" : ` · ${data.roomName}`}</p>
        {data.layouts.length === 0 ? <p>No accessible saved layout is linked to this event{data.roomName === null ? "" : " in this room"}. Review the event operations or ask a venue planner to link a saved layout.</p> : <>
          <p>This event has several saved layouts. Choose the one you want to open.</p>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
            {data.layouts.map((layout) => <li key={layout.configurationId}>
              <button className="vv-button" type="button" aria-label={`Open ${layout.name}`} onClick={() => { openChoice(layout.configurationId); }}
                style={{ width: "100%", whiteSpace: "normal", textAlign: "left", display: "grid", gap: 4 }}>
                <strong>{layout.name}</strong><span>{layout.spaceName}</span>
              </button>
            </li>)}
          </ul>
        </>}
        {data.unavailableCount > 0 && <p>Some linked layouts are unavailable to this account.</p>}
        <div className="vv-state-actions"><Link className="vv-button" to={opsPath}>Open event operations</Link><button className="vv-button" type="button" onClick={() => { setRetry((value) => value + 1); }}>Check again</button></div>
      </>}
    </section>
  </main>;
}
