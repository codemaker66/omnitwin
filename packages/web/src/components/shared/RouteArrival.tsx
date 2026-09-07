import { useState, type ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { ActivityIndicator } from "./Activity.js";
import "./RouteArrival.css";

/** A route's real pending state. Never waits for the photograph or a timer. */
export function RouteArrival(): ReactElement {
  const { pathname, search } = useLocation();
  const isGrandHall = pathname === "/room/grand-hall"
    || (/^\/plan(?:\/[^/]+)?$/.test(pathname)
      && new URLSearchParams(search).get("space") === "grand-hall");
  return <ArrivalArtwork isGrandHall={isGrandHall} />;
}

export function ArrivalArtwork({ isGrandHall, onEnter }: {
  readonly isGrandHall: boolean;
  readonly onEnter?: () => void;
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
        <h1>{isGrandHall ? "Grand Hall" : "Workspace"}</h1>
        <div className="vv-arrival__working">
          <ActivityIndicator size={42} />
          <span>Opening…</span>
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
