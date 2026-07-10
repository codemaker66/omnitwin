import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useReducedMotion } from "../landing/useReducedMotion.js";
import {
  buildDressingProgram,
  drawnSegments,
  elementSegmentEnds,
  seatsAtSegments,
  strokesToInkGeometry,
  type DressingEventType,
} from "./gold-ink.js";
import { useSectionScrollProgress } from "./useSectionScrollProgress.js";
import {
  CAPACITY_FORMATS,
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_WEDDING_PRICING,
  VENUE_TRUTH_PROVENANCE,
  formatPriceGBP,
} from "../../lib/trades-hall-venue-truth.js";
import { publicRoomSelectionCards } from "../../lib/trades-hall-room-showcase.js";
import {
  FOOTER_EMAIL,
  FOOTER_PHONE_DISPLAY,
  FOOTER_PHONE_HREF,
  RETURN_CTA_HREF,
  enquiryMailtoHref,
} from "../landing/rite-copy.js";
import {
  LH_ACTS,
  LH_BRAND_NAME,
  LH_BRAND_SMALL,
  LH_CAPTURE_RECORD_LINES,
  LH_CAPTURE_RECORD_TITLE,
  LH_CHECK_DATE_LABEL,
  LH_CTA_PLANNER_LABEL,
  LH_CTA_TEAM_LABEL,
  LH_ENQUIRE_LABEL,
  LH_EVENT_CHOICE_LEGEND,
  LH_EVENT_TYPES,
  LH_FOOTER_NOTE,
  LH_HEADLINE,
  LH_LEDE,
  LH_LEGEND_CYAN,
  LH_LEGEND_GOLD,
  LH_META_TITLE,
  LH_RATES_TITLE,
  LH_ROOMS_TITLE,
  LH_SKIP_LABEL,
  LH_TICK_CEILING_PREFIX,
  LH_TICK_FORMAT_LABEL,
  LH_TICK_SEATED,
} from "./living-hall-copy.js";
import "./living-hall.css";

// -----------------------------------------------------------------------------
// LivingHallPage — the P0 DOM-first document of the Living Hall.
//
// This is the semantic source of truth for every tier of the experience: the
// scroll-driven 3D performance (P1+) layers onto these sections; Tier C is
// this document styled; screen readers, scrapers, and search engines read it
// as-is. Structural rules the tests enforce: one h1, one section + h2 per
// act, act nav that resolves, skip link first, venue figures rendered only
// from trades-hall-venue-truth, provenance only from the capture record.
// -----------------------------------------------------------------------------

const roomName = (slug: string): string =>
  publicRoomSelectionCards.find((c) => (c.canonicalRoomSlug ?? c.id) === slug)?.name ?? slug;

/** The live seat count under the pen. Computed from the same pure gold-ink
 *  functions the scene uses — consistent by construction, no canvas coupling.
 *  The number is never animated (it changes constantly under scroll); the
 *  figures are engine-derived, never typed here. */
function DressingTick({ eventType }: { readonly eventType: DressingEventType }): ReactElement {
  const derived = useMemo(() => {
    const program = buildDressingProgram(
      eventType,
      TRADES_HALL_ROOM_CAPACITIES["reception-room"],
    );
    return {
      program,
      geometry: strokesToInkGeometry(program.strokes),
      ends: elementSegmentEnds(program),
    };
  }, [eventType]);
  const [seats, setSeats] = useState(0);

  const applyProgress = useCallback(
    (p: number) => {
      const segments = drawnSegments(derived.geometry, p);
      const next = seatsAtSegments(derived.program, derived.ends, segments);
      setSeats((prev) => (prev === next ? prev : next));
    },
    [derived],
  );
  const progressRef = useSectionScrollProgress("the-dressing", applyProgress);

  useEffect(() => {
    // Event type changed: recount at the current scroll position.
    applyProgress(progressRef.current);
  }, [applyProgress, progressRef]);

  return (
    <p className="lh-tick" data-dressing-tick>
      <b>{seats}</b> {LH_TICK_SEATED} · {LH_TICK_CEILING_PREFIX}{" "}
      <b>{derived.program.seatCeiling}</b> {LH_TICK_FORMAT_LABEL[derived.program.ceilingFormat]}
    </p>
  );
}

// The 3D layer ships in its own chunk: Tier C visitors (and scrapers) never
// download Spark/three. The document below is complete without it.
const LivingHallScene = lazy(() =>
  import("./LivingHallScene.js").then((m) => ({ default: m.LivingHallScene })),
);

function webGl2Available(): boolean {
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

export function LivingHallPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const reducedMotion = useReducedMotion();
  const [eventType, setEventType] = useState<DressingEventType>("wedding");
  const [sceneFailed, setSceneFailed] = useState(false);
  const sceneRequested = searchParams.get("scene") !== "0";
  const sceneCapable = useMemo(() => webGl2Available(), []);
  const sceneActive = sceneRequested && sceneCapable && !sceneFailed;
  const handleSceneFailed = useCallback(() => {
    setSceneFailed(true);
  }, []);

  useEffect(() => {
    document.title = LH_META_TITLE;
  }, []);

  return (
    <div className={`lh-root${sceneActive ? " has-scene" : ""}`}>
      {sceneActive && (
        <Suspense fallback={null}>
          <LivingHallScene
            reducedMotion={reducedMotion}
            eventType={eventType}
            onSceneFailed={handleSceneFailed}
          />
        </Suspense>
      )}
      <a className="lh-skip" href="#rooms-and-rates">
        {LH_SKIP_LABEL}
      </a>

      <header className="lh-header">
        <div className="lh-brand">
          <small>{LH_BRAND_SMALL}</small>
          <b>{LH_BRAND_NAME}</b>
        </div>
        <nav aria-label="Page acts" className="lh-act-nav">
          {LH_ACTS.map((act) => (
            <a key={act.id} href={`#${act.id}`}>
              {act.navLabel}
            </a>
          ))}
        </nav>
        <div className="lh-header-actions">
          <a href="#rooms-and-rates" className="lh-header-quiet">
            {LH_CHECK_DATE_LABEL}
          </a>
          <a href={enquiryMailtoHref()} className="lh-header-cta">
            {LH_ENQUIRE_LABEL}
          </a>
        </div>
      </header>

      <main className="lh-main">
        <div className="lh-hero">
          <h1>{LH_HEADLINE}</h1>
          <p className="lh-lede">{LH_LEDE}</p>
        </div>

        {LH_ACTS.map((act) => (
          <section key={act.id} id={act.id} className="lh-act" aria-labelledby={`${act.id}-title`}>
            <h2 id={`${act.id}-title`}>{act.title}</h2>
            {act.id === "the-dressing" && (
              <fieldset className="lh-event-choice">
                <legend>{LH_EVENT_CHOICE_LEGEND}</legend>
                {LH_EVENT_TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={eventType === t.key}
                    onClick={() => {
                      setEventType(t.key);
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </fieldset>
            )}
            {act.narration.map((line) => (
              <p key={line.slice(0, 32)}>{line}</p>
            ))}
            {act.id === "the-dressing" && <DressingTick eventType={eventType} />}

            {act.id === "the-plan" && (
              <>
                <aside className="lh-legend" aria-label="How to read the plan">
                  <span className="lh-legend-gold">{LH_LEGEND_GOLD}</span>
                  <span className="lh-legend-cyan">{LH_LEGEND_CYAN}</span>
                </aside>
                <dl className="lh-record" data-capture-record>
                  <dt>{LH_CAPTURE_RECORD_TITLE}</dt>
                  {LH_CAPTURE_RECORD_LINES.map((line) => (
                    <dd key={line.slice(0, 32)}>{line}</dd>
                  ))}
                </dl>
              </>
            )}

            {act.id === "rooms-and-rates" && (
              <>
                <h3>{LH_ROOMS_TITLE}</h3>
                <table className="lh-capacities">
                  <thead>
                    <tr>
                      <th scope="col">Room</th>
                      {CAPACITY_FORMATS.map((f) => (
                        <th key={f.key} scope="col">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(TRADES_HALL_ROOM_CAPACITIES).map(([slug, cap]) => (
                      <tr key={slug} data-room-row={slug}>
                        <th scope="row">{roomName(slug)}</th>
                        {CAPACITY_FORMATS.map((f) => (
                          <td key={f.key}>{cap[f.key]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="lh-provenance">{VENUE_TRUTH_PROVENANCE.capacities}</p>

                <h3>{LH_RATES_TITLE}</h3>
                <p className="lh-rates-scope">{TRADES_HALL_WEDDING_PRICING.scope}</p>
                {TRADES_HALL_WEDDING_PRICING.seasons.map((season) => (
                  <dl className="lh-rates" key={season.years}>
                    <dt>{season.years}</dt>
                    {season.rates.map((rate) => (
                      <dd key={rate.packageName} data-rate-row>
                        <span>{rate.packageName}</span>
                        <span>{formatPriceGBP(rate.priceGBP)}</span>
                      </dd>
                    ))}
                  </dl>
                ))}
                <p className="lh-provenance">{VENUE_TRUTH_PROVENANCE.pricing}</p>

                <div className="lh-threshold">
                  <Link className="lh-cta" to={RETURN_CTA_HREF}>
                    {LH_CTA_PLANNER_LABEL} <span aria-hidden>→</span>
                  </Link>
                  <a className="lh-cta-quiet" href={FOOTER_PHONE_HREF}>
                    {LH_CTA_TEAM_LABEL} · {FOOTER_PHONE_DISPLAY}
                  </a>
                  <a className="lh-cta-quiet" href={enquiryMailtoHref()}>
                    {FOOTER_EMAIL}
                  </a>
                </div>
              </>
            )}
          </section>
        ))}
      </main>

      <footer className="lh-footer">
        <span>{LH_FOOTER_NOTE}</span>
      </footer>
    </div>
  );
}
