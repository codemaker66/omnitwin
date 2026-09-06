import { useState, type ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import { ActivityIndicator } from "./Activity.js";
import "./RouteArrival.css";

/** A route's real pending state. Never waits for the photograph or a timer. */
export function RouteArrival(): ReactElement {
  const { pathname, search } = useLocation();
  const [imageFailed, setImageFailed] = useState(false);
  const isGrandHall = pathname === "/room/grand-hall"
    || (/^\/plan(?:\/[^/]+)?$/.test(pathname)
      && new URLSearchParams(search).get("space") === "grand-hall");
  const showPhotograph = isGrandHall && !imageFailed;

  return (
    <main className="vv-arrival" data-venue-image={showPhotograph ? "grand-hall" : "none"}>
      {showPhotograph && (
        <img className="vv-arrival__photograph" alt="" aria-hidden="true"
          src="/images/venue/ladder/grand-hall-room-1120.webp"
          srcSet="/images/venue/ladder/grand-hall-room-480.webp 480w, /images/venue/ladder/grand-hall-room-1120.webp 1120w"
          sizes="100vw" decoding="async" onError={() => { setImageFailed(true); }} />
      )}
      <div className="vv-arrival__shade" aria-hidden="true" />
      <header className="vv-arrival__header">
        <Link to="/" className="vv-arrival__brand" aria-label="Venviewer home">VENVIEWER</Link>
        <span>{isGrandHall ? "TRADES HALL · GLASGOW" : "A PLACE FOR EVERY OCCASION"}</span>
      </header>
      <section className="vv-arrival__welcome" role="status" aria-live="polite" aria-atomic="true">
        <p className="vv-arrival__eyebrow">{isGrandHall ? "YOUR GRAND HALL" : "YOUR WORKSPACE"}</p>
        <h1>{isGrandHall ? <>An extraordinary<br />place to begin.</> : <>Make room for<br />what comes next.</>}</h1>
        <div className="vv-arrival__working">
          <ActivityIndicator size={42} />
          <span>Opening {isGrandHall ? "your room" : "your workspace"}…</span>
        </div>
      </section>
      <footer className="vv-arrival__footer">
        <span>{showPhotograph ? "Venue photograph · event styling for inspiration" : "Your workspace will open as soon as it is ready."}</span>
        <Link to="/">Back to venue <span aria-hidden="true">↗</span></Link>
      </footer>
    </main>
  );
}
