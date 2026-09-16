import { roomPosterUrl as posterUrl } from "../lib/room-posters.js";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  roomSplatBundle,
  roomsWithSplatBundles,
  type GeneratedRoomSplatBundle,
} from "../data/room-splat-bundles.js";
import { TRADES_HALL_RUNTIME_ROOMS } from "../lib/runtime-package-resolution.js";
import { isRoomWalkable } from "../data/room-walk-exposure.js";
import { footprint, stateLine } from "../lib/room-card-copy.js";
import { useHashTarget } from "../lib/use-hash-target.js";
import {
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_WEDDING_PRICING,
  formatPriceGBP,
  type PublishedRoomSlug,
} from "../lib/trades-hall-venue-truth.js";
import { FreshEnquiry } from "./fresh/FreshEnquiry.js";
import { FRESH_TOUR_ENABLED } from "./fresh/fresh-copy.js";
import {
  HOME_CAPACITY_LEDE,
  HOME_CAPACITY_NOTE,
  HOME_CAPACITY_ROOM_HEADING,
  HOME_CAPACITY_TITLE,
  HOME_ENQUIRY_LEDE,
  HOME_ENQUIRY_TITLE,
  HOME_FOOT_ABOUT,
  HOME_FOOT_ENQUIRE,
  HOME_FOOT_NOTE,
  HOME_FOOT_TWIN,
  HOME_FOOT_TWIN_HREF,
  HOME_HERO_ALT,
  HOME_HERO_ENQUIRE,
  HOME_HERO_HEADLINE,
  HOME_HERO_IMAGE,
  HOME_HERO_KICKER,
  HOME_HERO_LEDE,
  HOME_HERO_SIZES,
  HOME_HERO_SRCSET,
  HOME_HERO_WALK,
  HOME_META_DESCRIPTION,
  HOME_META_TITLE,
  HOME_NAV_ENQUIRE,
  HOME_NAV_LOGIN,
  HOME_NAV_PLAN,
  HOME_RATES_NOTE,
  HOME_RATES_PROVENANCE,
  HOME_RATES_TITLE,
  HOME_ROOMS_LEDE,
  HOME_ROOMS_TITLE,
  HOME_ROOM_NAMES,
  HOME_VENUE,
  HOME_WORDMARK,
  capacityEnvelopes,
  envelopeLine,
} from "./home-copy.js";
import "./fresh/fresh.css";
import "./RoomsHomePage.css";

// ---------------------------------------------------------------------------
// The front door — the one canonical public home (T-616).
//
// This page used to be a poster board of the captured rooms, and /fresh was a
// second homepage carrying the photography, the published capacities, the
// wedding rates and the only real enquiry form on the site. A visitor met
// whichever of the two a link happened to point at. Both halves are here now:
// the venue's own photograph leads, the captured rooms are a rail beneath it,
// and the composer that actually posts an enquiry closes the page.
//
// It renders on the Fresh paper (`.fr-root`), so the merge is one register
// rather than two grounds stitched together, and its sections reuse that
// stylesheet's grammar — Adam's ellipse as the divider, Fraunces for display,
// the same composer markup /fresh renders.
//
// House rules it keeps: the room is the light source (chrome stays out of the
// way), numbers are instruments rather than decoration, and nothing enters —
// the page resolves in place rather than sliding or popping.
// ---------------------------------------------------------------------------

/** The building's signature room leads, as it does in life. */
const HERO_ROOM = "grand-hall";

function displayName(slug: string): string {
  return TRADES_HALL_RUNTIME_ROOMS.find((room) => room.slug === slug)?.label ?? slug;
}

// Poster resolution lives in lib/room-posters.ts (shared with the
// Command Centre's lane rails) — the same two-tier fallback as before.

interface CardProps {
  readonly slug: string;
  readonly bundle: GeneratedRoomSplatBundle;
}

/**
 * A room's plate.
 *
 * Not every scan has a poster: some rooms are whole-floor captures still being
 * aligned, and a still of one of those is a smear, not a room. Rather than show
 * that, the plate falls back to the room's own numbers set in type — which is
 * honest, looks deliberate, and needs no per-room bookkeeping: if the poster
 * file is missing the image simply fails and the type takes over.
 */
function RoomCard({ slug, bundle }: CardProps): ReactElement {
  const still = posterUrl(slug);
  const [posterFailed, setPosterFailed] = useState(false);
  const onPosterError = useCallback(() => { setPosterFailed(true); }, []);
  const showType = posterFailed;
  const walkable = isRoomWalkable(slug);
  const state = stateLine(bundle, walkable);

  const face = (
    <>
      <span className={`rooms__plate${showType ? " rooms__plate--type" : ""}`}>
        {showType
          ? (
            <span className="rooms__plateType" aria-hidden="true">
              <span className="rooms__plateNumber">
                {bundle.alignmentConfidence === "confident" && walkable ? footprint(bundle) : displayName(slug)}
              </span>
            </span>
          )
          : (
            <img
              className="rooms__poster"
              src={still}
              alt={displayName(slug)}
              loading="lazy"
              decoding="async"
              width={1280}
              height={720}
              onError={onPosterError}
            />
          )}
      </span>
      <span className="rooms__cardName">{displayName(slug)}</span>
      {bundle.alignmentConfidence === "confident" && walkable && <span className="rooms__measure">{footprint(bundle)}</span>}
      {state !== null && <span className="rooms__state">{state}</span>}
    </>
  );

  // A closed room is a card, not a door: same face, no link, nothing to click.
  return walkable
    ? (
      <Link className="rooms__card" to={`/room/${slug}`} data-testid={`room-card-${slug}`}>
        {face}
      </Link>
    )
    : (
      <div className="rooms__card rooms__card--closed" data-testid={`room-card-${slug}`}>
        {face}
      </div>
    );
}

/**
 * What the house holds, by layout.
 *
 * Every figure comes from trades-hall-venue-truth. The house row is an
 * envelope — "40 to 250" — never one number: a single figure reads as the
 * building's capacity when it is only the largest room's, which is how the old
 * hero came to print a measurement that contradicted the venue's own published
 * dimensions.
 */
function CapacityTable(): ReactElement {
  const envelopes = capacityEnvelopes();
  const slugs = Object.keys(HOME_ROOM_NAMES) as readonly PublishedRoomSlug[];

  return (
    <div className="rooms__capacityScroll">
      <table className="rooms__capacity">
        <caption className="rooms__capacityCaption">{HOME_CAPACITY_LEDE}</caption>
        <thead>
          <tr>
            <th scope="col">{HOME_CAPACITY_ROOM_HEADING}</th>
            {envelopes.map((envelope) => (
              <th scope="col" key={envelope.key}>{envelope.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slugs.map((slug) => (
            <tr key={slug}>
              <th scope="row">{HOME_ROOM_NAMES[slug]}</th>
              {envelopes.map((envelope) => (
                <td key={envelope.key}>{TRADES_HALL_ROOM_CAPACITIES[slug][envelope.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{HOME_VENUE}</th>
            {envelopes.map((envelope) => (
              <td key={envelope.key}>{envelopeLine(envelope)}</td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function RoomsHomePage(): ReactElement {
  const slugs = useMemo(() => roomsWithSplatBundles(), []);
  const rest = useMemo(() => slugs.filter((slug) => slug !== HERO_ROOM), [slugs]);

  // #enquire arrives from the room walk, the not-found page, the Rite, the
  // Living Hall and the craft quiz. The browser gave up on it before this
  // chunk existed, so the page looks again.
  useHashTarget();

  // Per-route metadata (gate line 7). index.html carries the same two strings
  // statically for link scrapers, which never run this effect.
  useEffect(() => {
    document.title = HOME_META_TITLE;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", HOME_META_DESCRIPTION);
  }, []);

  // Resolve the page in once, on mount: the house motion rule is that things
  // resolve in place rather than arriving from somewhere.
  const [resolved, setResolved] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { setResolved(true); });
    return () => { cancelAnimationFrame(frame); };
  }, []);

  return (
    <div className={`rooms fr-root${resolved ? " rooms--resolved" : ""}`} data-testid="rooms-home">
      <header className="rooms__masthead">
        <div className="rooms__identity">
          <span className="rooms__wordmark">{HOME_WORDMARK}</span>
          <span className="rooms__venue">{HOME_VENUE}</span>
        </div>
        {/* T-616: Dashboard, Diary and Hallkeeper are gone. Each one bounced an
            anonymous visitor into a Clerk login wall, so the front door
            advertised three doors its readers cannot open. */}
        <nav className="rooms__primaryNav" aria-label="Primary">
          <a className="rooms__navPlan" href="/plan?space=grand-hall">{HOME_NAV_PLAN}</a>
          <a href="#enquire">{HOME_NAV_ENQUIRE}</a>
          <Link className="rooms__navLogin" to="/login">{HOME_NAV_LOGIN}</Link>
        </nav>
      </header>

      <main>
        {/* ——— the hero: the venue's own photograph of its own room ——— */}
        <section className="rooms__hero" aria-labelledby="rooms-hero-name">
          <img
            className="rooms__heroPhoto"
            src={HOME_HERO_IMAGE}
            srcSet={HOME_HERO_SRCSET}
            sizes={HOME_HERO_SIZES}
            alt={HOME_HERO_ALT}
            width={1120}
            height={747}
            decoding="async"
            /* The largest-contentful paint of the whole site: say so, rather
               than letting the browser discover the hero behind the CSS.

               Lowercase, via spread, deliberately — the same form FreshPage.tsx
               uses, and for the same reason. @types/react 18.3.18 types
               `fetchPriority`, but react-dom 18.3.1 has never heard of it, so
               TypeScript accepts the camelCase prop and React then warns and
               DROPS it: the hint never reaches the HTML, and the warning is a
               console error the accessibility and acquisition audits count.
               This shipped as `fetchPriority` and cost 17 console errors on the
               front door, invisible in a production preview because React
               strips its warnings there — CI's dev-server run is what caught
               it. Revisit when this package moves to React 19. */
            {...({ fetchpriority: "high" } as { readonly fetchpriority: string })}
          />
          <div className="rooms__heroText">
            <p className="rooms__heroKicker">{HOME_HERO_KICKER}</p>
            <h1 className="rooms__heroName" id="rooms-hero-name">{HOME_HERO_HEADLINE}</h1>
            <p className="rooms__heroLede">{HOME_HERO_LEDE}</p>
            <div className="rooms__heroActions">
              <a className="fr-cta" href="#enquire">{HOME_HERO_ENQUIRE}</a>
              {isRoomWalkable(HERO_ROOM) && (
                <Link className="fr-cta-quiet" to={`/room/${HERO_ROOM}`}>{HOME_HERO_WALK}</Link>
              )}
            </div>
          </div>
        </section>

        {/* ——— the captured rooms: this page's own half of the merge ——— */}
        <section className="fr-rooms rooms__rail" aria-labelledby="rooms-rail-title">
          <div className="fr-arch" aria-hidden />
          <h2 className="rooms__railTitle" id="rooms-rail-title">{HOME_ROOMS_TITLE}</h2>
          <p className="fr-section-lede">{HOME_ROOMS_LEDE}</p>
          <div className="rooms__track">
            {rest.map((slug) => {
              const bundle = roomSplatBundle(slug);
              return bundle === null ? null : <RoomCard key={slug} slug={slug} bundle={bundle} />;
            })}
          </div>
        </section>

        {/* ——— what each room holds ——— */}
        <section className="fr-rooms rooms__capacitySection" aria-labelledby="rooms-capacity-title">
          <div className="fr-arch is-flipped" aria-hidden />
          <h2 id="rooms-capacity-title">{HOME_CAPACITY_TITLE}</h2>
          <CapacityTable />
          <p className="fr-scope">{HOME_CAPACITY_NOTE}</p>
        </section>

        {/* ——— rates: the venue's own numbers, plainly ——— */}
        <section className="fr-rates" aria-labelledby="rooms-rates-title">
          <div className="fr-arch" aria-hidden />
          <h2 id="rooms-rates-title">{HOME_RATES_TITLE}</h2>
          <p className="fr-section-lede">{HOME_RATES_NOTE}</p>
          <div className="fr-rate-columns">
            {TRADES_HALL_WEDDING_PRICING.seasons.map((season) => (
              <dl key={season.years}>
                <dt>{season.years}</dt>
                {season.rates.map((rate) => (
                  <div className="fr-rate" key={rate.packageName}>
                    <dd>{rate.packageName}</dd>
                    <dd className="fr-price">{formatPriceGBP(rate.priceGBP)}</dd>
                  </div>
                ))}
              </dl>
            ))}
          </div>
          <p className="fr-scope">{TRADES_HALL_WEDDING_PRICING.scope}. {HOME_RATES_PROVENANCE}</p>
        </section>

        {/* ——— the composer: the one form that reaches the venue ——— */}
        <section className="fr-enquiry" id="enquire" aria-labelledby="rooms-enquiry-title">
          <div className="fr-arch is-flipped" aria-hidden />
          <h2 id="rooms-enquiry-title">{HOME_ENQUIRY_TITLE}</h2>
          <p className="fr-section-lede">{HOME_ENQUIRY_LEDE}</p>
          <FreshEnquiry />
        </section>
      </main>

      <footer className="rooms__foot">
        <nav className="rooms__footLinks" aria-label="More">
          <Link to="/fresh">{HOME_FOOT_ABOUT}</Link>
          {/* The whole-building walkthrough stays off the front door while its
              bundle is unpublished. FRESH_TOUR_ENABLED has been false since
              2026-08-15 because the twin manifest is not on the asset base and
              the SPA rewrite answers the missing file with index.html and a
              200 — so the fetch looks like it succeeded and fails only when
              the HTML is parsed as JSON. /fresh already hides its own tour
              door behind this flag; the front door must not become the one
              surface that still offers it. */}
          {FRESH_TOUR_ENABLED && (
            <Link to={HOME_FOOT_TWIN_HREF}>{HOME_FOOT_TWIN}</Link>
          )}
          <a href="#enquire">{HOME_FOOT_ENQUIRE}</a>
        </nav>
        <p className="rooms__footNote">{HOME_FOOT_NOTE}</p>
      </footer>
    </div>
  );
}
