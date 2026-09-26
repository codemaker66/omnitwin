import { roomPosterSources } from "../lib/room-posters.js";
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
import { gaussianSplatsAvailable } from "../lib/splat-access.js";
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
  HOME_CAPACITY_RANGE_HEADING,
  HOME_CAPACITY_ROOM_HEADING,
  HOME_CAPACITY_TITLE,
  HOME_CARD_HELD,
  HOME_ENQUIRY_LEDE,
  HOME_ENQUIRY_TITLE,
  HOME_FOOT_ABOUT,
  HOME_FOOT_ENQUIRE,
  HOME_FOOT_NOTE,
  HOME_FOOT_SCAN_NOTE,
  HOME_FOOT_TWIN,
  HOME_FOOT_TWIN_HREF,
  HOME_HERO_ALT,
  HOME_HERO_LEDE,
  HOME_HERO_PLAN,
  HOME_HERO_SPLATS_HELD,
  HOME_HERO_TOUR,
  HOME_HERO_WALK,
  HOME_LEGAL_LINKS,
  HOME_META_DESCRIPTION,
  HOME_META_TITLE,
  HOME_NAV_ENQUIRE,
  HOME_NAV_LOGIN,
  HOME_NAV_PLAN,
  HOME_RATES_NOTE,
  HOME_RATES_PROVENANCE,
  HOME_RATES_TITLE,
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
// The front door — the one public home of Trades Hall (T-616).
//
// It opens on the building's famous room, photographed by the venue, and the
// rooms beside it: a poster board, not eight players. Streaming every room at
// once would be roughly a gigabyte, so each card carries a still and the room
// itself streams only when someone picks it. Below that the page settles onto
// the ivory sheet a booking is made on: what each room holds by layout, the
// wedding rates, and the enquiry composer — the same one /fresh renders, so the
// two pages cannot drift apart.
//
// House rules this page follows: the room is the light source (chrome stays
// out of the way), numbers are instruments (the measured line and the
// capacity table are the point, not decoration), and nothing enters — cards
// resolve from soft to sharp rather than sliding or popping.
// ---------------------------------------------------------------------------

/** Rendered rail card width (see .rooms__track in RoomsHomePage.css). */
export const ROOM_CARD_SIZES = "(min-width: 1800px) 19rem, 15rem";

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
 * that, the plate falls back to the room's own name and numbers set in type —
 * which looks deliberate and needs no per-room bookkeeping: if the poster file
 * is missing the image simply fails and the type takes over.
 */
function RoomCard({ slug, bundle }: CardProps): ReactElement {
  const still = roomPosterSources(slug);
  const [posterFailed, setPosterFailed] = useState(false);
  const onPosterError = useCallback(() => { setPosterFailed(true); }, []);
  const showType = posterFailed;
  const walkable = isRoomWalkable(slug);
  const state = gaussianSplatsAvailable() ? stateLine(bundle, walkable) : HOME_CARD_HELD;

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
              src={still.src}
              srcSet={still.srcSet}
              // The scrolling rail keeps its columns at their 15rem minimum
              // until the viewport is wide enough for 19rem columns.
              sizes={ROOM_CARD_SIZES}
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
 * What each room holds, by layout.
 *
 * Every figure comes from trades-hall-venue-truth. The last row is each
 * layout's range across the rooms — "40 to 250" — never one number: a single
 * figure reads as the building's capacity when it is only the largest room's.
 *
 * On a phone the five columns do not fit, so each room becomes a block of its
 * own with the layout named over each figure (RoomsHomePage.css). Those
 * visible labels are aria-hidden, because the column headers already name
 * every cell; and the table states its roles outright, because a browser may
 * drop a table's semantics once CSS changes how its rows display.
 */
function CapacityTable(): ReactElement {
  const envelopes = capacityEnvelopes();
  const slugs = Object.keys(HOME_ROOM_NAMES) as readonly PublishedRoomSlug[];
  const cell = (label: string, value: string | number, key: string): ReactElement => (
    <td role="cell" key={key}>
      <span className="rooms__capacityLabel" aria-hidden="true">{label}</span>
      {value}
    </td>
  );

  return (
    <table className="rooms__capacity" role="table">
      <caption className="rooms__capacityCaption">{HOME_CAPACITY_LEDE}</caption>
      <thead role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader">{HOME_CAPACITY_ROOM_HEADING}</th>
          {envelopes.map((envelope) => (
            <th scope="col" role="columnheader" key={envelope.key}>{envelope.label}</th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {slugs.map((slug) => (
          <tr role="row" key={slug}>
            <th scope="row" role="rowheader">{HOME_ROOM_NAMES[slug]}</th>
            {envelopes.map((envelope) => cell(envelope.label, TRADES_HALL_ROOM_CAPACITIES[slug][envelope.key], envelope.key))}
          </tr>
        ))}
      </tbody>
      <tfoot role="rowgroup">
        <tr role="row">
          <th scope="row" role="rowheader">{HOME_CAPACITY_RANGE_HEADING}</th>
          {envelopes.map((envelope) => cell(envelope.label, envelopeLine(envelope), envelope.key))}
        </tr>
      </tfoot>
    </table>
  );
}

export function RoomsHomePage(): ReactElement {
  const slugs = useMemo(() => roomsWithSplatBundles(), []);
  const heroBundle = roomSplatBundle(HERO_ROOM);
  const heroStill = roomPosterSources(HERO_ROOM);
  const rest = useMemo(() => slugs.filter((slug) => slug !== HERO_ROOM), [slugs]);
  const heroWalkable = isRoomWalkable(HERO_ROOM);

  // #enquire arrives from the room walk, the not-found page, the legal pages
  // and the craft quiz. The browser gave up on it before this chunk existed,
  // so the page looks again.
  useHashTarget();

  // Per-route metadata. index.html carries the same two strings statically for
  // link scrapers, which never run this effect.
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
    // The Fresh paper (fresh.css) supplies the sheet's tokens and the composer's
    // grammar. It is pinned to its light theme: the page's one dark element is
    // the photographed hall, and the browser chrome takes the same ivory.
    <div
      className={`rooms fr-root${resolved ? " rooms--resolved" : ""}`}
      data-theme="light"
      data-testid="rooms-home"
    >
      <header className="rooms__masthead">
        <div className="rooms__identity">
          <span className="rooms__wordmark">{HOME_WORDMARK}</span>
          <span className="rooms__venue">{HOME_VENUE}</span>
        </div>
        {/* T-616: Dashboard, Diary and Hallkeeper are gone. Each one bounced an
            anonymous visitor into a login wall, so the front door advertised
            three doors its readers cannot open. Log in takes staff to their
            workspace. */}
        <nav className="rooms__primaryNav" aria-label="Primary">
          <a className="rooms__navPlan" href="/plan?space=grand-hall">{HOME_NAV_PLAN}</a>
          <a href="#enquire">{HOME_NAV_ENQUIRE}</a>
          <Link className="rooms__navLogin" to="/login">{HOME_NAV_LOGIN}</Link>
        </nav>
      </header>

      <main>
        <div className="rooms__stage">
          <section className="rooms__hero" aria-labelledby="rooms-hero-name">
            <img
              className="rooms__heroPoster"
              src={heroStill.src}
              srcSet={heroStill.srcSet}
              sizes="100vw"
              alt={HOME_HERO_ALT}
              width={1280}
              height={720}
              // The page's largest paint. Lowercase via spread: react-dom 18.3
              // drops the camelCase prop (see FreshPage's hero).
              {...({ fetchpriority: "high" } as { readonly fetchpriority: string })}
              decoding="async"
            />
            <div className="rooms__heroInk" aria-hidden="true" />
            <div className="rooms__heroText">
              <h1 className="rooms__heroName" id="rooms-hero-name">{displayName(HERO_ROOM)}</h1>
              {heroBundle !== null && heroBundle.alignmentConfidence === "confident" && heroWalkable
                && <p className="rooms__measure rooms__measure--hero">{footprint(heroBundle)}</p>}
              <p className="rooms__heroLede">{HOME_HERO_LEDE}</p>
              <div className="rooms__heroActions">
                <a className="rooms__enter rooms__enter--plan" href="/plan?space=grand-hall">{HOME_HERO_PLAN}</a>
                {heroWalkable
                  ? <Link className="rooms__enter" to={`/room/${HERO_ROOM}`}>{HOME_HERO_WALK}</Link>
                  : <p className="rooms__state rooms__state--hero">{HOME_HERO_SPLATS_HELD}</p>}
                {!gaussianSplatsAvailable() && <Link className="rooms__enter" to="/tour">{HOME_HERO_TOUR}</Link>}
              </div>
            </div>
          </section>

          <section className="rooms__rail" aria-labelledby="rooms-rail-title">
            <div className="rooms__railHead">
              <h2 className="rooms__railTitle" id="rooms-rail-title">{HOME_ROOMS_TITLE}</h2>
            </div>
            <div className="rooms__track">
              {rest.map((slug) => {
                const bundle = roomSplatBundle(slug);
                return bundle === null ? null : <RoomCard key={slug} slug={slug} bundle={bundle} />;
              })}
            </div>
          </section>
        </div>

        {/* ——— what each room holds ——— */}
        <section className="fr-rooms rooms__capacitySection" aria-labelledby="rooms-capacity-title">
          <div className="fr-arch" aria-hidden />
          <h2 id="rooms-capacity-title">{HOME_CAPACITY_TITLE}</h2>
          <CapacityTable />
          <p className="fr-scope">{HOME_CAPACITY_NOTE}</p>
        </section>

        {/* ——— rates: the venue's own numbers, plainly ——— */}
        <section className="fr-rates" aria-labelledby="rooms-rates-title">
          <div className="fr-arch is-flipped" aria-hidden />
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
          <div className="fr-arch" aria-hidden />
          <h2 id="rooms-enquiry-title">{HOME_ENQUIRY_TITLE}</h2>
          <p className="fr-section-lede">{HOME_ENQUIRY_LEDE}</p>
          <FreshEnquiry />
        </section>
      </main>

      <footer className="rooms__foot">
        <nav className="rooms__footLinks" aria-label="More">
          <Link to="/fresh">{HOME_FOOT_ABOUT}</Link>
          {FRESH_TOUR_ENABLED && <Link to={HOME_FOOT_TWIN_HREF}>{HOME_FOOT_TWIN}</Link>}
          <a href="#enquire">{HOME_FOOT_ENQUIRE}</a>
        </nav>
        <nav className="rooms__footLegal" aria-label="Legal">
          {HOME_LEGAL_LINKS.map((link) => (
            <a key={link.href} href={link.href}>{link.label}</a>
          ))}
        </nav>
        <p className="rooms__footNote">{HOME_FOOT_SCAN_NOTE}</p>
        <p className="rooms__footNote">{HOME_FOOT_NOTE}</p>
      </footer>
    </div>
  );
}
