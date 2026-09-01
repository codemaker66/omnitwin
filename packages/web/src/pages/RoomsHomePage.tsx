import { roomPosterUrl as posterUrl } from "../lib/room-posters.js";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  roomSplatServedSplats,
  roomSplatBundle,
  roomsWithSplatBundles,
  type GeneratedRoomSplatBundle,
} from "../data/room-splat-bundles.js";
import { TRADES_HALL_RUNTIME_ROOMS } from "../lib/runtime-package-resolution.js";
import "./RoomsHomePage.css";

// ---------------------------------------------------------------------------
// The front door: eight rooms of Trades Hall, measured.
//
// A poster board, not eight players. Streaming every room at once would be
// roughly a gigabyte, so each card carries a still rendered from its own
// capture and the room itself streams only when someone picks it. That is also
// the honest hierarchy — the building has a famous room, and the page should
// say so before it says anything about itself.
//
// House rules this page follows: the room is the light source (chrome stays
// out of the way), one accent (brass), numbers are instruments (the measured
// line under every room is the point, not decoration), and nothing enters —
// cards resolve from soft to sharp rather than sliding or popping.
// ---------------------------------------------------------------------------

/** The building's signature room leads, as it does in life. */
const HERO_ROOM = "grand-hall";

const VENUE = "Trades Hall of Glasgow";

function displayName(slug: string): string {
  return TRADES_HALL_RUNTIME_ROOMS.find((room) => room.slug === slug)?.label ?? slug;
}

// Poster resolution lives in lib/room-posters.ts (shared with the
// Command Centre's lane rails) — the same two-tier fallback as before.

/** Floor dimensions, to one decimal, in the order a person would say them. */
function footprint(bundle: GeneratedRoomSplatBundle): string {
  const [width, height, depth] = bundle.extentM;
  return `${width.toFixed(1)} × ${depth.toFixed(1)} × ${height.toFixed(1)} m`;
}

/**
 * The measured line, and what it is allowed to claim.
 *
 * The splat count is always true — it is a count of what was captured. The
 * dimensions are only true where the scan measured cleanly: a capture that
 * swept in a corridor reports a room far larger than the one people stand in,
 * and the Grand Hall's derived 13.8 × 22.3 m against its published 21 × 10 m is
 * exactly that error. So rooms still being aligned show the count alone rather
 * than printing a measurement the scan cannot support.
 */
function measuredLine(bundle: GeneratedRoomSplatBundle): string {
  return bundle.alignmentConfidence === "confident"
    ? `${footprint(bundle)} · ${splatLine(bundle)}`
    : splatLine(bundle);
}

function splatLine(bundle: GeneratedRoomSplatBundle): string {
  // The served level's count, not the sum over every staged level: a visitor
  // sees the finest level alone, which is the whole reconstruction.
  return `${roomSplatServedSplats(bundle.roomSlug).toLocaleString("en-GB")} splats`;
}

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
  const underReview = bundle.alignmentConfidence !== "confident";

  return (
    <Link className="rooms__card" to={`/room/${slug}`} data-testid={`room-card-${slug}`}>
      <span className={`rooms__plate${showType ? " rooms__plate--type" : ""}`}>
        {showType
          ? (
            <span className="rooms__plateType" aria-hidden="true">
              <span className="rooms__plateNumber">
                {bundle.alignmentConfidence === "confident" ? footprint(bundle) : splatLine(bundle)}
              </span>
              <span className="rooms__plateSplats">
                {bundle.alignmentConfidence === "confident" ? splatLine(bundle) : "Alignment in progress"}
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
      <span className="rooms__measure">{measuredLine(bundle)}</span>
      {underReview && <span className="rooms__state">Alignment in progress</span>}
    </Link>
  );
}

export function RoomsHomePage(): ReactElement {
  const slugs = useMemo(() => roomsWithSplatBundles(), []);
  const heroBundle = roomSplatBundle(HERO_ROOM);
  const rest = useMemo(() => slugs.filter((slug) => slug !== HERO_ROOM), [slugs]);

  // Resolve the page in once, on mount: the house motion rule is that things
  // resolve in place rather than arriving from somewhere.
  const rootRef = useRef<HTMLElement>(null);
  const [resolved, setResolved] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { setResolved(true); });
    return () => { cancelAnimationFrame(frame); };
  }, []);

  const totalSplats = slugs.reduce(
    (sum, slug) => sum + roomSplatServedSplats(slug),
    0,
  );

  return (
    <main
      ref={rootRef}
      className={`rooms${resolved ? " rooms--resolved" : ""}`}
      data-testid="rooms-home"
    >
      <header className="rooms__masthead">
        <span className="rooms__wordmark">Venviewer</span>
        <span className="rooms__venue">{VENUE}</span>
      </header>

      {heroBundle !== null && (
        <section className="rooms__hero" aria-labelledby="rooms-hero-name">
          <img
            className="rooms__heroPoster"
            src={posterUrl(HERO_ROOM)}
            alt={displayName(HERO_ROOM)}
            width={1280}
            height={720}
            decoding="async"
          />
          <div className="rooms__heroInk" aria-hidden="true" />
          <div className="rooms__heroText">
            <p className="rooms__eyebrow">The room everyone comes for</p>
            <h1 className="rooms__heroName" id="rooms-hero-name">{displayName(HERO_ROOM)}</h1>
            <p className="rooms__measure rooms__measure--hero">{measuredLine(heroBundle)}</p>
            <Link className="rooms__enter" to={`/room/${HERO_ROOM}`}>Walk the room</Link>
          </div>
        </section>
      )}

      <section className="rooms__rail" aria-labelledby="rooms-rail-title">
        <div className="rooms__railHead">
          <h2 className="rooms__railTitle" id="rooms-rail-title">
            Every room, measured
          </h2>
          <p className="rooms__railNote">
            {slugs.length} rooms scanned · {totalSplats.toLocaleString("en-GB")} splats
          </p>
        </div>
        <div className="rooms__track">
          {rest.map((slug) => {
            const bundle = roomSplatBundle(slug);
            return bundle === null ? null : <RoomCard key={slug} slug={slug} bundle={bundle} />;
          })}
        </div>
      </section>

      <footer className="rooms__foot">
        <p className="rooms__footNote">
          Scans are working captures, not a survey. Dimensions are measured from
          the scan and are not a substitute for the venue's own figures.
        </p>
        <nav className="rooms__footLinks" aria-label="More">
          <Link to="/fresh">About the venue</Link>
          <Link to="/tour">Walkable tour</Link>
        </nav>
      </footer>
    </main>
  );
}
