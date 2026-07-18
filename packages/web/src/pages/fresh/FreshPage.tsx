import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
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
  FRESH_CONTACT_TEL_LABEL,
  FRESH_CONTACT_EMAIL_LABEL,
  FRESH_CONTACT_VISIT_LABEL,
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
  FRESH_ENQUIRY_COPIED,
  FRESH_ENQUIRY_COPY_ACTION,
  FRESH_ENQUIRY_DATE_LABEL,
  FRESH_ENQUIRY_EVENT_LABEL,
  FRESH_ENQUIRY_GUESTS_LABEL,
  FRESH_ENQUIRY_GUESTS_PROMPT,
  FRESH_ENQUIRY_LEDE,
  FRESH_ENQUIRY_OR_CALL,
  FRESH_ENQUIRY_SEND,
  FRESH_ENQUIRY_TITLE,
  FRESH_HERO_LADDER,
  FRESH_HERO_PORTRAIT_MEDIA,
  FRESH_HERO_PORTRAIT_SRCSET,
  FRESH_HERO_SIZES,
  FRESH_HERITAGE_LADDER,
  FRESH_HERITAGE_SIZES,
  FRESH_ROOM_SIZES,
  FRESH_DOSSIER_OPEN,
  FRESH_WALK_CHIP,
  FRESH_WALK_FAILED,
  FRESH_WALK_HINT,
  FRESH_WALK_LEDE,
  FRESH_WALK_LOADING,
  FRESH_WALK_NOTE,
  FRESH_WALK_POSTER,
  FRESH_WALK_POSTER_ALT,
  FRESH_WALK_POSTER_SIZES,
  FRESH_WALK_POSTER_SRCSET,
  FRESH_WALK_SIZE_NOTE,
  FRESH_WALK_TITLE,
  FRESH_WALK_WAKE,
  ladderSrcSet,
  type FreshRoom,
} from "./fresh-copy.js";
import { RoomDossier } from "./RoomDossier.js";

/** The captured room costs nothing until invited: three + Spark live in
 *  this chunk, which only downloads when the visitor steps in. */
const FreshWalk = lazy(() => import("./FreshWalk.js"));

type WalkState = "poster" | "loading" | "live" | "failed";
import {
  ENQUIRY_EVENT_TYPES,
  alsoFitsSentence,
  composeEnquiry,
  enquiryYear,
  fitReport,
  fitSentence,
  weddingRateLine,
  weddingScopeNote,
  type EnquiryEventKey,
} from "./enquiry-fit.js";
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

/** The Enquiry Composer — the conversation half. State stays tiny: an
 *  occasion, a guest count (kept as text so half-typed numbers don't judder
 *  the answer), an optional date. Everything said below it is computed by
 *  enquiry-fit from published figures, and the finished email is visible,
 *  copyable, and openable — no dead-end links. */
function FreshEnquiry(): ReactElement {
  const [eventKey, setEventKey] = useState<EnquiryEventKey>("wedding");
  const [guestsText, setGuestsText] = useState("100");
  const [dateISO, setDateISO] = useState("");
  const [copied, setCopied] = useState(false);

  const guestsParsed = Number.parseInt(guestsText, 10);
  const guests =
    Number.isFinite(guestsParsed) && guestsParsed >= 2 && guestsParsed <= 999
      ? guestsParsed
      : null;

  const report = useMemo(
    () => (guests === null ? null : fitReport(eventKey, guests)),
    [eventKey, guests],
  );
  const composed = useMemo(
    () =>
      guests === null
        ? null
        : composeEnquiry({ eventKey, guests, dateISO }, FRESH_CONTACT_EMAIL),
    [eventKey, guests, dateISO],
  );
  const also = report === null ? "" : alsoFitsSentence(report);
  const rateLine =
    eventKey === "wedding" ? weddingRateLine(enquiryYear(dateISO)) : null;
  const scopeNote =
    eventKey === "wedding" && guests !== null ? weddingScopeNote(guests) : null;
  const today = new Date().toISOString().slice(0, 10);

  const copyEnquiry = useCallback(() => {
    if (composed === null) return;
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) return;
    void clipboard
      .writeText(`${composed.subject}\n\n${composed.body}`)
      .then(() => {
        setCopied(true);
      })
      .catch(() => undefined);
  }, [composed]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 1600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  return (
    <div className="fr-enq">
      <div className="fr-enq-controls">
        <fieldset className="fr-enq-types">
          <legend>{FRESH_ENQUIRY_EVENT_LABEL}</legend>
          <div className="fr-enq-pills">
            {ENQUIRY_EVENT_TYPES.map((type) => (
              <button
                key={type.key}
                type="button"
                aria-pressed={eventKey === type.key}
                onClick={() => {
                  setEventKey(type.key);
                }}
              >
                {type.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="fr-enq-fields">
          <label className="fr-enq-field">
            <span>{FRESH_ENQUIRY_GUESTS_LABEL}</span>
            <input
              type="number"
              inputMode="numeric"
              min={2}
              max={999}
              value={guestsText}
              onChange={(event) => {
                setGuestsText(event.target.value);
              }}
            />
          </label>
          <label className="fr-enq-field">
            <span>{FRESH_ENQUIRY_DATE_LABEL}</span>
            <input
              type="date"
              min={today}
              value={dateISO}
              onChange={(event) => {
                setDateISO(event.target.value);
              }}
            />
          </label>
        </div>
      </div>

      <div className="fr-enq-answer" aria-live="polite">
        {report === null ? (
          <p className="fr-enq-fit">{FRESH_ENQUIRY_GUESTS_PROMPT}</p>
        ) : (
          <>
            <p className="fr-enq-fit">{fitSentence(report)}</p>
            {also !== "" && <p className="fr-enq-also">{also}</p>}
            {rateLine !== null && <p className="fr-enq-also">{rateLine}</p>}
            {scopeNote !== null && <p className="fr-enq-also">{scopeNote}</p>}
          </>
        )}
      </div>

      {composed !== null && (
        <div className="fr-enq-compose">
          <p className="fr-enq-subject">{composed.subject}</p>
          <pre className="fr-enq-body">{composed.body}</pre>
          <div className="fr-enq-actions">
            <a className="fr-cta" href={composed.mailtoHref}>
              {FRESH_ENQUIRY_SEND}
            </a>
            <button type="button" className="fr-enq-copy" onClick={copyEnquiry}>
              {copied ? FRESH_ENQUIRY_COPIED : FRESH_ENQUIRY_COPY_ACTION}
            </button>
            <span className="fr-enq-call">
              {FRESH_ENQUIRY_OR_CALL}{" "}
              <a href={FRESH_CONTACT_PHONE_HREF}>{FRESH_CONTACT_PHONE_DISPLAY}</a>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

const roomCaps = (slug: keyof typeof TRADES_HALL_ROOM_CAPACITIES): string =>
  CAPACITY_FORMATS.map(
    (f) => `${f.label} ${String(TRADES_HALL_ROOM_CAPACITIES[slug][f.key])}`,
  ).join(" · ");

export function FreshPage(): ReactElement {
  const [theme, setTheme] = useState<FreshTheme>(() => loadTheme());
  const [dossierRoom, setDossierRoom] = useState<FreshRoom | null>(null);
  const [walkState, setWalkState] = useState<WalkState>("poster");
  const [walkPercent, setWalkPercent] = useState(0);
  const reveal = useRevealOnce();
  const aperture = useDomeAperture();

  const wakeWalk = useCallback(() => {
    // Cheap honesty check before paying for the chunk: no WebGL, no room.
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
    setWalkState(gl === null ? "failed" : "loading");
  }, []);

  // Identity-stable for FreshWalk: new callback identities would make the
  // splat layers dispose and refetch their tiles on every progress tick.
  const walkLive = useCallback(() => {
    setWalkState("live");
  }, []);
  const walkFailed = useCallback(() => {
    setWalkState("failed");
  }, []);
  const walkProgress = useCallback((loaded: number, total: number) => {
    setWalkPercent(Math.round((loaded / total) * 100));
  }, []);

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

  // On narrow screens the three-pill row gives way to one cycling button —
  // the header's prime pixels belong to the photograph, not a preference.
  const cycleTheme = useCallback(() => {
    const order: readonly FreshTheme[] = ["auto", "light", "dark"];
    const next = order[(order.indexOf(theme) + 1) % order.length] ?? "auto";
    applyTheme(next);
  }, [applyTheme, theme]);

  const themeLabel =
    FRESH_THEME_OPTIONS.find((option) => option.key === theme)?.label ?? "Auto";

  return (
    <div className="fr-root" data-theme={theme === "auto" ? undefined : theme}>
      <a className="fr-skip" href="#rooms">
        Skip to the rooms
      </a>

      <header className="fr-header">
        <p className="fr-brand">
          <img className="fr-brand-mark" src={FRESH_ARMS_MARK} alt="" width={64} height={80} />
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
          <button
            type="button"
            className="fr-theme-cycle"
            onClick={cycleTheme}
            aria-label={`${FRESH_THEME_LABEL}: ${themeLabel}`}
          >
            {themeLabel}
          </button>
          <a className="fr-header-cta" href="#enquire">
            {FRESH_CTA_DATES}
          </a>
        </div>
      </header>

      <main>
        {/* ——— hero: the photograph, and the breathing word ——— */}
        <section className="fr-hero" aria-labelledby="fr-headline">
          <div className="fr-hero-frame" ref={aperture.frameRef}>
            <picture>
              {/* Narrow screens: the purpose-cut portrait, dome centred. */}
              <source
                media={FRESH_HERO_PORTRAIT_MEDIA}
                srcSet={FRESH_HERO_PORTRAIT_SRCSET}
                sizes="calc(100vw - 32px)"
                width={768}
                height={864}
              />
              <img
                className="fr-hero-photo"
                src={FRESH_HERO_IMAGE}
                srcSet={ladderSrcSet(FRESH_HERO_IMAGE, FRESH_HERO_LADDER)}
                sizes={FRESH_HERO_SIZES}
                alt={FRESH_HERO_ALT}
                width={1536}
                height={864}
                fetchPriority="high"
                decoding="async"
                ref={aperture.imgRef}
              />
            </picture>
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
              <a className="fr-cta" href="#enquire">
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
                  srcSet={ladderSrcSet(room.image, room.ladder)}
                  sizes={FRESH_ROOM_SIZES}
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
                  <button
                    type="button"
                    className="fr-room-open"
                    onClick={() => {
                      setDossierRoom(room);
                    }}
                  >
                    {FRESH_DOSSIER_OPEN}
                  </button>
                </div>
              </article>
            ))}
          </div>
          <p className="fr-galleries" ref={reveal}>
            {FRESH_GALLERIES_NOTE}
          </p>
        </section>

        {/* ——— walk the room: the capture, poster-first ——— */}
        <section className="fr-walk" id="walk" aria-labelledby="fr-walk-title">
          <div className="fr-arch is-flipped" aria-hidden />
          <h2 id="fr-walk-title">{FRESH_WALK_TITLE}</h2>
          <p className="fr-section-lede">{FRESH_WALK_LEDE}</p>
          <div className="fr-walk-stage" data-walk-state={walkState}>
            {(walkState === "loading" || walkState === "live") && (
              <Suspense fallback={null}>
                <FreshWalk
                  onLive={walkLive}
                  onFailed={walkFailed}
                  onProgress={walkProgress}
                />
              </Suspense>
            )}
            <img
              className="fr-walk-poster"
              src={FRESH_WALK_POSTER}
              srcSet={FRESH_WALK_POSTER_SRCSET}
              sizes={FRESH_WALK_POSTER_SIZES}
              alt={FRESH_WALK_POSTER_ALT}
              loading="lazy"
              decoding="async"
              width={1120}
              height={700}
            />
            {walkState === "poster" && (
              <div className="fr-walk-veil">
                <p className="fr-walk-chip">{FRESH_WALK_CHIP}</p>
                <button type="button" className="fr-cta" onClick={wakeWalk}>
                  {FRESH_WALK_WAKE}
                </button>
                <p className="fr-walk-size">{FRESH_WALK_SIZE_NOTE}</p>
              </div>
            )}
            {walkState === "loading" && (
              <div className="fr-walk-veil" aria-live="polite">
                <p className="fr-walk-chip">
                  {FRESH_WALK_LOADING} — {String(walkPercent)}%
                </p>
                <div
                  className="fr-walk-bar"
                  role="progressbar"
                  aria-valuenow={walkPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div style={{ width: `${String(walkPercent)}%` }} />
                </div>
              </div>
            )}
            {walkState === "failed" && (
              <div className="fr-walk-veil">
                <p className="fr-walk-chip">{FRESH_WALK_FAILED}</p>
              </div>
            )}
          </div>
          <p className="fr-walk-hint">
            {walkState === "live" ? FRESH_WALK_HINT : FRESH_WALK_NOTE}
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

        {/* ——— the enquiry composer: the page answers, then writes the email ——— */}
        <section className="fr-enquiry" id="enquire" aria-labelledby="fr-enquiry-title">
          <div className="fr-arch" aria-hidden />
          <h2 id="fr-enquiry-title">{FRESH_ENQUIRY_TITLE}</h2>
          <p className="fr-section-lede">{FRESH_ENQUIRY_LEDE}</p>
          <FreshEnquiry />
        </section>

        {/* ——— heritage: one photograph, one paragraph ——— */}
        <section className="fr-heritage" aria-labelledby="fr-heritage-title">
          <img
            className="fr-heritage-art"
            src={FRESH_HERITAGE_ART}
            srcSet={ladderSrcSet(FRESH_HERITAGE_ART, FRESH_HERITAGE_LADDER)}
            sizes={FRESH_HERITAGE_SIZES}
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

      <RoomDossier
        room={dossierRoom}
        onClose={() => {
          setDossierRoom(null);
        }}
      />

      <footer className="fr-contact" id="contact" aria-labelledby="fr-contact-title">
        <h2 id="fr-contact-title">{FRESH_CONTACT_TITLE}</h2>
        <div className="fr-contact-grid">
          <div className="fr-contact-ways">
            <p className="fr-contact-way">
              <small>{FRESH_CONTACT_TEL_LABEL}</small>
              <a href={FRESH_CONTACT_PHONE_HREF}>{FRESH_CONTACT_PHONE_DISPLAY}</a>
            </p>
            <p className="fr-contact-way">
              <small>{FRESH_CONTACT_EMAIL_LABEL}</small>
              <a href={freshEnquiryHref()}>{FRESH_CONTACT_EMAIL}</a>
            </p>
            <p className="fr-contact-way">
              <small>{FRESH_CONTACT_VISIT_LABEL}</small>
              <a href={FRESH_MAPS_HREF} target="_blank" rel="noreferrer">
                {FRESH_ADDRESS}
              </a>
            </p>
          </div>
          <div className="fr-colophon">
            <img src={FRESH_ARMS} alt={FRESH_ARMS_ALT} loading="lazy" decoding="async" width={240} height={300} />
            <p className="fr-motto">
              <em>{FRESH_MOTTO}</em>
              <span>{FRESH_MOTTO_ATTR}</span>
            </p>
          </div>
        </div>
        <p className="fr-footer-note">{FRESH_FOOTER_NOTE}</p>
      </footer>
    </div>
  );
}

export default FreshPage;
