import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  CAPACITY_FORMATS,
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_WEDDING_PRICING,
  formatPriceGBP,
} from "../../lib/trades-hall-venue-truth.js";
import {
  FRESH_ADDRESS,
  FRESH_BRAND_NAME,
  FRESH_BRAND_SMALL,
  FRESH_CONTACT_EMAIL,
  FRESH_CONTACT_PHONE_DISPLAY,
  FRESH_CONTACT_PHONE_HREF,
  FRESH_CONTACT_TITLE,
  FRESH_CTA_DATES,
  FRESH_CTA_ROOMS,
  FRESH_FOOTER_NOTE,
  FRESH_ARMS,
  FRESH_ARMS_ALT,
  FRESH_ARMS_MARK,
  FRESH_GALLERIES_NOTE,
  FRESH_HEADLINE_AFTER,
  FRESH_HEADLINE_BEFORE,
  FRESH_HEADLINE_KINETIC,
  FRESH_HERITAGE_ART,
  FRESH_HERITAGE_ART_ALT,
  FRESH_HERITAGE_BODY,
  FRESH_HERITAGE_TITLE,
  FRESH_HERO_ALT,
  FRESH_HERO_IMAGE,
  FRESH_LEDE,
  FRESH_MAPS_HREF,
  FRESH_META_TITLE,
  FRESH_MOTTO,
  FRESH_MOTTO_ATTR,
  FRESH_RATES_NOTE,
  FRESH_RATES_TITLE,
  FRESH_ROOMS,
  FRESH_ROOMS_LEDE,
  FRESH_ROOMS_TITLE,
  FRESH_THEME_LABEL,
  FRESH_THEME_OPTIONS,
  freshEnquiryHref,
} from "./fresh-copy.js";
import "./fresh.css";

// -----------------------------------------------------------------------------
// FreshPage — /fresh: the pictures-only prototype, 2026 grammar.
//
// Light-first and photography-forward, grounded in the building itself:
// blond sandstone paper, bottle-green ink accents (the panelled rooms),
// Robert Adam's elliptical geometry as section dividers, and one bold move —
// the word "lit" in the headline breathes on Fraunces' variable axes like a
// candle. Dark mode follows the system (dark grey, never pure black) with a
// manual override that persists. Micro-interactions are functional only;
// reveals are once-per-visit and vanish under reduced motion. No splats,
// no canvas: photographs, type, and restraint.
// -----------------------------------------------------------------------------

type FreshTheme = "auto" | "light" | "dark";
const THEME_KEY = "fresh-theme.v1";

function loadTheme(): FreshTheme {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    return raw === "light" || raw === "dark" ? raw : "auto";
  } catch {
    return "auto";
  }
}

/** Reveal-on-scroll, once, honouring reduced motion by never hiding.
 *  Refs only queue nodes; the effect owns the observer's lifecycle — under
 *  StrictMode the effect teardown/setup cycle rebuilds a live observer,
 *  where a ref-created observer would die at first cleanup. */
function useRevealOnce(): (node: HTMLElement | null) => void {
  const nodesRef = useRef<Set<HTMLElement>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('fr-revealed');
            obs.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '-64px' },
    );
    observerRef.current = observer;
    for (const node of nodesRef.current) observer.observe(node);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  return useCallback((node: HTMLElement | null) => {
    if (node === null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    node.classList.add('fr-will-reveal');
    nodesRef.current.add(node);
    observerRef.current?.observe(node);
  }, []);
}

/** The dome aperture — the hero's frame-break.
 *
 *  The aerial photograph is top-anchored (object-position 50% 0), so on any
 *  frame wider than the photo's 3:2 the cover crop is width-determined: the
 *  dome sits at a fixed fraction of the frame's width. That makes a
 *  frame-break stable by construction. The photo's top edge is clipped down
 *  to a drawn reveal line — except over the dome, where a fanlight arc lets
 *  the skyline push up through the page. One image, one computed clip:
 *  no cutouts, no second copy, nothing that can drift.
 *
 *  Below APERTURE_MIN_ASPECT the cover crop becomes height-determined and
 *  the width math no longer holds, so the aperture stands down and the
 *  plain top-anchored crop (dome fully in frame) carries the hero. */
/** Pixel-measured from the photograph itself (region-grow over the cap's
 *  patina, 2026-07-12): the 1536×864 source holds the cap centred at
 *  x 0.554, spanning 0.066–0.127 of frame width vertically on screen.
 *  The arch is derived from those measurements — centred on the cap, a
 *  snug halo of its width, apex just clear of the tip — so the dome
 *  fills its aperture instead of drifting inside an oversized one. */
const DOME_X = 0.554; // cap centre, fraction of frame width
const DOME_TIP = 0.0664; // cap tip y, fraction of frame width
const DOME_APERTURE_R = 0.0326; // arch radius: ~1.4× the cap's half-width
const APEX_GAP = 0.007; // clearance between arch apex and cap tip
const DOME_REVEAL = DOME_TIP - APEX_GAP + DOME_APERTURE_R; // spring line
const APERTURE_CORNER = 0.07; // top-right corner sweep on the reveal line
const APERTURE_MIN_ASPECT = 1.85; // photo is 16:9 (1536×864); wider only

interface DomeApertureRefs {
  readonly frameRef: (node: HTMLDivElement | null) => void;
  readonly imgRef: (node: HTMLImageElement | null) => void;
  readonly svgRef: (node: SVGSVGElement | null) => void;
}

function useDomeAperture(): DomeApertureRefs {
  const frame = useRef<HTMLDivElement | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);

  const apply = useCallback(() => {
    const frameEl = frame.current;
    const imgEl = img.current;
    const svgEl = svg.current;
    if (!frameEl || !imgEl || !svgEl) return;
    const w = frameEl.clientWidth;
    const h = frameEl.clientHeight;
    if (w === 0 || h === 0 || w / h < APERTURE_MIN_ASPECT) {
      imgEl.style.clipPath = "";
      svgEl.style.display = "none";
      return;
    }
    const cx = DOME_X * w;
    const reveal = DOME_REVEAL * w;
    const r = DOME_APERTURE_R * w;
    const corner = APERTURE_CORNER * w;
    const edge = [
      `M 0 ${String(reveal)}`,
      `L ${String(cx - r)} ${String(reveal)}`,
      `A ${String(r)} ${String(r)} 0 0 1 ${String(cx + r)} ${String(reveal)}`,
      `L ${String(w - corner)} ${String(reveal)}`,
      `A ${String(corner)} ${String(corner)} 0 0 1 ${String(w)} ${String(reveal + corner)}`,
    ];
    const outline = [...edge, `L ${String(w)} ${String(h)}`, `L 0 ${String(h)}`, "Z"];
    imgEl.style.clipPath = `path("${outline.join(" ")}")`;
    svgEl.style.display = "";
    svgEl.setAttribute("viewBox", `0 0 ${String(w)} ${String(h)}`);
    svgEl.querySelector("[data-fanlight]")?.setAttribute("d", edge.join(" "));
    svgEl
      .querySelector("[data-keystone]")
      ?.setAttribute("d", `M ${String(cx)} ${String(reveal - r - 6)} v 5`);
  }, []);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      apply();
      return;
    }
    const observer = new ResizeObserver(apply);
    if (frame.current) observer.observe(frame.current);
    apply();
    return () => {
      observer.disconnect();
    };
  }, [apply]);

  return {
    frameRef: useCallback(
      (node: HTMLDivElement | null) => {
        frame.current = node;
        apply();
      },
      [apply],
    ),
    imgRef: useCallback(
      (node: HTMLImageElement | null) => {
        img.current = node;
        apply();
      },
      [apply],
    ),
    svgRef: useCallback(
      (node: SVGSVGElement | null) => {
        svg.current = node;
        apply();
      },
      [apply],
    ),
  };
}

const roomCaps = (slug: keyof typeof TRADES_HALL_ROOM_CAPACITIES): string =>
  CAPACITY_FORMATS.map(
    (f) => `${f.label} ${String(TRADES_HALL_ROOM_CAPACITIES[slug][f.key])}`,
  ).join(" · ");

export function FreshPage(): ReactElement {
  const [theme, setTheme] = useState<FreshTheme>(() => loadTheme());
  const reveal = useRevealOnce();
  const aperture = useDomeAperture();

  useEffect(() => {
    document.title = FRESH_META_TITLE;
  }, []);

  const applyTheme = useCallback((next: FreshTheme) => {
    setTheme(next);
    try {
      if (next === "auto") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Session-only preference when storage is unavailable.
    }
  }, []);

  return (
    <div className="fr-root" data-theme={theme === "auto" ? undefined : theme}>
      <a className="fr-skip" href="#rooms">
        Skip to the rooms
      </a>

      <header className="fr-header">
        <p className="fr-brand">
          <img className="fr-brand-mark" src={FRESH_ARMS_MARK} alt="" width={120} height={150} />
          <span>
            <small>{FRESH_BRAND_SMALL}</small>
            <b>{FRESH_BRAND_NAME}</b>
          </span>
        </p>
        <div className="fr-header-side">
          <fieldset className="fr-theme" aria-label={FRESH_THEME_LABEL}>
            {FRESH_THEME_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={theme === option.key}
                onClick={() => {
                  applyTheme(option.key);
                }}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
          <a className="fr-header-cta" href={FRESH_CONTACT_PHONE_HREF}>
            {FRESH_CTA_DATES}
          </a>
        </div>
      </header>

      <main>
        {/* ——— hero: the photograph, and the breathing word ——— */}
        <section className="fr-hero" aria-labelledby="fr-headline">
          <div className="fr-hero-frame" ref={aperture.frameRef}>
            <img
              className="fr-hero-photo"
              src={FRESH_HERO_IMAGE}
              alt={FRESH_HERO_ALT}
              width={1536}
              height={864}
              fetchPriority="high"
              decoding="async"
              ref={aperture.imgRef}
            />
            {/* The photo's drawn top edge: flat, then a fanlight over the
                real dome, then the corner sweep — with a keystone tick. */}
            <svg className="fr-hero-fanlight" aria-hidden ref={aperture.svgRef}>
              <path data-fanlight d="" />
              <path data-keystone d="" />
            </svg>
          </div>
          <div className="fr-hero-panel">
            <h1 id="fr-headline">
              <span className="fr-w">{FRESH_HEADLINE_BEFORE}</span>{" "}
              <em className="fr-kinetic">{FRESH_HEADLINE_KINETIC}</em>{" "}
              <span className="fr-w">{FRESH_HEADLINE_AFTER}</span>
            </h1>
            <p className="fr-lede">{FRESH_LEDE}</p>
            <div className="fr-hero-actions">
              <a className="fr-cta" href={FRESH_CONTACT_PHONE_HREF}>
                {FRESH_CTA_DATES}
              </a>
              <a className="fr-cta-quiet" href="#rooms">
                {FRESH_CTA_ROOMS}
              </a>
            </div>
          </div>
        </section>

        {/* ——— the rooms: asymmetric, alternating, honest capacities ——— */}
        <section className="fr-rooms" id="rooms" aria-labelledby="fr-rooms-title">
          <div className="fr-arch" aria-hidden />
          <h2 id="fr-rooms-title">{FRESH_ROOMS_TITLE}</h2>
          <p className="fr-section-lede">{FRESH_ROOMS_LEDE}</p>
          <div className="fr-room-flow">
            {FRESH_ROOMS.map((room, index) => (
              <article
                key={room.slug}
                className={`fr-room${index % 2 === 1 ? " is-flipped" : ""}`}
                ref={reveal}
              >
                <img
                  className={room.portrait === true ? "is-portrait" : undefined}
                  src={room.image}
                  alt={room.alt}
                  loading="lazy"
                  decoding="async"
                  width={room.width}
                  height={room.height}
                  style={
                    room.focus === undefined
                      ? undefined
                      : { objectPosition: room.focus }
                  }
                />
                <div className="fr-room-words">
                  <h3>{room.name}</h3>
                  <p>{room.line}</p>
                  <p className="fr-caps" data-room-caps={room.slug}>
                    {roomCaps(room.slug)}
                  </p>
                </div>
              </article>
            ))}
          </div>
          <p className="fr-galleries" ref={reveal}>
            {FRESH_GALLERIES_NOTE}
          </p>
        </section>

        {/* ——— rates: the venue's own numbers, plainly ——— */}
        <section className="fr-rates" aria-labelledby="fr-rates-title">
          <div className="fr-arch is-flipped" aria-hidden />
          <h2 id="fr-rates-title">{FRESH_RATES_TITLE}</h2>
          <p className="fr-section-lede">{FRESH_RATES_NOTE}</p>
          <div className="fr-rate-columns">
            {TRADES_HALL_WEDDING_PRICING.seasons.map((season) => (
              <dl key={season.years} ref={reveal}>
                <dt>{season.years}</dt>
                {season.rates.map((rate) => (
                  <div className="fr-rate" key={rate.packageName} data-rate-row>
                    <dd>{rate.packageName}</dd>
                    <dd className="fr-price">{formatPriceGBP(rate.priceGBP)}</dd>
                  </div>
                ))}
              </dl>
            ))}
          </div>
          <p className="fr-scope">{TRADES_HALL_WEDDING_PRICING.scope}.</p>
        </section>

        {/* ——— heritage: one photograph, one paragraph ——— */}
        <section className="fr-heritage" aria-labelledby="fr-heritage-title">
          <img
            className="fr-heritage-art"
            src={FRESH_HERITAGE_ART}
            alt={FRESH_HERITAGE_ART_ALT}
            loading="lazy"
            decoding="async"
            width={1448}
            height={1086}
          />
          <div className="fr-heritage-words" ref={reveal}>
            <h2 id="fr-heritage-title">{FRESH_HERITAGE_TITLE}</h2>
            <p>{FRESH_HERITAGE_BODY}</p>
          </div>
        </section>
      </main>

      <footer className="fr-contact" id="contact" aria-labelledby="fr-contact-title">
        <h2 id="fr-contact-title">{FRESH_CONTACT_TITLE}</h2>
        <div className="fr-contact-ways">
          <a href={FRESH_CONTACT_PHONE_HREF}>{FRESH_CONTACT_PHONE_DISPLAY}</a>
          <a href={freshEnquiryHref()}>{FRESH_CONTACT_EMAIL}</a>
          <a href={FRESH_MAPS_HREF} target="_blank" rel="noreferrer">
            {FRESH_ADDRESS}
          </a>
        </div>
        <div className="fr-colophon">
          <img src={FRESH_ARMS} alt={FRESH_ARMS_ALT} loading="lazy" decoding="async" width={480} height={600} />
          <p className="fr-motto">
            <em>{FRESH_MOTTO}</em>
            <span>{FRESH_MOTTO_ATTR}</span>
          </p>
        </div>
        <p className="fr-footer-note">{FRESH_FOOTER_NOTE}</p>
      </footer>
    </div>
  );
}

export default FreshPage;
