import { useEffect, useId, useMemo, useState, type ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { PLAN_VIEW_LINK_DAYS, PlanViewTokenSchema, type PlanView } from "@omnitwin/types";
import { ApiError } from "../api/client.js";
import { fetchPlanView, planViewPdfUrl } from "../api/plan-view.js";
import { ActivityStatus } from "../components/shared/Activity.js";
import {
  describePlanItems,
  drawPlanView,
  formatDateInVenueClock,
  formatInVenueClock,
  pointsAttribute,
  type PlanViewDrawing,
} from "../lib/plan-view-drawing.js";
import "./PlanViewPage.css";

// ---------------------------------------------------------------------------
// A visitor's plan through a view-only link (fix-first item 11, 16 Oct 2026
// brief). Public: the token in the address is the only capability, and it
// can only read.
//
// Who opens this: a partner, a boss or a parent the organiser sent it to,
// most often on a phone, from a message. So it is one calm ivory sheet: the
// room, who drew the plan and when it last changed (truth before anything
// else), the plan to scale, what is on it, a PDF to keep, and the way on
// (the venue's events team confirms prices, dates and what the room holds).
// It shows no price, no planner address and nothing that edits.
// ---------------------------------------------------------------------------

type LoadState =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly view: PlanView }
  | { readonly phase: "not-working" }
  | { readonly phase: "error" };

const PAGE_TITLE = "View-only plan";

/** A private page: never indexed, and its address never sent on as a referrer. */
function usePrivatePageHead(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(() => {
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    const referrer = document.createElement("meta");
    referrer.name = "referrer";
    referrer.content = "no-referrer";
    document.head.append(robots, referrer);
    return () => { robots.remove(); referrer.remove(); };
  }, []);
}

export function PlanViewPage(): ReactElement {
  const { token = "" } = useParams<{ token: string }>();
  const wellFormed = PlanViewTokenSchema.safeParse(token).success;
  const [loaded, setLoaded] = useState<{ readonly token: string; readonly state: LoadState } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!wellFormed) return undefined;
    const controller = new AbortController();
    fetchPlanView(token, controller.signal).then(
      (view) => { if (!controller.signal.aborted) setLoaded({ token, state: { phase: "ready", view } }); },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const notWorking = error instanceof ApiError && error.status === 404;
        setLoaded({ token, state: { phase: notWorking ? "not-working" : "error" } });
      },
    );
    return () => { controller.abort(); };
  }, [token, wellFormed, attempt]);

  const state: LoadState = !wellFormed
    ? { phase: "not-working" }
    : loaded?.token === token ? loaded.state : { phase: "loading" };

  usePrivatePageHead(state.phase === "ready"
    ? `${state.view.roomName} plan — ${state.view.venueName}`
    : PAGE_TITLE);

  return (
    <div className="plan-view" data-theme="light">
      <main className="plan-view__sheet" data-testid="plan-view">
        {state.phase === "loading" && (
          <div className="plan-view__waiting">
            <ActivityStatus variant="panel">Opening the plan…</ActivityStatus>
          </div>
        )}
        {state.phase === "not-working" && <NotWorking />}
        {state.phase === "error" && (
          <section className="plan-view__notice" data-testid="plan-view-error">
            <p className="plan-view__eyebrow">{PAGE_TITLE}</p>
            <h1 className="plan-view__title">The plan couldn&apos;t be opened</h1>
            <p className="plan-view__text">Check the connection and try again. The link itself has not changed.</p>
            <div className="plan-view__actions">
              <button type="button" className="plan-view__button" onClick={() => { setLoaded(null); setAttempt((n) => n + 1); }}>
                Try again
              </button>
            </div>
          </section>
        )}
        {state.phase === "ready" && <PlanSheet view={state.view} token={token} />}
      </main>
    </div>
  );
}

function NotWorking(): ReactElement {
  return (
    <section className="plan-view__notice" data-testid="plan-view-not-working">
      <p className="plan-view__eyebrow">{PAGE_TITLE}</p>
      <h1 className="plan-view__title">This link is not working</h1>
      <p className="plan-view__text">
        The person who sent it may have stopped it, or its {String(PLAN_VIEW_LINK_DAYS)} days may have run out.
        They can send you a fresh one.
      </p>
      <div className="plan-view__actions">
        <Link className="plan-view__button" to="/#enquire">Ask about a date</Link>
        <Link className="plan-view__button plan-view__button--quiet" to="/">Go to the front door</Link>
      </div>
    </section>
  );
}

function PlanSheet({ view, token }: { readonly view: PlanView; readonly token: string }): ReactElement {
  const titleId = useId();
  const listId = useId();
  const drawing = useMemo(() => drawPlanView(view), [view]);
  const described = describePlanItems(view.items);

  return (
    <article className="plan-view__plan" data-testid="plan-view-ready">
      <header className="plan-view__head">
        <p className="plan-view__eyebrow">{view.venueName}</p>
        <h1 className="plan-view__title plan-view__title--room">{view.roomName}</h1>
        {view.planName !== null && <p className="plan-view__plan-name">{view.planName}</p>}
      </header>

      <p className="plan-view__provenance" data-testid="plan-view-provenance">
        <strong>{view.provenance}</strong>
        <span>Last changed {formatInVenueClock(view.lastChangedAt, view.timezone)}.</span>
      </p>

      {drawing !== null && (
        <figure className="plan-view__figure">
          <PlanDrawing drawing={drawing} titleId={titleId} title={`Plan of the ${view.roomName}, drawn to scale: ${described}.`} />
          <figcaption className="plan-view__caption">Drawn to scale from catalogue sizes.</figcaption>
        </figure>
      )}

      <section className="plan-view__items" aria-labelledby={listId}>
        <h2 id={listId} className="plan-view__label">On the plan</h2>
        {view.items.length === 0 ? (
          <p className="plan-view__text">Nothing placed yet.</p>
        ) : (
          <ul className="plan-view__list" data-testid="plan-view-items">
            {view.items.map((item) => (
              <li key={`${item.category}:${item.name}`} className="plan-view__item">
                <span className={`plan-view__swatch plan-view__swatch--${swatchFor(item.category)}`} aria-hidden="true" />
                <span className="plan-view__count">{item.count}</span>
                <span className="plan-view__name">{item.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="plan-view__actions">
        <a className="plan-view__button" href={planViewPdfUrl(token)} download data-testid="plan-view-pdf">
          Download as PDF
        </a>
      </div>

      <section className="plan-view__forward">
        <p className="plan-view__text">
          Prices, availability and what the room can hold are confirmed by the {view.venueName} events team
          when an enquiry is made.
        </p>
        <Link className="plan-view__button plan-view__button--quiet" to="/#enquire">Ask about a date</Link>
      </section>

      <footer className="plan-view__foot" data-testid="plan-view-expiry">
        This link shows the plan as it is saved and works until{" "}
        {formatDateInVenueClock(view.linkExpiresAt, view.timezone)}, unless the person who sent it stops it
        sooner. Nothing can be changed through it.
      </footer>
    </article>
  );
}

type Swatch = "table" | "chair" | "other";

function swatchFor(category: string): Swatch {
  return category === "table" || category === "chair" ? category : "other";
}

function PlanDrawing({ drawing, titleId, title }: {
  readonly drawing: PlanViewDrawing;
  readonly titleId: string;
  readonly title: string;
}): ReactElement {
  const { scaleBar } = drawing;
  return (
    <svg
      className="plan-view__drawing"
      viewBox={`0 0 ${String(drawing.width)} ${drawing.height.toFixed(1)}`}
      role="img"
      aria-labelledby={titleId}
      data-testid="plan-view-drawing"
    >
      <title id={titleId}>{title}</title>
      <polygon className="plan-view__room" points={pointsAttribute(drawing.outline)} />
      {drawing.footprints.map(({ footprint, center, corners, rx, ry, rotationDeg }, index) => {
        const className = `plan-view__shape plan-view__shape--${swatchFor(footprint.category)}`;
        return footprint.collisionType === "cylinder" ? (
          <ellipse
            key={index}
            className={className}
            cx={center.x.toFixed(1)}
            cy={center.y.toFixed(1)}
            rx={rx.toFixed(1)}
            ry={ry.toFixed(1)}
            transform={`rotate(${rotationDeg.toFixed(2)} ${center.x.toFixed(1)} ${center.y.toFixed(1)})`}
          />
        ) : (
          <polygon key={index} className={className} points={pointsAttribute(corners)} />
        );
      })}
      <g className="plan-view__scale" aria-hidden="true">
        <path d={`M${scaleBar.x.toFixed(1)} ${(scaleBar.y - 8).toFixed(1)}v8h${scaleBar.length.toFixed(1)}v-8`} />
        <text x={(scaleBar.x + scaleBar.length + 12).toFixed(1)} y={(scaleBar.y + 6).toFixed(1)}>
          {scaleBar.metres} m
        </text>
      </g>
    </svg>
  );
}

export default PlanViewPage;
