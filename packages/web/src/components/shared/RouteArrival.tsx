import { useState, type ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { ActivityIndicator } from "./Activity.js";
import "./RouteArrival.css";

/** The public panorama tour's addresses (router: /tour and /venues/:slug/twin). */
const TOUR_PATH = /^\/(?:tour|venues\/[^/]+\/twin)\/?$/u;

/** A route's real pending state. Never waits for the photograph or a timer. */
export function RouteArrival(): ReactElement {
  const { pathname, search } = useLocation();
  const isGrandHall = pathname === "/room/grand-hall"
    || (/^\/plan(?:\/[^/]+)?$/.test(pathname)
      && new URLSearchParams(search).get("space") === "grand-hall");
  // A visitor opening the tour is not opening a "Workspace": name the page
  // they asked for and what is happening, as the tour's own stages do.
  if (TOUR_PATH.test(pathname)) {
    return <ArrivalArtwork isGrandHall={false} heading="Panorama tour" working="Opening the tour…" />;
  }
  return <ArrivalArtwork isGrandHall={isGrandHall} />;
}

export function ArrivalArtwork({ isGrandHall, onEnter, heading, working = "Opening…" }: {
  readonly isGrandHall: boolean;
  readonly onEnter?: () => void;
  /** Overrides the heading; by default "Grand Hall" or "Workspace". */
  readonly heading?: string;
  /** The work being done, in words. */
  readonly working?: string;
}): ReactElement {
  const [imageFailed, setImageFailed] = useState(false);
  const showPhotograph = isGrandHall && !imageFailed;

  return (
    <div className="vv-arrival" data-venue-image={showPhotograph ? "grand-hall" : "none"}>
      {showPhotograph && (
        <img className="vv-arrival__photograph" alt="" aria-hidden="true"
          src="/images/venue/ladder/grand-hall-room-1120.webp"
          srcSet="/images/venue/ladder/grand-hall-room-480.webp 480w, /images/venue/ladder/grand-hall-room-1120.webp 1120w"
          sizes="100vw" decoding="async" onError={() => { setImageFailed(true); }} />
      )}
      <div className="vv-arrival__shade" aria-hidden="true" />
      <header className="vv-arrival__header">
        <a href="/" className="vv-arrival__brand" aria-label="Venviewer home">VENVIEWER</a>
        {isGrandHall && <span>TRADES HALL · GLASGOW</span>}
      </header>
      <section className="vv-arrival__welcome" role="status" aria-live="polite" aria-atomic="true">
        <h1>{heading ?? (isGrandHall ? "Grand Hall" : "Workspace")}</h1>
        <div className="vv-arrival__working">
          <ActivityIndicator size={42} />
          <span>{working}</span>
        </div>
        {onEnter !== undefined && (
          <button type="button" className="vv-arrival__enter" onClick={onEnter}>
            Open planner <span aria-hidden="true">↗</span>
          </button>
        )}
      </section>
      <footer className="vv-arrival__footer">
        {showPhotograph && <span>Venue photograph · styling inspiration</span>}
        <a href="/">Back to venue <span aria-hidden="true">↗</span></a>
      </footer>
    </div>
  );
}
