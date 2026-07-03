import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { ThresholdAct } from "./landing/ThresholdAct.js";
import { MagnitudeAct } from "./landing/MagnitudeAct.js";
import { ContemplationAct } from "./landing/ContemplationAct.js";
import { ReturnAct } from "./landing/ReturnAct.js";
import { RiteNav } from "./landing/RiteNav.js";
import { useCursorLight } from "./landing/useCursorLight.js";
import { useReducedMotion } from "./landing/useReducedMotion.js";
import { useRoomTone } from "./landing/useRoomTone.js";
import { hasEnteredBefore, useScrollRite } from "./landing/useScrollRite.js";
import { isAfterDusk } from "./landing/rite-motion.js";
import {
  AWAY_TAB_TITLE,
  RITE_META_DESC,
  RITE_META_TITLE,
  SKIP_TO_ROOMS_LABEL,
} from "./landing/rite-copy.js";
import "./landing/rite.css";

// -----------------------------------------------------------------------------
// LandingPage — The Rite. Public marketing homepage at `/` (also `/landing`
// and `/editor`) for Trades Hall Glasgow.
//
// A three-act dramaturgy of the sublime: darkness (Burke), magnitude (Kant),
// contemplation (Schopenhauer), then the return — the will handed back with
// one gold CTA into the planner. The full document is in the DOM at first
// paint; the darkness is CSS. No Three.js on this route.
//
// Design spec: docs/superpowers/specs/2026-07-01-landing-rite-redesign-design.md
// -----------------------------------------------------------------------------

const THEME_COLOR = "#030707";

/** Inline SVG favicon — a single candle flame. Swapped in for this page only. */
const FLAME_FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<path d="M16 3c3 5.5 7 8.5 7 14a7 7 0 1 1-14 0c0-3 1.2-5 3-7.5.6 1.8 1.6 3 3 3.5-.6-3.4-.2-7 1-10z" fill="#d7a64b"/>' +
      "</svg>",
  );

function upsertMeta(attr: "name" | "property", key: string, content: string): void {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (tag === null) {
    tag = document.createElement("meta");
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

/** Document chrome for the rite: title, description, theme-color, favicon,
 *  and the away-tab line. Everything restores on unmount. */
function useRiteDocumentChrome(): void {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = RITE_META_TITLE;
    upsertMeta("name", "description", RITE_META_DESC);
    upsertMeta("property", "og:title", RITE_META_TITLE);
    upsertMeta("property", "og:description", RITE_META_DESC);

    const previousTheme = document.head
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.getAttribute("content") ?? null;
    upsertMeta("name", "theme-color", THEME_COLOR);

    const icon = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const previousIcon = icon?.getAttribute("href") ?? null;
    icon?.setAttribute("href", FLAME_FAVICON);

    const onVisibility = (): void => {
      document.title = document.hidden ? AWAY_TAB_TITLE : RITE_META_TITLE;
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.title = previousTitle;
      if (previousTheme !== null) {
        upsertMeta("name", "theme-color", previousTheme);
      }
      if (previousIcon !== null) {
        icon?.setAttribute("href", previousIcon);
      }
    };
  }, []);
}

export function LandingPage(): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const enteredBefore = useMemo(() => hasEnteredBefore(), []);
  const afterDusk = useMemo(() => isAfterDusk(new Date()), []);

  useRiteDocumentChrome();
  const pointerMotion = useCursorLight(rootRef, reducedMotion ? "off" : "spring");
  const { act } = useScrollRite(rootRef, true);
  const roomTone = useRoomTone();

  const navRevealed = reducedMotion || (act !== "threshold" && act !== "darkness");
  const skipVisible = !reducedMotion && !navRevealed;
  const flameActive = act === "threshold" || act === "darkness";

  return (
    <div
      ref={rootRef}
      className={[
        "vv-rite",
        reducedMotion ? "is-static" : "",
        afterDusk ? "is-dusk" : "",
      ]
        .filter((c) => c.length > 0)
        .join(" ")}
      data-rite-act={act}
    >
      <RiteNav revealed={navRevealed} />

      <main>
        <ThresholdAct
          reducedMotion={reducedMotion}
          enteredBefore={enteredBefore}
          pointerMotion={pointerMotion}
          flameActive={flameActive}
        />
        <MagnitudeAct reducedMotion={reducedMotion} />
        <ContemplationAct
          reducedMotion={reducedMotion}
          roomTone={roomTone}
          toneVisible={act === "contemplation"}
        />
        <ReturnAct />
      </main>

      {/* The wick — reading progress as a candle burning down the page. */}
      <div className="rite-wick" aria-hidden>
        <span className="rite-wick-burn" />
      </div>

      <a
        className={`rite-skip${skipVisible ? " is-visible" : ""}`}
        href="#rooms"
      >
        {SKIP_TO_ROOMS_LABEL} <span aria-hidden>↓</span>
      </a>
    </div>
  );
}
