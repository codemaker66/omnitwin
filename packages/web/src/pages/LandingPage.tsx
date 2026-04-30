import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { Link } from "react-router-dom";
import "./LandingPage.css";

// -----------------------------------------------------------------------------
// LandingPage — public marketing homepage at `/` for Trades Hall Glasgow.
//
// Ported from the Claude Design handoff bundle at
//   C:\Users\blake\Downloads\trades house landing page-handoff\
//     trades-house-landing-page\project\Landing Page.html
//
// The design's in-page tweaks panel (mode/accent/layout/font switcher) is
// intentionally omitted — it's a prototype tool, not production. The
// published choices are locked in as data-* attributes on the root.
// -----------------------------------------------------------------------------

function upsertMeta(attr: "name" | "property", key: string, content: string): void {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (tag === null) {
    tag = document.createElement("meta");
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

const META_TITLE = "Plan your event — Trades Hall Glasgow";
const META_DESC =
  "Plan your event at Trades Hall Glasgow live, to scale. Pick a room, drop in tables, stage, bar and dancefloor, and get a costed quote in under 24 hours.";
const PHONE_PLANNER_QUERY = "(max-width: 639px)";

function isPhonePlannerViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(PHONE_PLANNER_QUERY).matches;
}

export function LandingPage(): ReactElement {
  useEffect(() => {
    const prev = document.title;
    document.title = META_TITLE;
    upsertMeta("name", "description", META_DESC);
    upsertMeta("property", "og:title", META_TITLE);
    upsertMeta("property", "og:description", META_DESC);
    upsertMeta("property", "og:type", "website");
    upsertMeta("property", "og:site_name", "Trades Hall Glasgow");
    return () => { document.title = prev; };
  }, []);

  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(".rise"));
    if (typeof IntersectionObserver === "undefined") {
      nodes.forEach((n) => { n.classList.add("in"); });
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) e.target.classList.add("in");
        }
      },
      { threshold: 0.12 },
    );
    nodes.forEach((n) => { io.observe(n); });
    const fallback = window.setTimeout(() => {
      nodes.forEach((n) => { n.classList.add("in"); });
    }, 1500);
    return () => { io.disconnect(); window.clearTimeout(fallback); };
  }, []);

  return (
    <div
      className="th-landing"
      data-mode="light"
      data-layout="stacked"
      data-accent="oxblood"
      data-display="newsreader"
      ref={rootRef}
    >
      <TopNav />
      <Hero />
      <Marquee />
      <HowItWorks />
      <Rooms />
      <Features />
      <Quote />
      <FinalCTA />
      <SiteFooter />
    </div>
  );
}

// -----------------------------------------------------------------------------
// NAV
// -----------------------------------------------------------------------------

function TopNav(): ReactElement {
  return (
    <nav className="th-nav" aria-label="Primary">
      <div className="wrap row">
        <Link className="brand" to="/" aria-label="Trades Hall Glasgow — home">
          <span className="crest" aria-hidden>Th</span>
          <span className="lockup">
            <small>Est. 1791 · Glasgow</small>
            <b>Trades Hall</b>
          </span>
        </Link>
        <ul />
        <div className="actions">
          <Link className="btn ghost" to="/login">Sign in</Link>
          <Link className="btn primary" to="/plan">
            Open planner <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}

// -----------------------------------------------------------------------------
// HERO — headline + live planner preview
// -----------------------------------------------------------------------------

function Hero(): ReactElement {
  const [mobilePlannerOpen, setMobilePlannerOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!mobilePlannerOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [mobilePlannerOpen]);

  const openMobilePlanner = (): void => {
    setMobilePlannerOpen(true);
  };

  const onPreviewCtaClick = (e: ReactMouseEvent<HTMLAnchorElement>): void => {
    if (!isPhonePlannerViewport()) return;
    e.preventDefault();
    openMobilePlanner();
  };

  return (
    <header className="hero">
      <div className="wrap">
        <div className="hero-grid">
          <div className="hero-left rise">
            <div className="eyebrow">Plan your event — live, to scale</div>
            <h1>
              See your event <em>in the room</em> before you book it.
            </h1>
            <p className="lede">
              Pick a room at Trades Hall Glasgow, drop in your tables, stage and bar, and
              send us a plan we can quote against. No guesswork, no surprises on the day.
            </p>
            <div className="ctas">
              <a href="#rooms" className="btn primary big">
                Choose a room
                <span className="arrow" aria-hidden>→</span>
              </a>
              <a href="#how" className="btn big">How it works</a>
            </div>
            <div className="proof-row">
              <span>✓ Free to plan</span>
              <span>✓ 4 rooms, 1–400 guests</span>
              <span>✓ Quote in 24h</span>
            </div>
          </div>

          <div className="hero-right rise" style={{ transitionDelay: ".12s" }}>
            <PlannerPreview mode="embedded" onRequestFullscreen={openMobilePlanner} />
            <div className="preview-caption">
              <span>↑ Drag anything — this is a taste of the real thing</span>
              <span className="preview-caption-sub">Scaled 1:50 · Grand Hall banquet</span>
            </div>
            <Link to="/plan" className="btn primary big preview-cta" onClick={onPreviewCtaClick}>
              <span className="preview-cta-desktop">Open the real planner in 3D</span>
              <span className="preview-cta-mobile">Open the full planner</span>
              <span className="arrow" aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </div>
      {mobilePlannerOpen ? (
        <MobilePlannerOverlay onClose={() => { setMobilePlannerOpen(false); }} />
      ) : null}
    </header>
  );
}

interface MobilePlannerOverlayProps {
  readonly onClose: () => void;
}

function MobilePlannerOverlay({ onClose }: MobilePlannerOverlayProps): ReactElement {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [onClose]);

  return (
    <div className="mobile-planner-shell" role="dialog" aria-modal="true" aria-label="Grand Hall mobile planner">
      <div className="mobile-planner-topbar">
        <button type="button" className="mobile-planner-back" onClick={onClose} aria-label="Close planner">
          Back
        </button>
        <div className="mobile-planner-title">
          <strong>Grand Hall</strong>
          <span>Draft saved locally</span>
        </div>
        <Link to="/plan" className="mobile-planner-3d">3D</Link>
      </div>
      <PlannerPreview mode="fullscreen" />
    </div>
  );
}

// -----------------------------------------------------------------------------
// PLANNER PREVIEW — interactive Grand Hall layout for embedded and mobile use
// -----------------------------------------------------------------------------

interface PreviewItem {
  readonly id: string;
  readonly label: string;
  readonly kv: readonly { readonly k: string; readonly v: string }[];
  readonly placed: string;
}

const ROUND_ITEM: PreviewItem = {
  id: "round",
  label: "Round table · 10",
  kv: [
    { k: "Diameter", v: "1.8 m · 6 ft" }, { k: "Seats", v: "10" },
    { k: "Linen", v: "Ivory" }, { k: "Centrepiece", v: "Low floral" },
  ],
  placed: "10 / 12 placed",
};

const PREVIEW_ITEMS: Record<string, PreviewItem> = {
  stage: {
    id: "stage",
    label: "Stage · 8 × 3 m",
    kv: [
      { k: "Width", v: "8 m" }, { k: "Depth", v: "3 m" },
      { k: "Height", v: "0.6 m" }, { k: "Power", v: "32A + 3× 13A" },
    ],
    placed: "1 / 1 placed",
  },
  bar: {
    id: "bar",
    label: "Bar · 6 m",
    kv: [
      { k: "Length", v: "6 m" }, { k: "Depth", v: "0.9 m" },
      { k: "Stools", v: "8" }, { k: "Back bar", v: "Matte black" },
    ],
    placed: "1 / 1 placed",
  },
  dancefloor: {
    id: "dancefloor",
    label: "Dancefloor · 6 × 4 m",
    kv: [
      { k: "Finish", v: "Parquet" }, { k: "Width", v: "6 m" },
      { k: "Length", v: "4 m" }, { k: "Capacity", v: "~80" },
    ],
    placed: "1 / 1 placed",
  },
  "top-table": {
    id: "top-table",
    label: "Top table · 14",
    kv: [
      { k: "Length", v: "4.8 m" }, { k: "Seats", v: "14" },
      { k: "Linen", v: "Ivory" }, { k: "Style", v: "Long trestle" },
    ],
    placed: "1 / 1 placed",
  },
  round: ROUND_ITEM,
};

// Room-to-container mapping. SVG viewBox is 840×470, room interior path
// spans x=30..810, y=40..385 (780 × 345 units), labelled 21m × 10.5m.
// So 1m horizontal = 780/21/840 × 100 ≈ 4.421%, 1m vertical = 345/10.5/470
// × 100 ≈ 6.988%. Container CSS uses aspect-ratio 840/470, so container
// percentages map linearly to viewBox units.
const W_PER_M = (780 / 21 / 840) * 100;
const H_PER_M = (345 / 10.5 / 470) * 100;
const ROOM_LEFT_PCT = (30 / 840) * 100;
const ROOM_TOP_PCT = (40 / 470) * 100;

interface MetrePlacement {
  /** Item's top-left x in metres, measured from the room's left wall. */
  readonly x: number;
  /** Item's top-left y in metres, measured from the room's back wall. */
  readonly y: number;
  readonly widthM: number;
  readonly heightM: number;
}

function placeStyle(p: MetrePlacement): { left: string; top: string; width: string; height: string } {
  return {
    left: `${String(ROOM_LEFT_PCT + p.x * W_PER_M)}%`,
    top: `${String(ROOM_TOP_PCT + p.y * H_PER_M)}%`,
    width: `${String(p.widthM * W_PER_M)}%`,
    height: `${String(p.heightM * H_PER_M)}%`,
  };
}

type ItemKind = "stage" | "bar" | "dancefloor" | "round" | "poseur" | "top-table" | "lectern" | "row";

interface PlannerItem {
  readonly id: string;
  readonly kind: ItemKind;
  readonly x: number;
  readonly y: number;
  readonly widthM: number;
  readonly heightM: number;
  readonly klass: "furn" | "furn dark" | "furn round";
  readonly tag?: string;
  readonly tagDark?: boolean;
  readonly body: string;
}

// Catalogue kinds the visitor can drag from the sidebar into the stage.
// Each entry describes what to create on drop — dimensions, visual class,
// tag/body text — in one place. "Long 12" is deliberately absent: Trades
// Hall doesn't stock 12-seat trestle tables for this venue.
interface CatalogueEntry {
  readonly kind: ItemKind;
  readonly label: string;
  readonly widthM: number;
  readonly heightM: number;
  readonly klass: PlannerItem["klass"];
  readonly tag?: string;
  readonly tagDark?: boolean;
  readonly body: string;
}

const CATALOGUE: readonly CatalogueEntry[] = [
  { kind: "round",      label: "◯ Round 10",   widthM: 1.8, heightM: 1.8, klass: "furn round", body: "10" },
  { kind: "stage",      label: "■ Stage",      widthM: 8,   heightM: 3,   klass: "furn",       tag: "STAGE · 8×3m",      body: "Stage" },
  { kind: "bar",        label: "Ⅱ Bar",        widthM: 6,   heightM: 0.9, klass: "furn dark",  tag: "BAR · 6m",          tagDark: true, body: "Bar" },
  { kind: "dancefloor", label: "❋ Dancefloor", widthM: 6,   heightM: 4,   klass: "furn dark",  tag: "DANCEFLOOR · 6×4m", tagDark: true, body: "Parquet" },
];

const CATALOGUE_MIME = "application/x-th-catalogue-kind";

type EventType = "wedding" | "gala" | "conference";

// Door positions on the north wall (gaps in the room outline):
//   door 1: x ≈ 1.48–3.36 m, door 2: x ≈ 9.83–11.44 m, door 3: x ≈ 17.91–19.80 m.
// Each door has a ~1 m swing arc drawn into the room. Any furniture placed
// against the back wall at y < 1.1 m will overlap those arcs, so every
// layout starts its back-wall items at y = 1.1 m for clearance.

// Door arc spans on the north wall (from the SVG):
//   door 1: x ≈ 1.48–3.36 m   door 2: x ≈ 9.83–11.44 m   door 3: x ≈ 17.91–19.80 m
// Largest clear gap on the north wall is 6.47 m (3.36–9.83 or 11.44–17.91).
// An 8 m stage therefore MUST NOT be placed against the north wall — it
// physically blocks a fire exit. Every layout here either shrinks the
// stage to 6 m or puts it against the door-free west wall.

const WEDDING_ITEMS: readonly PlannerItem[] = [
  // 6 × 3 m stage in the gap between doors 1 and 2 (3.36–9.83 m = 6.47 m clear).
  { id: "stage",      kind: "stage",      x: 3.5,  y: 1.1, widthM: 6,   heightM: 3,   klass: "furn",       tag: "STAGE · 6×3m",       body: "Stage" },
  // 6 m bar in the gap between doors 2 and 3 (11.44–17.91 m = 6.47 m clear).
  { id: "bar",        kind: "bar",        x: 11.5, y: 1.1, widthM: 6,   heightM: 0.9, klass: "furn dark",  tag: "BAR · 6m",           tagDark: true, body: "Bar" },
  { id: "dancefloor", kind: "dancefloor", x: 13.5, y: 4,   widthM: 6,   heightM: 4,   klass: "furn dark",  tag: "DANCEFLOOR · 6×4m",  tagDark: true, body: "Parquet" },
  { id: "round-0",    kind: "round",      x: 0.7,  y: 4.6, widthM: 1.8, heightM: 1.8, klass: "furn round", body: "10" },
  { id: "round-1",    kind: "round",      x: 3.1,  y: 4.6, widthM: 1.8, heightM: 1.8, klass: "furn round", body: "10" },
  { id: "round-2",    kind: "round",      x: 5.5,  y: 4.6, widthM: 1.8, heightM: 1.8, klass: "furn round", body: "10" },
  { id: "round-3",    kind: "round",      x: 7.9,  y: 4.6, widthM: 1.8, heightM: 1.8, klass: "furn round", body: "10" },
  { id: "round-4",    kind: "round",      x: 10.3, y: 4.6, widthM: 1.8, heightM: 1.8, klass: "furn round", body: "10" },
  { id: "round-5",    kind: "round",      x: 0.7,  y: 7,   widthM: 1.8, heightM: 1.8, klass: "furn round", body: "10" },
  { id: "round-6",    kind: "round",      x: 3.1,  y: 7,   widthM: 1.8, heightM: 1.8, klass: "furn round", body: "10" },
  { id: "round-7",    kind: "round",      x: 5.5,  y: 7,   widthM: 1.8, heightM: 1.8, klass: "furn round", body: "10" },
  { id: "round-8",    kind: "round",      x: 7.9,  y: 7,   widthM: 1.8, heightM: 1.8, klass: "furn round", body: "10" },
  { id: "round-9",    kind: "round",      x: 10.3, y: 7,   widthM: 1.8, heightM: 1.8, klass: "furn round", body: "10" },
  { id: "top-table",  kind: "top-table",  x: 8.1,  y: 9.3, widthM: 4.8, heightM: 1,   klass: "furn",       tag: "TOP TABLE · 14",     body: "Top table" },
];

// Gala: standing/mingling emphasis. 6 m stage in a north-wall gap, a
// central dancefloor, a long service bar on the door-free east wall,
// poseur high-tops around the perimeter (away from door arcs on the
// north wall).
const GALA_ITEMS: readonly PlannerItem[] = [
  { id: "stage",      kind: "stage",      x: 3.5,  y: 1.1, widthM: 6,   heightM: 3,   klass: "furn",       tag: "STAGE · 6×3m",       body: "Stage" },
  // Service bar on the east wall — rotated so its long edge runs
  // north-south. The east wall has no doors.
  { id: "bar",        kind: "bar",        x: 19.8, y: 2,   widthM: 0.9, heightM: 6,   klass: "furn dark",  tag: "BAR · 6m",           tagDark: true, body: "Bar" },
  { id: "dancefloor", kind: "dancefloor", x: 6,    y: 5,   widthM: 9,   heightM: 3,   klass: "furn dark",  tag: "DANCEFLOOR · 9×3m",  tagDark: true, body: "Parquet" },
  // Poseurs — all below y = 1.5 m so they clear the north-wall door arcs.
  { id: "poseur-0",   kind: "poseur",     x: 1,    y: 4.5, widthM: 0.7, heightM: 0.7, klass: "furn round", body: "4" },
  { id: "poseur-1",   kind: "poseur",     x: 1,    y: 6,   widthM: 0.7, heightM: 0.7, klass: "furn round", body: "4" },
  { id: "poseur-2",   kind: "poseur",     x: 1,    y: 7.5, widthM: 0.7, heightM: 0.7, klass: "furn round", body: "4" },
  { id: "poseur-3",   kind: "poseur",     x: 3,    y: 9.3, widthM: 0.7, heightM: 0.7, klass: "furn round", body: "4" },
  { id: "poseur-4",   kind: "poseur",     x: 5,    y: 9.3, widthM: 0.7, heightM: 0.7, klass: "furn round", body: "4" },
  { id: "poseur-5",   kind: "poseur",     x: 9,    y: 9.3, widthM: 0.7, heightM: 0.7, klass: "furn round", body: "4" },
  { id: "poseur-6",   kind: "poseur",     x: 11,   y: 9.3, widthM: 0.7, heightM: 0.7, klass: "furn round", body: "4" },
  { id: "poseur-7",   kind: "poseur",     x: 13,   y: 9.3, widthM: 0.7, heightM: 0.7, klass: "furn round", body: "4" },
  { id: "poseur-8",   kind: "poseur",     x: 15,   y: 9.3, widthM: 0.7, heightM: 0.7, klass: "furn round", body: "4" },
  { id: "poseur-9",   kind: "poseur",     x: 17,   y: 9.3, widthM: 0.7, heightM: 0.7, klass: "furn round", body: "4" },
];

// Conference: stage on the WEST short wall (door-free), rows of delegate
// tables running north-south so attendees face west toward the stage.
// Traditional theatre layout for a 21 × 10.5 m long hall.
const CONFERENCE_ITEMS: readonly PlannerItem[] = [
  { id: "stage",   kind: "stage",   x: 0.3, y: 1.25, widthM: 3,   heightM: 8,   klass: "furn",      tag: "STAGE · 3×8m",   body: "Stage" },
  // Lectern just east of the stage, facing the audience. Body is empty —
  // the tag above already says "LECTERN" and the item itself is too small
  // to comfortably fit the word inside its 1 × 0.7 m box (which was causing
  // the text to overflow the dark background).
  { id: "lectern", kind: "lectern", x: 3.6, y: 5,    widthM: 0.7, heightM: 1,   klass: "furn dark", tag: "LECTERN",        tagDark: true, body: "" },
  // Five rows of 0.8 × 6 m delegate tables, spaced 2.6 m apart so each
  // row leaves ~1.8 m for chairs behind it. People sit on the WEST side
  // of each row facing the stage.
  { id: "row-1",   kind: "row",     x: 6,   y: 2.25, widthM: 0.8, heightM: 6,   klass: "furn",      tag: "ROW · 10 seats", body: "" },
  { id: "row-2",   kind: "row",     x: 8.6, y: 2.25, widthM: 0.8, heightM: 6,   klass: "furn",                             body: "" },
  { id: "row-3",   kind: "row",     x: 11.2, y: 2.25, widthM: 0.8, heightM: 6,  klass: "furn",                             body: "" },
  { id: "row-4",   kind: "row",     x: 13.8, y: 2.25, widthM: 0.8, heightM: 6,  klass: "furn",                             body: "" },
  { id: "row-5",   kind: "row",     x: 16.4, y: 2.25, widthM: 0.8, heightM: 6,  klass: "furn",                             body: "" },
];

const LAYOUTS: Record<EventType, readonly PlannerItem[]> = {
  wedding: WEDDING_ITEMS,
  gala: GALA_ITEMS,
  conference: CONFERENCE_ITEMS,
};

/** Drag-state tracked in a ref so pointermove doesn't trigger a re-render
 *  on every tick — we only setState on real position changes. */
interface DragState {
  id: string;
  startX: number;
  startY: number;
  origXM: number;
  origYM: number;
  moved: boolean;
}

/** Room bounds in metres, matching the design's 21 × 10.5 m Grand Hall. */
const ROOM_W_M = 21;
const ROOM_H_M = 10.5;

/** Convert a viewport mouse point to room-metre coordinates via the stage's
 *  bounding rect. Returns null when the event source is unusable. */
function clientToMetres(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): { xM: number; yM: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const pxPerMX = (rect.width * W_PER_M) / 100;
  const pxPerMY = (rect.height * H_PER_M) / 100;
  const roomPxLeft = (rect.width * ROOM_LEFT_PCT) / 100;
  const roomPxTop = (rect.height * ROOM_TOP_PCT) / 100;
  const xM = (clientX - rect.left - roomPxLeft) / pxPerMX;
  const yM = (clientY - rect.top - roomPxTop) / pxPerMY;
  return { xM, yM };
}

interface PlannerPreviewProps {
  readonly mode: "embedded" | "fullscreen";
  readonly onRequestFullscreen?: () => void;
}

function PlannerPreview({ mode, onRequestFullscreen }: PlannerPreviewProps): ReactElement {
  const [eventType, setEventType] = useState<EventType>("wedding");
  const [selectedId, setSelectedId] = useState<string>("round-3");
  const [items, setItems] = useState<readonly PlannerItem[]>(WEDDING_ITEMS);
  /** Live-tracked room-metre cursor coordinates — drives the coord chip in
   *  the bottom-right of the stage so visitors can see exactly where the
   *  real planner would place their drop. */
  const [cursor, setCursor] = useState<{ xM: number; yM: number } | null>(null);
  /** When a catalogue chip is mid-drag, we highlight the stage with a
   *  subtle overlay to cue "drop here". */
  const [dropHint, setDropHint] = useState<boolean>(false);
  const dragRef = useRef<DragState | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  /** Incremented for each new item dropped from the catalogue so IDs stay
   *  unique across mounts without pulling in a uuid dep. */
  const newItemCounter = useRef<number>(0);
  const isFullscreen = mode === "fullscreen";

  const requestFullscreenIfMobile = (): boolean => {
    if (isFullscreen || onRequestFullscreen === undefined || !isPhonePlannerViewport()) return false;
    onRequestFullscreen();
    return true;
  };

  const onMobilePreviewOpen = (): void => {
    if (onRequestFullscreen !== undefined) onRequestFullscreen();
  };

  const switchLayout = (next: EventType): void => {
    setEventType(next);
    setItems(LAYOUTS[next]);
    const first = LAYOUTS[next][0];
    setSelectedId(first?.id ?? "");
  };

  /** Drop an item at room-metre (xM, yM) — used by the catalogue-chip
   *  drag-and-drop flow. Generates a fresh id, clamps to room bounds so
   *  nothing escapes the walls, and selects the new item. */
  const dropCatalogueItem = (entry: CatalogueEntry, xM: number, yM: number): void => {
    newItemCounter.current += 1;
    const id = `new-${entry.kind}-${String(newItemCounter.current)}`;
    const clampedX = Math.max(0, Math.min(ROOM_W_M - entry.widthM, xM - entry.widthM / 2));
    const clampedY = Math.max(0, Math.min(ROOM_H_M - entry.heightM, yM - entry.heightM / 2));
    const next: PlannerItem = {
      id,
      kind: entry.kind,
      x: clampedX,
      y: clampedY,
      widthM: entry.widthM,
      heightM: entry.heightM,
      klass: entry.klass,
      tag: entry.tag,
      tagDark: entry.tagDark,
      body: entry.body,
    };
    setItems((prev) => [...prev, next]);
    setSelectedId(id);
  };

  /** Delete the selected item (Del/Backspace keyboard). */
  const deleteSelected = (): void => {
    setItems((prev) => {
      const filtered = prev.filter((i) => i.id !== selectedId);
      return filtered.length === prev.length ? prev : filtered;
    });
    setSelectedId("");
  };

  /** Rotate the selected item 90° around its own centre, swapping
   *  widthM ↔ heightM and clamping the new bounds to the room. Round
   *  and poseur items are rotationally symmetric — no-op. Wired to
   *  both the Rotate toolbar button and the R keyboard shortcut. */
  const rotateSelected = (): void => {
    setItems((prev) => prev.map((it) => {
      if (it.id !== selectedId) return it;
      if (it.kind === "round" || it.kind === "poseur") return it;
      const cx = it.x + it.widthM / 2;
      const cy = it.y + it.heightM / 2;
      const newW = it.heightM;
      const newH = it.widthM;
      return {
        ...it,
        widthM: newW,
        heightM: newH,
        x: Math.max(0, Math.min(ROOM_W_M - newW, cx - newW / 2)),
        y: Math.max(0, Math.min(ROOM_H_M - newH, cy - newH / 2)),
      };
    }));
  };

  /** Pointer-move over the stage — updates the live coord chip. Fires
   *  every mouse frame while hovering, cheap because state only stores
   *  two numbers + the chip re-renders from them. */
  const onStagePointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (stageRef.current === null) return;
    const rect = stageRef.current.getBoundingClientRect();
    const m = clientToMetres(e.clientX, e.clientY, rect);
    if (m === null) return;
    setCursor({
      xM: Math.max(0, Math.min(ROOM_W_M, m.xM)),
      yM: Math.max(0, Math.min(ROOM_H_M, m.yM)),
    });
  };

  const onStagePointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (requestFullscreenIfMobile()) e.preventDefault();
  };

  const onStagePointerLeave = (): void => { setCursor(null); };

  /** DragOver on the stage — keeps the drop target valid during a
   *  catalogue-chip drag. preventDefault is what makes the drop handler
   *  fire at all. */
  const onStageDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    // Only accept our own catalogue payload; ignore images/text/etc.
    if (!Array.from(e.dataTransfer.types).includes(CATALOGUE_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dropHint) setDropHint(true);
  };

  const onStageDragLeave = (): void => { setDropHint(false); };

  const onStageDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    setDropHint(false);
    if (stageRef.current === null) return;
    const kind = e.dataTransfer.getData(CATALOGUE_MIME);
    if (kind === "") return;
    const entry = CATALOGUE.find((c) => c.kind === kind);
    if (entry === undefined) return;
    e.preventDefault();
    const rect = stageRef.current.getBoundingClientRect();
    const m = clientToMetres(e.clientX, e.clientY, rect);
    if (m === null) return;
    dropCatalogueItem(entry, m.xM, m.yM);
  };

  const selectedKind = selectedId.startsWith("round-") ? "round" : selectedId;
  const info: PreviewItem = PREVIEW_ITEMS[selectedKind] ?? ROUND_ITEM;

  const isSelected = (id: string): boolean => id === selectedId;
  const furnClass = (base: string, id: string): string =>
    isSelected(id) ? `${base} selected` : base;

  const onItemPointerDown = (item: PlannerItem) => (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    if (requestFullscreenIfMobile()) {
      e.preventDefault();
      return;
    }
    (e.currentTarget).setPointerCapture(e.pointerId);
    dragRef.current = {
      id: item.id,
      startX: e.clientX,
      startY: e.clientY,
      origXM: item.x,
      origYM: item.y,
      moved: false,
    };
  };

  const onItemPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (d === null || stageRef.current === null) return;
    const rect = stageRef.current.getBoundingClientRect();
    const pxPerMX = (rect.width * W_PER_M) / 100;
    const pxPerMY = (rect.height * H_PER_M) / 100;
    if (pxPerMX <= 0 || pxPerMY <= 0) return;
    const dxM = (e.clientX - d.startX) / pxPerMX;
    const dyM = (e.clientY - d.startY) / pxPerMY;
    // 2 pixel drag threshold before committing to a move — below that,
    // treat the gesture as a click so selection still works on a tap.
    if (!d.moved && Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 3) return;
    d.moved = true;
    setItems((prev) => prev.map((i) => {
      if (i.id !== d.id) return i;
      const maxX = Math.max(0, ROOM_W_M - i.widthM);
      const maxY = Math.max(0, ROOM_H_M - i.heightM);
      return {
        ...i,
        x: Math.max(0, Math.min(maxX, d.origXM + dxM)),
        y: Math.max(0, Math.min(maxY, d.origYM + dyM)),
      };
    }));
  };

  const onItemPointerUp = (item: PlannerItem) => (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    dragRef.current = null;
    try { (e.currentTarget).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    // Tap without drag → selection. Drag finalises in-place (state already updated).
    if (d !== null && !d.moved) setSelectedId(item.id);
  };

  const onItemPointerCancel = (e: ReactPointerEvent<HTMLDivElement>): void => {
    dragRef.current = null;
    try { (e.currentTarget).releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  return (
    <div className={`planner planner-${mode}`} aria-label={isFullscreen ? "Planner editor" : "Planner preview"}>
      <div className="chrome">
        <div className="dots"><i /><i /><i /></div>
        <div className="title"><b>Grand Hall</b> · Banquet layout · Draft</div>
        <div className="right">SAVED 2m ago</div>
      </div>

      <div className="body">
        <aside className="sidebar" aria-hidden>
          <div className="field compact-hide">
            <label>Room</label>
            <div className="input">Grand Hall <span className="caret">▾</span></div>
          </div>
          <div className="field">
            <label>Event type</label>
            <div className="pill-row">
              <button
                type="button"
                className={eventType === "wedding" ? "pill on" : "pill"}
                onClick={() => {
                  if (!requestFullscreenIfMobile()) switchLayout("wedding");
                }}
              >
                Wedding
              </button>
              <button
                type="button"
                className={eventType === "gala" ? "pill on" : "pill"}
                onClick={() => {
                  if (!requestFullscreenIfMobile()) switchLayout("gala");
                }}
              >
                Gala
              </button>
              <button
                type="button"
                className={eventType === "conference" ? "pill on" : "pill"}
                onClick={() => {
                  if (!requestFullscreenIfMobile()) switchLayout("conference");
                }}
              >
                Conference
              </button>
            </div>
          </div>
          <div className="field compact-hide">
            <label>Guests</label>
            <div className="input">180 <span className="caret">—</span></div>
          </div>
          <div>
            <h4 className="compact-hide">Drag &amp; drop</h4>
            <div className="pill-row" style={{ marginTop: 10 }}>
              {CATALOGUE.map((entry) => (
                <button
                  key={entry.kind + entry.label}
                  type="button"
                  className="pill"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(CATALOGUE_MIME, entry.kind);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => {
                    if (requestFullscreenIfMobile()) return;
                    // Keyboard / non-drag fallback — drop a fresh item
                    // into the centre of the room.
                    dropCatalogueItem(entry, ROOM_W_M / 2, ROOM_H_M / 2);
                  }}
                  title={`Drag into the room, or click to drop at centre (${String(entry.widthM)} × ${String(entry.heightM)} m)`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div
          className={dropHint ? "stage stage-drop-hint" : "stage"}
          aria-label="Floor plan preview — drag furniture to move, tap to inspect, Del to remove"
          ref={stageRef}
          tabIndex={0}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerLeave={onStagePointerLeave}
          onDragOver={onStageDragOver}
          onDragLeave={onStageDragLeave}
          onDrop={onStageDrop}
          onKeyDown={(e) => {
            if ((e.key === "Delete" || e.key === "Backspace") && selectedId !== "") {
              e.preventDefault();
              deleteSelected();
              return;
            }
            if ((e.key === "r" || e.key === "R") && selectedId !== "") {
              e.preventDefault();
              rotateSelected();
            }
          }}
        >
          <svg
            className="room-svg"
            viewBox="0 0 840 470"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <pattern
                id="th-hatch-room"
                width="8"
                height="8"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="8" stroke="currentColor" strokeWidth="0.8" opacity=".55" />
              </pattern>
            </defs>
            <g style={{ color: "var(--ink-3)" }}>
              <path
                d="M 30 40 L 810 40 L 810 325 L 800 335 L 810 345 L 810 385 L 780 385 L 780 405 L 660 405 L 660 385 L 580 385 L 580 405 L 500 405 L 500 430 L 340 430 L 340 405 L 260 405 L 260 385 L 180 385 L 180 405 L 60 405 L 60 385 L 30 385 Z"
                fill="url(#th-hatch-room)"
                stroke="none"
              />
              <path
                d="M 30 40 L 85 40   M 155 40 L 395 40  M 455 40 L 695 40  M 765 40 L 810 40 L 810 325 L 800 335 L 810 345 L 810 385 L 780 385 L 780 405 L 660 405 L 660 385 L 580 385 L 580 405 L 500 405 L 500 430 L 340 430 L 340 405 L 260 405 L 260 385 L 180 385 L 180 405 L 60 405 L 60 385 L 30 385 L 30 40"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinejoin="miter"
                vectorEffect="non-scaling-stroke"
              />
              <g
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                opacity=".55"
                vectorEffect="non-scaling-stroke"
              >
                <path d="M 85 40 A 35 35 0 0 1 155 40" />
                <path d="M 395 40 A 30 30 0 0 1 455 40" />
                <path d="M 695 40 A 35 35 0 0 1 765 40" />
              </g>
            </g>
            <g
              style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 9 }}
              fill="currentColor"
              stroke="none"
              opacity=".7"
              textAnchor="middle"
              letterSpacing="0.5"
            >
              <text x="120" y="400">WINDOW</text>
              <text x="720" y="400">WINDOW</text>
              <text x="420" y="422" style={{ fontSize: 10 }} opacity=".9">BALCONY</text>
            </g>
            <g
              style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 10 }}
              fill="currentColor"
              stroke="none"
              opacity=".6"
            >
              <text x="420" y="32" textAnchor="middle" letterSpacing="0.8">21 m</text>
              <text x="18" y="215" transform="rotate(-90 18 215)" letterSpacing="0.8">10.5 m</text>
            </g>
          </svg>

          <div className="topbar">
            <div className="tool-group" role="toolbar" aria-hidden>
              <div className="tool on" title="Select">⌖</div>
              <div className="tool" title="Pan (scroll to pan)">✥</div>
              <div
                className="tool"
                title="Rotate selected 90°"
                role="button"
                tabIndex={0}
                onClick={rotateSelected}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    rotateSelected();
                  }
                }}
              >
                ↻
              </div>
              <div className="tool" title="Measure (coming soon)">⟷</div>
            </div>
          </div>

          {/* No bar stools — Trades Hall's bar doesn't come with stools
              so rendering any would misrepresent what's actually hired. */}
          {/* Every piece is draggable. Pointer-based so it works on
              mouse + touch + pen; setPointerCapture keeps the drag alive
              when the cursor leaves the element. onClick stays usable for
              taps (the drag helpers short-circuit below a 3 px threshold
              and fall through to selection). */}
          {items.map((item) => (
            <div
              key={item.id}
              className={furnClass(item.klass, item.id)}
              style={{ ...placeStyle(item), touchAction: "none" }}
              onPointerDown={onItemPointerDown(item)}
              onPointerMove={onItemPointerMove}
              onPointerUp={onItemPointerUp(item)}
              onPointerCancel={onItemPointerCancel}
              role="button"
              tabIndex={0}
              aria-label={`${item.tag ?? item.body} — drag to move, tap to inspect`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedId(item.id);
                }
              }}
            >
              {item.tag !== undefined ? (
                <span className={item.tagDark === true ? "tag dark" : "tag"}>{item.tag}</span>
              ) : null}
              {/* Skip body text on items smaller than ~1 m on either
                  axis — their text was overflowing the filled background
                  (e.g. "Lectern" on a 1 × 0.7 m box). Tag above carries
                  the label; inside stays empty and reads clean. */}
              {item.body !== "" && item.widthM >= 1.2 && item.heightM >= 0.8 ? item.body : null}
            </div>
          ))}

          <div className="summary">
            <div className="chips">
              <div className="chip">Seats <b>114</b></div>
              <div className="chip">Rounds <b>10</b></div>
              <div className="chip">Egress <b style={{ color: "oklch(0.55 0.15 145)" }}>✓</b></div>
            </div>
            <div className="coord">
              {cursor === null
                ? "— · — · 1:50"
                : `X ${cursor.xM.toFixed(1)} m · Y ${cursor.yM.toFixed(1)} m · 1:50`}
            </div>
          </div>
          {!isFullscreen ? (
            <button type="button" className="mobile-preview-open" onClick={onMobilePreviewOpen}>
              Open the full planner
            </button>
          ) : null}
        </div>

        <aside className="rightcol" aria-live="polite">
          <h5>{info.label}</h5>
          {info.kv.map((row) => (
            <div key={row.k} className="kv">
              <span>{row.k}</span><span>{row.v}</span>
            </div>
          ))}
          <div className="footer-note">{info.placed}</div>
          <div className="section">
            <h5>Fire &amp; safety</h5>
            <div className="kv"><span>Egress</span><span style={{ color: "oklch(0.55 0.15 145)" }}>✓ Clear</span></div>
            <div className="kv"><span>Capacity</span><span>180 max</span></div>
            <div className="kv"><span>Aisles</span><span>1.2 m</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// MARQUEE
// -----------------------------------------------------------------------------

const MARQUEE_ITEMS = [
  "Weddings",
  "Galas & balls",
  "Corporate conferences",
  "Product launches",
  "Film & TV locations",
  "Private dining",
  "Charity fundraisers",
  "Civic ceremonies",
] as const;

function Marquee(): ReactElement {
  const strip = (ariaHidden: boolean): ReactElement => (
    <span aria-hidden={ariaHidden || undefined}>
      {MARQUEE_ITEMS.map((item, i) => (
        <span key={`${item}-${String(i)}`}>
          <span>{item}</span>
          <span className="dot" aria-hidden>✦</span>
        </span>
      ))}
    </span>
  );
  return (
    <div className="marquee" aria-label="Event types hosted at Trades Hall">
      <div className="track">
        {strip(false)}
        {strip(true)}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// HOW IT WORKS
// -----------------------------------------------------------------------------

const STEPS = [
  {
    num: "01 / Pick",
    title: "Choose your room",
    body: "Browse our four rooms by capacity, style and layout. Each one loads with an accurate, to-scale floor plan of the real space.",
  },
  {
    num: "02 / Plan",
    title: "Design the layout",
    body: "Drag tables, stages, bars and dancefloors into place. Switch between ceremony, banquet and cabaret in one click.",
  },
  {
    num: "03 / Check",
    title: "Validate & adjust",
    body: "We check spacing, capacity and fire egress as you go, and flag anything our events team would normally catch.",
  },
  {
    num: "04 / Send",
    title: "Get a quote",
    body: "Send the plan to our team. You'll have a costed proposal with hire items and staffing within 24 hours.",
  },
] as const;

function HowItWorks(): ReactElement {
  return (
    <section className="blk" id="how">
      <div className="wrap">
        <div className="sec-head">
          <div className="kicker">How it works</div>
          <h2>
            Four steps from <em>first look</em> to signed contract.
          </h2>
        </div>
        <div className="steps">
          {STEPS.map((s) => (
            <div key={s.num} className="step">
              <div className="num">{s.num}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// ROOMS
// -----------------------------------------------------------------------------

interface RoomCardData {
  readonly slug: string;
  readonly size: "lg" | "md";
  readonly image: string;
  readonly alt: string;
  readonly title: string;
  readonly sub: string;
  readonly standing: number;
  readonly banquet: number;
  readonly tag?: string;
}

const ROOMS: readonly RoomCardData[] = [
  {
    slug: "grand-hall",
    size: "lg",
    image: "/rooms/Grand-Hall-scaled-opt.jpg",
    alt: "The Grand Hall set for a banquet with chandeliers and domed ceiling",
    title: "The Grand Hall",
    sub: "1st floor · Double-height · Domed ceiling & gallery",
    standing: 400,
    banquet: 240,
    tag: "Most booked",
  },
  {
    slug: "saloon",
    size: "md",
    image: "/rooms/saloon_TH_use.png",
    alt: "The Saloon with panelled walls and stained-glass windows set for a ceremony",
    title: "The Saloon",
    sub: "Ground floor · Stained glass · Panelled",
    standing: 150,
    banquet: 90,
  },
  {
    slug: "robert-adam-room",
    size: "md",
    image: "/rooms/robert-adam-wedding-opt.jpg",
    alt: "The Robert Adam Room with neoclassical plasterwork ceiling set for a ceremony",
    title: "Robert Adam Room",
    sub: "1st floor · Neoclassical · Plaster ceiling",
    standing: 120,
    banquet: 80,
  },
  {
    slug: "reception-room",
    size: "md",
    image: "/rooms/reception-wedding-opt.jpg",
    alt: "Reception Room dressed for a wedding ceremony with floral arch",
    title: "Reception Room",
    sub: "Ground floor · Intimate · Ceremony ready",
    standing: 80,
    banquet: 50,
  },
] as const;

function Rooms(): ReactElement {
  return (
    <section
      className="blk tight"
      id="rooms"
      style={{ borderTop: "1px solid var(--rule)", background: "var(--cream-2)" }}
    >
      <div className="wrap">
        <div className="sec-head">
          <div className="kicker">The rooms</div>
          <h2>
            Four rooms, one Robert Adam building. Start with whichever <em>fits the feeling</em>.
          </h2>
        </div>

        <div className="rooms-grid">
          {ROOMS.map((room) => (
            <Link
              key={room.slug}
              className={`room-card size-${room.size}`}
              to={`/plan?space=${room.slug}`}
              aria-label={`Open ${room.title} in the planner`}
            >
              <div className="image">
                <img src={room.image} alt={room.alt} loading="lazy" />
                {room.tag !== undefined ? <div className="tag">{room.tag}</div> : null}
              </div>
              <div className="meta">
                <div>
                  <h3>{room.title}</h3>
                  <div className="sub">{room.sub}</div>
                </div>
                <div className="capacity">
                  <b>{String(room.standing)}</b>standing<br />
                  {String(room.banquet)} banquet
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div style={{ marginTop: 44, display: "flex", justifyContent: "center" }}>
          <Link to="/plan" className="btn primary big">
            Open the planner with an empty room <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// FEATURES
// -----------------------------------------------------------------------------

const FEATURES = [
  {
    ico: "⌗",
    title: "To-scale floor plans",
    body: "Every room is surveyed and loaded at 1:50. Columns, windows, fire exits, power points — all exactly where they are in real life.",
  },
  {
    ico: "↔",
    title: "Instant layout swaps",
    body: "Toggle between ceremony, banquet, cabaret, theatre and standing receptions with one click. Counts update live.",
  },
  {
    ico: "✓",
    title: "Capacity & safety checks",
    body: "Spacing between rounds, aisle widths and fire egress are validated as you place. We flag anything that wouldn't pass.",
  },
  {
    ico: "£",
    title: "Transparent costing",
    body: "Furniture, staffing and AV line up against your plan so you can see the cost impact of every choice before you commit.",
  },
  {
    ico: "↻",
    title: "Save & share drafts",
    body: "Save as many versions as you like, share a read-only link with clients or colleagues, and come back to edit later.",
  },
  {
    ico: "☎",
    title: "Hand off to our team",
    body: "Send your plan and we handle the rest — a named coordinator, a costed proposal, and a walk-through of the room in person.",
  },
] as const;

function Features(): ReactElement {
  return (
    <section className="blk" id="planner">
      <div className="wrap">
        <div className="sec-head">
          <div className="kicker">What you can do</div>
          <h2>
            Every question our events team normally asks, answered <em>before you phone us</em>.
          </h2>
        </div>
        <div className="feat-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="f">
              <div className="ico" aria-hidden>{f.ico}</div>
              <h4>{f.title}</h4>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// QUOTE
// -----------------------------------------------------------------------------

function Quote(): ReactElement {
  return (
    <section className="quote" id="about">
      <div className="inner">
        <span className="mark" aria-hidden>“</span>
        <blockquote>
          We used to send six PDFs back and forth before anyone saw the actual room.
          Now couples plan their day themselves, to the centimetre, and we just make it happen.
        </blockquote>
        <div className="attribution">Fiona R. — Events Manager, Trades Hall Glasgow</div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// FINAL CTA
// -----------------------------------------------------------------------------

function FinalCTA(): ReactElement {
  return (
    <section className="final-cta">
      <div className="wrap">
        <h2>
          Your event, <em>to scale</em>.<br />In about ten minutes.
        </h2>
        <p>
          Pick a room and start placing furniture. No account required to try —
          save your draft when you're ready to share it with our team.
        </p>
        <div className="ctas">
          <Link to="/plan" className="btn primary big">Open the planner</Link>
          <a href="#contact" className="btn big">Book a site visit instead</a>
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// FOOTER
// -----------------------------------------------------------------------------

function SiteFooter(): ReactElement {
  return (
    <footer id="contact">
      <div className="wrap">
        <div className="grid">
          <div>
            <div className="brand" style={{ marginBottom: 16 }}>
              <span className="crest" aria-hidden>Th</span>
              <span className="lockup">
                <small>Est. 1791 · Glasgow</small>
                <b>Trades Hall</b>
              </span>
            </div>
            <div className="address-block">
              85 Glassford Street, Glasgow, G1 1UH<br />
              Event enquiries: +44 141 000 0000<br />
              events@tradeshall.example
            </div>
          </div>
          <div>
            <h5>Plan</h5>
            <ul>
              <li><Link to="/plan">Open planner</Link></li>
              <li><a href="#rooms">Choose a room</a></li>
              <li><a href="#how">Example layouts</a></li>
              <li><a href="#planner">Pricing guide</a></li>
            </ul>
          </div>
          <div>
            <h5>The Hall</h5>
            <ul>
              <li><a href="#about">About the building</a></li>
              <li><a href="#about">History &amp; restoration</a></li>
              <li><a href="#contact">Find us</a></li>
              <li><a href="#contact">Press</a></li>
            </ul>
          </div>
          <div>
            <h5>Legal</h5>
            <ul>
              <li><Link to="/legal/terms">Terms</Link></li>
              <li><Link to="/legal/privacy">Privacy</Link></li>
              <li><Link to="/legal/accessibility">Accessibility</Link></li>
              <li><a href="#contact">Contact</a></li>
            </ul>
          </div>
        </div>

        <div className="wordmark">Trades <em>Hall.</em></div>

        <div className="baseline">
          <span>© 2026 The Trades House of Glasgow · Planner by VenViewer</span>
          <span>Built in Glasgow</span>
        </div>
      </div>
    </footer>
  );
}
