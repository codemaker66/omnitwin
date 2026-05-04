import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { Link } from "react-router-dom";
import {
  computeBoundingBox,
  roomGeometries,
  type RoomGeometry,
} from "../data/room-geometries.js";
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

const META_TITLE = "Design your Grand Hall event — Trades Hall Glasgow";
const META_DESC =
  "Design your event inside the real Trades Hall Grand Hall. Try wedding, gala, or conference layouts to scale, then send a draft to the events team.";
const PHONE_PLANNER_QUERY = "(max-width: 639px)";
const PLAN_VIEWBOX_WIDTH = 840;
const PLAN_VIEWBOX_HEIGHT = 470;
const PLAN_VIEWBOX_PAD = 34;

function isPhonePlannerViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(PHONE_PLANNER_QUERY).matches;
}

type RoomSlug = "grand-hall" | "saloon" | "robert-adam-room" | "reception-room";
type RoomCardSize = "lg" | "md";
type GeometryName = keyof typeof roomGeometries;

interface VenueRoom {
  readonly slug: RoomSlug;
  readonly size: RoomCardSize;
  readonly geometryName: GeometryName;
  readonly image: string;
  readonly alt: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly sub: string;
  readonly standing: number;
  readonly banquet: number;
  readonly tag?: string;
}

const GRAND_HALL_ROOM: VenueRoom = {
  slug: "grand-hall",
  size: "lg",
  geometryName: "Grand Hall",
  image: "/rooms/Grand-Hall-scaled-opt.jpg",
  alt: "The Grand Hall set for a banquet with chandeliers and domed ceiling",
  title: "The Grand Hall",
  shortTitle: "Grand Hall",
  sub: "1st floor - double-height - domed ceiling and gallery",
  standing: 400,
  banquet: 240,
  tag: "Most booked",
};

const VENUE_ROOMS: readonly VenueRoom[] = [
  GRAND_HALL_ROOM,
  {
    slug: "saloon",
    size: "md",
    geometryName: "Saloon",
    image: "/rooms/saloon_TH_use.png",
    alt: "The Saloon with panelled walls and stained-glass windows set for a ceremony",
    title: "The Saloon",
    shortTitle: "Saloon",
    sub: "Ground floor - stained glass - panelled",
    standing: 150,
    banquet: 90,
  },
  {
    slug: "robert-adam-room",
    size: "md",
    geometryName: "Robert Adam Room",
    image: "/rooms/robert-adam-wedding-opt.jpg",
    alt: "The Robert Adam Room with neoclassical plasterwork ceiling set for a ceremony",
    title: "Robert Adam Room",
    shortTitle: "Robert Adam Room",
    sub: "1st floor - neoclassical - plaster ceiling",
    standing: 120,
    banquet: 80,
  },
  {
    slug: "reception-room",
    size: "md",
    geometryName: "Reception Room",
    image: "/rooms/reception-wedding-opt.jpg",
    alt: "Reception Room dressed for a wedding ceremony with floral arch",
    title: "Reception Room",
    shortTitle: "Reception Room",
    sub: "Ground floor - intimate - ceremony ready",
    standing: 80,
    banquet: 50,
  },
] as const;

function roomBySlug(slug: RoomSlug): VenueRoom {
  return VENUE_ROOMS.find((room) => room.slug === slug) ?? GRAND_HALL_ROOM;
}

function isRoomSlug(value: string): value is RoomSlug {
  return VENUE_ROOMS.some((room) => room.slug === value);
}

function plannerPathForRoom(room: VenueRoom): string {
  return `/plan?space=${room.slug}`;
}

function geometryForRoom(room: VenueRoom): RoomGeometry {
  const geometry = roomGeometries[room.geometryName];
  if (geometry === undefined) {
    throw new Error(`Missing landing room geometry for ${room.geometryName}`);
  }
  return geometry;
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
      data-layout="grand-hall"
      data-accent="oxblood"
      data-display="newsreader"
      ref={rootRef}
    >
      <TopNav />
      <Hero />
      <Rooms />
      <PlanriseLite />
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
        <ul>
          <li><a href="#rooms">Rooms</a></li>
          <li><a href="#experience">Planner</a></li>
        </ul>
        <div className="actions">
          <Link className="btn ghost" to="/login">Sign in</Link>
          <Link className="btn primary" to="/plan?space=grand-hall">
            Open Grand Hall <span aria-hidden>→</span>
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
  const [selectedRoomSlug, setSelectedRoomSlug] = useState<RoomSlug>("grand-hall");
  const selectedRoom = roomBySlug(selectedRoomSlug);
  const selectedPlannerPath = plannerPathForRoom(selectedRoom);

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
            <div className="eyebrow">Trades Hall Glasgow · Grand Hall planner</div>
            <h1>
              Design your event inside the real Grand Hall.
            </h1>
            <p className="lede">
              Try a wedding, gala, or conference layout to scale — then send it directly
              to the Trades Hall events team.
            </p>
            <div className="ctas">
              <Link
                to={selectedPlannerPath}
                className="btn primary big"
                onClick={onPreviewCtaClick}
              >
                Open the {selectedRoom.shortTitle} planner
                <span className="arrow" aria-hidden>→</span>
              </Link>
              <Link to={selectedPlannerPath} className="btn big">View in 3D</Link>
            </div>
            <div className="proof-row">
              <span>To scale</span>
              <span>{selectedRoom.shortTitle}</span>
              <span>Draft layout</span>
              <span>Sent to Events Team</span>
            </div>
            <div className="powered-by">Powered by Venviewer</div>
          </div>

          <div className="hero-right hero-media rise" style={{ transitionDelay: ".12s" }}>
            <div className="hero-media-photo" aria-label={`Trades Hall ${selectedRoom.shortTitle}`}>
              <img
                src={selectedRoom.image}
                alt={selectedRoom.alt}
                loading="eager"
              />
              <div className="hero-media-photo-copy">
                <span>Real {selectedRoom.shortTitle}</span>
                <strong>Heritage room, planning draft</strong>
              </div>
            </div>
          </div>
        </div>
        <div className="hero-planner-panel rise" style={{ transitionDelay: ".18s" }}>
          <div className="hero-media-planner">
            <PlannerPreview
              mode="embedded"
              room={selectedRoom}
              onRoomChange={setSelectedRoomSlug}
              onRequestFullscreen={openMobilePlanner}
            />
          </div>
          <div className="preview-caption">
            <span>Tap a layout. Move a table. Send a draft.</span>
            <span className="preview-caption-sub">{selectedRoom.shortTitle} · To-scale planning preview</span>
          </div>
          <Link to={selectedPlannerPath} className="btn primary big preview-cta" onClick={onPreviewCtaClick}>
            <span className="preview-cta-desktop">Open the {selectedRoom.shortTitle} planner</span>
            <span className="preview-cta-mobile">Open the {selectedRoom.shortTitle} planner</span>
            <span className="arrow" aria-hidden>→</span>
          </Link>
        </div>
      </div>
      {mobilePlannerOpen ? (
        <MobilePlannerOverlay
          room={selectedRoom}
          onRoomChange={setSelectedRoomSlug}
          onClose={() => { setMobilePlannerOpen(false); }}
        />
      ) : null}
    </header>
  );
}

interface MobilePlannerOverlayProps {
  readonly room: VenueRoom;
  readonly onRoomChange: (slug: RoomSlug) => void;
  readonly onClose: () => void;
}

function MobilePlannerOverlay({ room, onRoomChange, onClose }: MobilePlannerOverlayProps): ReactElement {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [onClose]);

  return (
    <div className="mobile-planner-shell" role="dialog" aria-modal="true" aria-label={`${room.shortTitle} mobile planner`}>
      <div className="mobile-planner-topbar">
        <button type="button" className="mobile-planner-back" onClick={onClose} aria-label="Close planner">
          Back
        </button>
        <div className="mobile-planner-title">
          <strong>{room.shortTitle}</strong>
          <span>To-scale draft preview</span>
        </div>
        <Link to={plannerPathForRoom(room)} className="mobile-planner-3d">
          View in 3D <span aria-hidden>→</span>
        </Link>
      </div>
      <PlannerPreview mode="fullscreen" room={room} onRoomChange={onRoomChange} />
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

interface RoomPlanMetrics {
  readonly minX: number;
  readonly minZ: number;
  readonly widthM: number;
  readonly lengthM: number;
  readonly scale: number;
  readonly roomLeftPx: number;
  readonly roomTopPx: number;
  readonly roomLeftPct: number;
  readonly roomTopPct: number;
  readonly metresToWidthPct: number;
  readonly metresToHeightPct: number;
}

function buildRoomPlanMetrics(room: VenueRoom): RoomPlanMetrics {
  const geometry = geometryForRoom(room);
  const bbox = computeBoundingBox(geometry.wallPolygon);
  const availableWidth = PLAN_VIEWBOX_WIDTH - PLAN_VIEWBOX_PAD * 2;
  const availableHeight = PLAN_VIEWBOX_HEIGHT - PLAN_VIEWBOX_PAD * 2;
  const scale = Math.min(availableWidth / bbox.width, availableHeight / bbox.depth);
  const roomLeftPx = (PLAN_VIEWBOX_WIDTH - bbox.width * scale) / 2;
  const roomTopPx = (PLAN_VIEWBOX_HEIGHT - bbox.depth * scale) / 2;
  return {
    minX: bbox.minX,
    minZ: bbox.minZ,
    widthM: bbox.width,
    lengthM: bbox.depth,
    scale,
    roomLeftPx,
    roomTopPx,
    roomLeftPct: (roomLeftPx / PLAN_VIEWBOX_WIDTH) * 100,
    roomTopPct: (roomTopPx / PLAN_VIEWBOX_HEIGHT) * 100,
    metresToWidthPct: (scale / PLAN_VIEWBOX_WIDTH) * 100,
    metresToHeightPct: (scale / PLAN_VIEWBOX_HEIGHT) * 100,
  };
}

interface MetrePlacement {
  /** Item's top-left x in metres, measured from the room's left wall. */
  readonly x: number;
  /** Item's top-left y in metres, measured from the room's back wall. */
  readonly y: number;
  readonly widthM: number;
  readonly heightM: number;
}

function placeStyle(
  p: MetrePlacement,
  metrics: RoomPlanMetrics,
): { left: string; top: string; width: string; height: string } {
  return {
    left: `${String(metrics.roomLeftPct + p.x * metrics.metresToWidthPct)}%`,
    top: `${String(metrics.roomTopPct + p.y * metrics.metresToHeightPct)}%`,
    width: `${String(p.widthM * metrics.metresToWidthPct)}%`,
    height: `${String(p.heightM * metrics.metresToHeightPct)}%`,
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

const LAYOUT_SUMMARIES: Readonly<Record<EventType, {
  readonly seats: string;
  readonly focus: string;
  readonly status: string;
}>> = {
  wedding: { seats: "114", focus: "10 rounds", status: "Draft" },
  gala: { seats: "Standing", focus: "Bar + dancefloor", status: "Draft" },
  conference: { seats: "50", focus: "Rows + stage", status: "Draft" },
};

function clampPlacement(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function makeItem(
  id: string,
  kind: ItemKind,
  placement: MetrePlacement,
  klass: PlannerItem["klass"],
  body: string,
  tag?: string,
  tagDark?: boolean,
): PlannerItem {
  return {
    id,
    kind,
    x: placement.x,
    y: placement.y,
    widthM: placement.widthM,
    heightM: placement.heightM,
    klass,
    body,
    tag,
    tagDark,
  };
}

function genericPreviewLayout(eventType: EventType, metrics: RoomPlanMetrics): readonly PlannerItem[] {
  const w = metrics.widthM;
  const h = metrics.lengthM;
  const stageW = Math.min(4.8, w * 0.46);
  const stageH = Math.min(2.1, h * 0.22);
  const barW = Math.min(4.2, w * 0.36);
  const danceW = Math.min(4.4, w * 0.44);
  const danceH = Math.min(2.8, h * 0.32);
  const round = Math.min(1.55, Math.max(1.1, w * 0.16));

  if (eventType === "gala") {
    return [
      makeItem("stage", "stage", {
        x: (w - stageW) / 2,
        y: h * 0.08,
        widthM: stageW,
        heightM: stageH,
      }, "furn", "Stage", `STAGE · ${stageW.toFixed(1)}m`),
      makeItem("bar", "bar", {
        x: clampPlacement(w - 1.05, w - 0.9),
        y: h * 0.22,
        widthM: 0.9,
        heightM: Math.min(4.6, h * 0.56),
      }, "furn dark", "Bar", "BAR", true),
      makeItem("dancefloor", "dancefloor", {
        x: (w - danceW) / 2,
        y: h * 0.48,
        widthM: danceW,
        heightM: danceH,
      }, "furn dark", "Parquet", "DANCEFLOOR", true),
      makeItem("poseur-0", "poseur", { x: w * 0.16, y: h * 0.48, widthM: 0.7, heightM: 0.7 }, "furn round", "4"),
      makeItem("poseur-1", "poseur", { x: w * 0.16, y: h * 0.68, widthM: 0.7, heightM: 0.7 }, "furn round", "4"),
      makeItem("poseur-2", "poseur", { x: w * 0.72, y: h * 0.72, widthM: 0.7, heightM: 0.7 }, "furn round", "4"),
    ];
  }

  if (eventType === "conference") {
    const rowW = Math.min(0.8, w * 0.09);
    const rowH = Math.min(4.8, h * 0.55);
    const startX = Math.max(stageW + 0.7, w * 0.38);
    const gap = Math.max(1.1, (w - startX - rowW) / 4);
    return [
      makeItem("stage", "stage", {
        x: 0.35,
        y: (h - Math.min(5.8, h * 0.7)) / 2,
        widthM: Math.min(2.3, w * 0.22),
        heightM: Math.min(5.8, h * 0.7),
      }, "furn", "Stage", "STAGE"),
      makeItem("lectern", "lectern", {
        x: Math.min(w * 0.3, 3),
        y: h * 0.46,
        widthM: 0.7,
        heightM: 0.9,
      }, "furn dark", "", "LECTERN", true),
      ...Array.from({ length: 4 }, (_, index) => makeItem(`row-${String(index + 1)}`, "row", {
        x: clampPlacement(startX + gap * index, w - rowW - 0.4),
        y: (h - rowH) / 2,
        widthM: rowW,
        heightM: rowH,
      }, "furn", "", index === 0 ? "ROW · 8 seats" : undefined)),
    ];
  }

  return [
    makeItem("stage", "stage", {
      x: (w - stageW) / 2,
      y: h * 0.08,
      widthM: stageW,
      heightM: stageH,
    }, "furn", "Stage", `STAGE · ${stageW.toFixed(1)}m`),
    makeItem("bar", "bar", {
      x: clampPlacement(w - barW - 0.45, w - barW),
      y: h * 0.12,
      widthM: barW,
      heightM: 0.8,
    }, "furn dark", "Bar", "BAR", true),
    makeItem("dancefloor", "dancefloor", {
      x: clampPlacement(w - danceW - 0.55, w - danceW),
      y: h * 0.42,
      widthM: danceW,
      heightM: danceH,
    }, "furn dark", "Parquet", "DANCEFLOOR", true),
    makeItem("round-0", "round", { x: w * 0.12, y: h * 0.43, widthM: round, heightM: round }, "furn round", "10"),
    makeItem("round-1", "round", { x: w * 0.36, y: h * 0.43, widthM: round, heightM: round }, "furn round", "10"),
    makeItem("round-2", "round", { x: w * 0.12, y: h * 0.68, widthM: round, heightM: round }, "furn round", "10"),
    makeItem("round-3", "round", { x: w * 0.36, y: h * 0.68, widthM: round, heightM: round }, "furn round", "10"),
    makeItem("top-table", "top-table", {
      x: (w - Math.min(4.2, w * 0.5)) / 2,
      y: clampPlacement(h - 1.2, h - 1),
      widthM: Math.min(4.2, w * 0.5),
      heightM: 0.9,
    }, "furn", "Top table", "TOP TABLE"),
  ];
}

function buildPreviewLayout(eventType: EventType, room: VenueRoom, metrics: RoomPlanMetrics): readonly PlannerItem[] {
  if (room.slug === "grand-hall") return LAYOUTS[eventType];
  return genericPreviewLayout(eventType, metrics);
}

function layoutSummaryForRoom(
  eventType: EventType,
  room: VenueRoom,
): { readonly seats: string; readonly focus: string; readonly status: string } {
  if (room.slug === "grand-hall") return LAYOUT_SUMMARIES[eventType];
  if (eventType === "gala") {
    return { seats: "Standing", focus: `${String(room.standing)} cap`, status: "Draft" };
  }
  if (eventType === "conference") {
    return { seats: String(Math.min(room.banquet, 56)), focus: "Rows + stage", status: "Draft" };
  }
  return { seats: String(room.banquet), focus: "Room-scaled draft", status: "Draft" };
}

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

/** Convert a viewport mouse point to room-metre coordinates via the stage's
 *  bounding rect. Returns null when the event source is unusable. */
function clientToMetres(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  metrics: RoomPlanMetrics,
): { xM: number; yM: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const pxPerMX = (rect.width * metrics.scale) / PLAN_VIEWBOX_WIDTH;
  const pxPerMY = (rect.height * metrics.scale) / PLAN_VIEWBOX_HEIGHT;
  const roomPxLeft = (rect.width * metrics.roomLeftPx) / PLAN_VIEWBOX_WIDTH;
  const roomPxTop = (rect.height * metrics.roomTopPx) / PLAN_VIEWBOX_HEIGHT;
  const xM = (clientX - rect.left - roomPxLeft) / pxPerMX;
  const yM = (clientY - rect.top - roomPxTop) / pxPerMY;
  return { xM, yM };
}

interface PlannerPreviewProps {
  readonly mode: "embedded" | "fullscreen";
  readonly room: VenueRoom;
  readonly onRoomChange: (slug: RoomSlug) => void;
  readonly onRequestFullscreen?: () => void;
}

function PlannerPreview({ mode, room, onRoomChange, onRequestFullscreen }: PlannerPreviewProps): ReactElement {
  const metrics = useMemo(() => buildRoomPlanMetrics(room), [room]);
  const [eventType, setEventType] = useState<EventType>("wedding");
  const [selectedId, setSelectedId] = useState<string>("round-3");
  const [items, setItems] = useState<readonly PlannerItem[]>(() =>
    buildPreviewLayout("wedding", GRAND_HALL_ROOM, buildRoomPlanMetrics(GRAND_HALL_ROOM)),
  );
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

  useEffect(() => {
    const nextItems = buildPreviewLayout(eventType, room, metrics);
    setItems(nextItems);
    setSelectedId(nextItems[0]?.id ?? "");
  }, [eventType, room, metrics]);

  const requestFullscreenIfMobile = (): boolean => {
    if (isFullscreen || onRequestFullscreen === undefined || !isPhonePlannerViewport()) return false;
    onRequestFullscreen();
    return true;
  };

  const onMobilePreviewOpen = (): void => {
    if (onRequestFullscreen !== undefined) onRequestFullscreen();
  };

  const switchLayout = (next: EventType): void => { setEventType(next); };

  const onRoomSelect = (event: ChangeEvent<HTMLSelectElement>): void => {
    const nextSlug = event.target.value;
    if (isRoomSlug(nextSlug)) onRoomChange(nextSlug);
  };

  /** Drop an item at room-metre (xM, yM) — used by the catalogue-chip
   *  drag-and-drop flow. Generates a fresh id, clamps to room bounds so
   *  nothing escapes the walls, and selects the new item. */
  const dropCatalogueItem = (entry: CatalogueEntry, xM: number, yM: number): void => {
    newItemCounter.current += 1;
    const id = `new-${entry.kind}-${String(newItemCounter.current)}`;
    const clampedX = Math.max(0, Math.min(metrics.widthM - entry.widthM, xM - entry.widthM / 2));
    const clampedY = Math.max(0, Math.min(metrics.lengthM - entry.heightM, yM - entry.heightM / 2));
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
        x: Math.max(0, Math.min(metrics.widthM - newW, cx - newW / 2)),
        y: Math.max(0, Math.min(metrics.lengthM - newH, cy - newH / 2)),
      };
    }));
  };

  /** Pointer-move over the stage — updates the live coord chip. Fires
   *  every mouse frame while hovering, cheap because state only stores
   *  two numbers + the chip re-renders from them. */
  const onStagePointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (stageRef.current === null) return;
    const rect = stageRef.current.getBoundingClientRect();
    const m = clientToMetres(e.clientX, e.clientY, rect, metrics);
    if (m === null) return;
    setCursor({
      xM: Math.max(0, Math.min(metrics.widthM, m.xM)),
      yM: Math.max(0, Math.min(metrics.lengthM, m.yM)),
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
    const m = clientToMetres(e.clientX, e.clientY, rect, metrics);
    if (m === null) return;
    dropCatalogueItem(entry, m.xM, m.yM);
  };

  const selectedItem = items.find((item) => item.id === selectedId);
  const selectedKind = selectedItem?.kind ?? "round";
  const info: PreviewItem = PREVIEW_ITEMS[selectedKind] ?? ROUND_ITEM;
  const summary = layoutSummaryForRoom(eventType, room);

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
    const pxPerMX = (rect.width * metrics.scale) / PLAN_VIEWBOX_WIDTH;
    const pxPerMY = (rect.height * metrics.scale) / PLAN_VIEWBOX_HEIGHT;
    if (pxPerMX <= 0 || pxPerMY <= 0) return;
    const dxM = (e.clientX - d.startX) / pxPerMX;
    const dyM = (e.clientY - d.startY) / pxPerMY;
    // 2 pixel drag threshold before committing to a move — below that,
    // treat the gesture as a click so selection still works on a tap.
    if (!d.moved && Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 3) return;
    d.moved = true;
    setItems((prev) => prev.map((i) => {
      if (i.id !== d.id) return i;
      const maxX = Math.max(0, metrics.widthM - i.widthM);
      const maxY = Math.max(0, metrics.lengthM - i.heightM);
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
        <div className="title"><b>{room.shortTitle}</b> · {eventType} layout · Draft</div>
        <div className="right">Preview</div>
      </div>

      <div className="body">
        <aside className="sidebar" aria-label="Planner controls">
          <div className="field room-field">
            <label htmlFor={`landing-room-${mode}`}>Room</label>
            <select
              id={`landing-room-${mode}`}
              className="input room-select"
              value={room.slug}
              onChange={onRoomSelect}
              aria-label="Choose room"
            >
              {VENUE_ROOMS.map((option) => (
                <option key={option.slug} value={option.slug}>
                  {option.shortTitle}
                </option>
              ))}
            </select>
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
                    dropCatalogueItem(entry, metrics.widthM / 2, metrics.lengthM / 2);
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
          <RoomPlanSvg room={room} metrics={metrics} patternId={`th-hatch-room-${mode}-${room.slug}`} />

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
              style={{ ...placeStyle(item, metrics), touchAction: "none" }}
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
              <div className="chip">Seats <b>{summary.seats}</b></div>
              <div className="chip">Focus <b>{summary.focus}</b></div>
              <div className="chip">Venue check <b>{summary.status}</b></div>
            </div>
            <div className="coord">
              {cursor === null
                ? "— · — · 1:50"
                : `X ${cursor.xM.toFixed(1)} m · Y ${cursor.yM.toFixed(1)} m · 1:50`}
            </div>
          </div>
          {!isFullscreen ? (
            <button type="button" className="mobile-preview-open" onClick={onMobilePreviewOpen}>
              Open planner
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
            <h5>Venue review</h5>
            <div className="kv"><span>Flow</span><span>Draft check</span></div>
            <div className="kv"><span>Capacity</span><span>Team review</span></div>
            <div className="kv"><span>Aisles</span><span>1.2 m target</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

interface RoomPlanSvgProps {
  readonly room: VenueRoom;
  readonly metrics: RoomPlanMetrics;
  readonly patternId: string;
}

function formatMetres(value: number): string {
  return Number.isInteger(value) ? `${String(value)} m` : `${value.toFixed(1)} m`;
}

function polygonToPath(
  polygon: readonly (readonly [number, number])[],
  metrics: RoomPlanMetrics,
): string {
  return polygon
    .map(([x, z], index) => {
      const svgX = metrics.roomLeftPx + (x - metrics.minX) * metrics.scale;
      const svgY = metrics.roomTopPx + (z - metrics.minZ) * metrics.scale;
      const command = index === 0 ? "M" : "L";
      return `${command} ${svgX.toFixed(2)} ${svgY.toFixed(2)}`;
    })
    .join(" ")
    .concat(" Z");
}

function RoomPlanSvg({ room, metrics, patternId }: RoomPlanSvgProps): ReactElement {
  const geometry = geometryForRoom(room);
  const outline = polygonToPath(geometry.wallPolygon, metrics);
  const dimX = PLAN_VIEWBOX_WIDTH / 2;
  const dimY = Math.max(18, metrics.roomTopPx - 8);
  const sideX = Math.max(16, metrics.roomLeftPx - 18);
  const sideY = metrics.roomTopPx + (metrics.lengthM * metrics.scale) / 2;
  const lowerLabelY = Math.min(PLAN_VIEWBOX_HEIGHT - 18, metrics.roomTopPx + metrics.lengthM * metrics.scale + 18);

  return (
    <svg
      className="room-svg"
      viewBox={`0 0 ${String(PLAN_VIEWBOX_WIDTH)} ${String(PLAN_VIEWBOX_HEIGHT)}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <defs>
        <pattern
          id={patternId}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="8" stroke="currentColor" strokeWidth="0.8" opacity=".55" />
        </pattern>
      </defs>
      <g style={{ color: "var(--ink-3)" }}>
        <path d={outline} fill={`url(#${patternId})`} stroke="none" />
        <path
          d={outline}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="miter"
          vectorEffect="non-scaling-stroke"
        />
      </g>
      <g
        style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 9 }}
        fill="currentColor"
        stroke="none"
        opacity=".7"
        textAnchor="middle"
        letterSpacing="0.5"
      >
        {room.slug === "grand-hall" ? (
          <>
            <text x={metrics.roomLeftPx + 90} y={lowerLabelY}>WINDOW</text>
            <text x={metrics.roomLeftPx + metrics.widthM * metrics.scale - 90} y={lowerLabelY}>WINDOW</text>
            <text x={dimX} y={Math.min(PLAN_VIEWBOX_HEIGHT - 8, lowerLabelY + 18)} style={{ fontSize: 10 }} opacity=".9">
              BALCONY
            </text>
          </>
        ) : (
          <text x={dimX} y={Math.min(PLAN_VIEWBOX_HEIGHT - 12, lowerLabelY)}>
            {room.shortTitle.toUpperCase()}
          </text>
        )}
      </g>
      <g
        style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 10 }}
        fill="currentColor"
        stroke="none"
        opacity=".65"
      >
        <text x={dimX} y={dimY} textAnchor="middle" letterSpacing="0.8">
          {formatMetres(metrics.widthM)}
        </text>
        <text x={sideX} y={sideY} transform={`rotate(-90 ${String(sideX)} ${String(sideY)})`} letterSpacing="0.8">
          {formatMetres(metrics.lengthM)}
        </text>
      </g>
    </svg>
  );
}

// -----------------------------------------------------------------------------
// ROOMS
// -----------------------------------------------------------------------------

function Rooms(): ReactElement {
  return (
    <section className="rooms-section" id="rooms" aria-labelledby="rooms-title">
      <div className="wrap">
        <div className="rooms-head rise">
          <div className="kicker">The rooms</div>
          <h2 id="rooms-title">
            Four rooms, one Robert Adam building. Start with whichever <em>fits the feeling</em>.
          </h2>
        </div>

        <div className="rooms-grid">
          {VENUE_ROOMS.map((room) => (
            <Link
              key={room.slug}
              className={`room-card size-${room.size}`}
              to={plannerPathForRoom(room)}
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

        <div className="rooms-actions">
          <Link to="/plan" className="btn primary big">
            Open the planner with an empty room <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// PLANRISE LITE
// -----------------------------------------------------------------------------

const PLANRISE_BEATS = [
  {
    num: "01",
    title: "Choose the mood",
    body: "Wedding, gala, or conference drafts reshape the same measured Grand Hall plan.",
    stat: "3 venue-ready starts",
  },
  {
    num: "02",
    title: "Watch the room answer",
    body: "Tables, bar, dancefloor, and stage move together while seats and review notes update.",
    stat: "Layout responds live",
  },
  {
    num: "03",
    title: "Step from plan into space",
    body: "The flat draft and 3D planner are the same layout, not two separate sketches.",
    stat: "2D and 3D linked",
  },
  {
    num: "04",
    title: "Send a proper draft",
    body: "The Trades Hall events team receives the plan as a starting point for venue review.",
    stat: "Ready for review",
  },
] as const;

function PlanriseLite(): ReactElement {
  return (
    <section className="planrise" id="experience" aria-labelledby="planrise-title">
      <div className="wrap">
        <div className="planrise-head rise">
          <div className="kicker">Planrise preview</div>
          <h2 id="planrise-title">
            Watch the Grand Hall respond as your event takes <em>shape</em>.
          </h2>
          <p>
            Choose a starting point, see the room rearrange, move from plan to 3D,
            and send a draft when it feels right.
          </p>
        </div>
        <div className="planrise-stage rise" style={{ transitionDelay: ".12s" }}>
            <div className="planrise-visual" aria-label="Animated Grand Hall planning sequence">
              <div className="planrise-photo" aria-hidden>
                <span>Wedding selected</span>
                <strong>114 seats</strong>
                <em>Round tables + dancefloor</em>
              </div>
            <div className="planrise-plan" aria-hidden>
              <div className="planrise-room">
                <span className="planrise-stage-block">Stage</span>
                <span className="planrise-bar-block">Bar</span>
                <span className="planrise-dance-block">Dancefloor</span>
                {Array.from({ length: 10 }, (_, index) => (
                  <i key={index} className={`planrise-table planrise-table-${String(index + 1)}`} />
                ))}
                <span className="planrise-camera-line" />
              </div>
            </div>
            <div className="planrise-3d-card" aria-hidden>
              <img
                src="/rooms/Grand-Hall-scaled-opt.jpg"
                alt="Trades Hall Grand Hall 3D preview"
                loading="lazy"
              />
              <span>3D view</span>
            </div>
            <div className="planrise-send-card" aria-hidden>
              <span>Draft ready</span>
              <strong>Send to Events Team</strong>
            </div>
            <div className="planrise-timeline" aria-hidden>
              <span className="on">Plan</span>
              <span>Preset</span>
              <span>3D</span>
              <span>Send</span>
            </div>
          </div>

          <div className="planrise-copy">
            {PLANRISE_BEATS.map((beat) => (
              <article key={beat.num} className="planrise-beat">
                <div className="beat-num">{beat.num}</div>
                <div>
                  <div className="beat-stat">{beat.stat}</div>
                  <h3>{beat.title}</h3>
                  <p>{beat.body}</p>
                </div>
              </article>
            ))}
            <Link to="/plan?space=grand-hall" className="btn primary big planrise-cta">
              Open the Grand Hall planner <span className="arrow" aria-hidden>&rarr;</span>
            </Link>
          </div>
        </div>
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
          Ready to try your <em>Grand Hall</em> layout?
        </h2>
        <p>
          Open a draft, arrange the room, and send the plan to the Trades Hall events
          team when you are ready for venue review.
        </p>
        <div className="ctas">
          <Link to="/plan?space=grand-hall" className="btn primary big">Open the Grand Hall planner</Link>
          <Link to="/plan?space=grand-hall" className="btn big">View in 3D</Link>
        </div>
        <div className="powered-by final-powered">Powered by Venviewer</div>
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
              Event enquiries through the Trades Hall events team.<br />
              Use the planner draft as the conversation starter.
            </div>
          </div>
          <div>
            <h5>Plan</h5>
            <ul>
              <li><Link to="/plan?space=grand-hall">Open Grand Hall planner</Link></li>
              <li><a href="#presets">Wedding draft</a></li>
              <li><a href="#presets">Gala draft</a></li>
              <li><a href="#presets">Conference draft</a></li>
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
          <span>© 2026 The Trades House of Glasgow · Powered by Venviewer</span>
          <span>Built in Glasgow</span>
        </div>
      </div>
    </footer>
  );
}
