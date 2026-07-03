import { useRef, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useSeen } from "./useSeen.js";
import { tradesHallVenueImages } from "../../lib/trades-hall-room-showcase.js";
import {
  enquiryMailtoHref,
  FOOTER_ADDRESS_LINES,
  FOOTER_BASELINE,
  FOOTER_BASELINE_RIGHT,
  FOOTER_EMAIL,
  FOOTER_LEGAL_LINKS,
  FOOTER_PHONE_DISPLAY,
  FOOTER_PHONE_HREF,
  NAV_BRAND_NAME,
  NAV_BRAND_SMALL,
  RETURN_CTA_HREF,
  RETURN_CTA_LABEL,
  RETURN_LINE,
  RETURN_SECONDARY_LABEL,
} from "./rite-copy.js";

// -----------------------------------------------------------------------------
// ReturnAct — the will re-enters.
//
// Full darkness again, one line, one gold CTA into the planner. The CTA
// ignites: on pointer entry we record the entry angle so the light sweep
// crosses the button from exactly where the visitor arrived. Below, the
// practical footer — address, enquiry, legal — carries the page's single
// `#contact` anchor (room showcase pages deep-link to it).
// -----------------------------------------------------------------------------

function setSweepOrigin(event: ReactPointerEvent<HTMLElement>): void {
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  el.style.setProperty("--sweep-x", `${String(Math.round(x))}%`);
  el.style.setProperty("--sweep-y", `${String(Math.round(y))}%`);
}

export function ReturnAct(): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const seen = useSeen(ref, 0.5);

  return (
    <section className="rite-act rite-return" aria-label="Begin planning">
      <div ref={ref} className={`rite-return-stage${seen ? " is-seen" : ""}`}>
        <p className="rite-return-line">{RETURN_LINE}</p>
        <Link
          className="rite-cta"
          to={RETURN_CTA_HREF}
          onPointerEnter={setSweepOrigin}
        >
          {RETURN_CTA_LABEL} <span aria-hidden>→</span>
        </Link>
        <a className="rite-return-secondary" href="#contact">
          {RETURN_SECONDARY_LABEL}
        </a>
      </div>

      {/* The hall from Glassford Street — the rite ends where the evening
          will begin. */}
      <figure className="rite-exterior">
        <img
          src={tradesHallVenueImages.exterior}
          alt="The Trades Hall facade on Glassford Street at dusk"
          loading="lazy"
          decoding="async"
        />
      </figure>

      <footer id="contact" className="rite-footer">
        <div className="rite-footer-grid">
          <div className="rite-footer-brand">
            <span className="rite-crest" aria-hidden>Th</span>
            <span className="rite-lockup">
              <small>{NAV_BRAND_SMALL}</small>
              <b>{NAV_BRAND_NAME}</b>
            </span>
          </div>
          <address className="rite-footer-address">
            {FOOTER_ADDRESS_LINES.map((line) => (
              <span key={line}>{line}</span>
            ))}
            <span className="rite-footer-contact">
              <a href={FOOTER_PHONE_HREF}>{FOOTER_PHONE_DISPLAY}</a>
              <span aria-hidden> · </span>
              <a href={enquiryMailtoHref()}>{FOOTER_EMAIL}</a>
            </span>
          </address>
          <ul className="rite-footer-legal">
            {FOOTER_LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link to={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="rite-footer-baseline">
          <span>{FOOTER_BASELINE}</span>
          <span>{FOOTER_BASELINE_RIGHT}</span>
        </div>
      </footer>
    </section>
  );
}
