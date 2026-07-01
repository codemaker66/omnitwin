import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  NAV_BRAND_NAME,
  NAV_BRAND_SMALL,
  NAV_PLAN_LABEL,
  NAV_ROOMS_LABEL,
  NAV_SIGN_IN_LABEL,
  RETURN_CTA_HREF,
} from "./rite-copy.js";

// -----------------------------------------------------------------------------
// RiteNav — the page behaves like a place you can navigate only after the
// dark has done its work. Rendered from the start (semantic document, SEO,
// keyboard users tab straight to it) but visually revealed from Act II via
// the `is-revealed` class; `inert` is never used so it stays reachable.
// -----------------------------------------------------------------------------

export interface RiteNavProps {
  readonly revealed: boolean;
}

export function RiteNav({ revealed }: RiteNavProps): ReactElement {
  return (
    <nav
      className={`rite-nav${revealed ? " is-revealed" : ""}`}
      aria-label="Primary"
    >
      <Link className="rite-nav-brand" to="/" aria-label="Trades Hall Glasgow — home">
        <span className="rite-crest" aria-hidden>Th</span>
        <span className="rite-lockup">
          <small>{NAV_BRAND_SMALL}</small>
          <b>{NAV_BRAND_NAME}</b>
        </span>
      </Link>
      <div className="rite-nav-links">
        <a href="#rooms">{NAV_ROOMS_LABEL}</a>
        <Link to="/login">{NAV_SIGN_IN_LABEL}</Link>
        <Link className="rite-nav-cta" to={RETURN_CTA_HREF}>
          {NAV_PLAN_LABEL}
        </Link>
      </div>
    </nav>
  );
}
