import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { useCursorLight } from "../landing/useCursorLight.js";
import { useReducedMotion } from "../landing/useReducedMotion.js";
import {
  SPOTLIGHT_BASE_ALT,
  SPOTLIGHT_BASE_IMAGE,
  SPOTLIGHT_BRAND_NAME,
  SPOTLIGHT_CTA_HREF,
  SPOTLIGHT_CTA_LABEL,
  SPOTLIGHT_HEADLINE_ITALIC,
  SPOTLIGHT_HEADLINE_ROMAN,
  SPOTLIGHT_MENU_LABEL,
  SPOTLIGHT_META_TITLE,
  SPOTLIGHT_NAV_LINKS,
  SPOTLIGHT_PRODUCT_LINE,
  SPOTLIGHT_REVEAL_IMAGE,
  SPOTLIGHT_SIGN_IN_HREF,
  SPOTLIGHT_SIGN_IN_LABEL,
  SPOTLIGHT_VENUE_LINE,
} from "./spotlight-copy.js";
import "./spotlight.css";

// -----------------------------------------------------------------------------
// SpotlightLandingPage — /welcome, the white-label hero for the venue's site.
//
// One dark viewport: the empty Grand Hall as the base, the dressed room
// revealed through a soft circular mask that follows the carried light.
// useCursorLight drives --light-x/--light-y on the section (sprung, or
// pinned directly to the pointer under reduced motion); the mask is a fixed
// radial-gradient tile moved via mask-position — no canvas, no per-frame
// encode, no gradient re-raster. The light starts at the viewport's heart,
// so the dressed room glows through on load even before the first pointer
// move (and on touch, where the light follows the finger's drag).
// -----------------------------------------------------------------------------

export function SpotlightLandingPage(): ReactElement {
  const sectionRef = useRef<HTMLElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const reducedMotion = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();

  // The reveal must follow the pointer for everyone: reduced motion removes
  // the spring lag (direct mode), never the light itself — freezing it left
  // the page a static image for Windows "animation effects off" visitors.
  useCursorLight(sectionRef, reducedMotion ? "direct" : "spring");

  useEffect(() => {
    document.title = SPOTLIGHT_META_TITLE;
  }, []);

  // Disclosure baseline: Escape closes the menu and hands focus back.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="vv-spotlight">
      <nav className="sp-nav" aria-label="Trades Hall">
        <Link to="/welcome" className="sp-brand">
          <span className="sp-crest" aria-hidden>
            Th
          </span>
          <span className="sp-wordmark">{SPOTLIGHT_BRAND_NAME}</span>
        </Link>

        <div className="sp-nav-pill">
          {SPOTLIGHT_NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              className={`sp-nav-link${link.current ? " is-current" : ""}`}
              aria-current={link.current ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <Link to={SPOTLIGHT_SIGN_IN_HREF} className="sp-signin">
          {SPOTLIGHT_SIGN_IN_LABEL}
        </Link>

        <button
          ref={menuButtonRef}
          type="button"
          className="sp-menu-btn"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => {
            setMenuOpen((open) => !open);
          }}
        >
          {menuOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          <span className="vv-sr-only">{SPOTLIGHT_MENU_LABEL}</span>
        </button>
      </nav>

      <div id={menuId} className={`sp-menu${menuOpen ? " is-open" : ""}`}>
        {SPOTLIGHT_NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            to={link.href}
            onClick={() => {
              setMenuOpen(false);
            }}
          >
            {link.label}
          </Link>
        ))}
        <Link
          to={SPOTLIGHT_SIGN_IN_HREF}
          onClick={() => {
            setMenuOpen(false);
          }}
        >
          {SPOTLIGHT_SIGN_IN_LABEL}
        </Link>
      </div>

      <main
        ref={sectionRef}
        className={`sp-hero${reducedMotion ? " is-static" : ""}`}
        aria-label={SPOTLIGHT_META_TITLE}
      >
        <div
          className="sp-base"
          role="img"
          aria-label={SPOTLIGHT_BASE_ALT}
          style={{ backgroundImage: `url(${SPOTLIGHT_BASE_IMAGE})` }}
        />
        <div
          className="sp-reveal"
          aria-hidden
          style={{ backgroundImage: `url(${SPOTLIGHT_REVEAL_IMAGE})` }}
        />

        <div className="sp-heading">
          <h1>
            <span className="sp-heading-italic sp-anim sp-rise">
              {SPOTLIGHT_HEADLINE_ITALIC}
            </span>
            <span className="sp-heading-roman sp-anim sp-rise sp-rise-late">
              {SPOTLIGHT_HEADLINE_ROMAN}
            </span>
          </h1>
        </div>

        <p className="sp-venue-line sp-anim sp-fade">{SPOTLIGHT_VENUE_LINE}</p>

        <div className="sp-invite sp-anim sp-fade sp-fade-late">
          <p>{SPOTLIGHT_PRODUCT_LINE}</p>
          <Link className="sp-cta" to={SPOTLIGHT_CTA_HREF}>
            {SPOTLIGHT_CTA_LABEL} <span aria-hidden>→</span>
          </Link>
        </div>
      </main>
    </div>
  );
}

export default SpotlightLandingPage;
