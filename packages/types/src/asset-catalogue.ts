// ---------------------------------------------------------------------------
// Canonical asset catalogue — the single source of truth for furniture items
//
// Both the DB seed (packages/api/src/db/seed.ts) and the web catalogue
// (packages/web/src/lib/catalogue.ts) derive from this list. Every item
// has a deterministic UUID generated via UUID v5 from its slug, using the
// OMNITWIN namespace 43033bd6-17fd-599e-b305-0bd60dec57f0. This means:
//
//   - The seed can set the DB primary key to the deterministic UUID, so
//     re-running the seed produces the same rows (idempotent).
//   - The web catalogue uses the same UUID as the item `id`, so
//     placed-object saves reference valid DB foreign keys.
//   - A reviewer can verify the UUID by running:
//       uuid v5("<slug>", "43033bd6-17fd-599e-b305-0bd60dec57f0")
//
// The slugs (e.g., "round-table-6ft") are the stable developer-facing
// identifiers — grep-able, readable in URLs, safe for test fixtures.
// The UUIDs are the DB-facing identifiers — FK-valid, globally unique.
//
// IMPORTANT: when adding a new catalogue item:
//   1. Pick a slug (kebab-case, unique)
//   2. Generate its UUID: node -e "...uuid v5(slug, NS)..."
//   3. Add the entry here
//   4. Re-run the seed
// ---------------------------------------------------------------------------

import type { FurnitureCategory } from "./furniture.js";
import type { EquipmentTag } from "./event-requirements.js";

export type TableShape = "round" | "rectangular";

export interface CanonicalAsset {
  /** Deterministic UUID v5 — DB primary key for asset_definitions. */
  readonly id: string;
  /** Developer-facing slug — stable, grep-able, used for icon dispatch. */
  readonly slug: string;
  /** Human-readable name — shown in UI, stored in DB, used for hallkeeper sheet. */
  readonly name: string;
  /** FurnitureCategory enum value. */
  readonly category: FurnitureCategory;
  /** Dimensions in real-world metres. */
  readonly widthM: number;
  readonly depthM: number;
  readonly heightM: number;
  /** Provisional planning dimensions awaiting measurement confirmation. */
  readonly dimensionStatus?: "approximate";
  /** Seated capacity. Null for non-seating items (stages, AV, decor). */
  readonly seatCount: number | null;
  /** Collision shape hint for the 3D editor. */
  readonly collisionType: "box" | "cylinder";
  /** Table shape hint for chair auto-snap. Null for non-tables. */
  readonly tableShape: TableShape | null;
  /** Maximum simultaneous instances in a layout. Null = unlimited. */
  readonly maxCount: number | null;
  /** Short subtitle for the catalogue panel. */
  readonly subtitle: string;
  /** Colour for the placeholder mesh (hex). */
  readonly color: string;
  /** Optional versioned presentation asset; dimensions remain catalogue facts. */
  readonly meshUrl?: string;
  /** Render of the supplied 3D model, not a photograph or stock evidence. */
  readonly thumbnailUrl?: string;
  /**
   * Implicit event-sheet requirements triggered by placing this asset.
   * Drives the "Technical requirements" section on the hallkeeper
   * sheet via the extraction engine (packages/api/src/services/
   * event-sheet-extractor.ts). Most assets have no tags (chairs,
   * decor, cloths); AV assets have several; lecterns imply
   * water-supply; stages imply dimmable-lighting. Tags are deduped
   * across placements at extraction time so "2 projectors + 1 laptop"
   * collapses to a single "power-outlet × 3" line, not three lines.
   *
   * Kept as `readonly EquipmentTag[]` rather than `ReadonlySet` so the
   * literal data below stays inspectable and diff-friendly.
   */
  readonly equipmentTags: readonly EquipmentTag[];
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export const CANONICAL_ASSETS: readonly CanonicalAsset[] = [
  // --- Tables ---
  // Tables don't imply equipment on their own; chargers + string-lights
  // are opt-in per-event rather than implicit at placement.
  {
    id: "a1ef4d89-7786-5878-bee1-87b3fac28200",
    slug: "round-table-6ft",
    name: "6ft Round Table",
    category: "table",
    widthM: 1.83, depthM: 1.83, heightM: 0.76,
    seatCount: 10, collisionType: "cylinder", tableShape: "round",
    maxCount: null, subtitle: "1.8m round \u00B7 seats up to 12", color: "#c4a882",
    equipmentTags: [],
  },
  {
    id: "c0d0b2df-23de-5265-81f3-2c06af79697d",
    slug: "trestle-6ft",
    meshUrl: "/models/furniture/trestle-6ft/v1/model.glb",
    thumbnailUrl: "/models/furniture/trestle-6ft/v1/preview.webp",
    name: "6ft Trestle Table",
    category: "table",
    widthM: 1.83, depthM: 0.76, heightM: 0.74,
    seatCount: null, collisionType: "box", tableShape: "rectangular",
    maxCount: null, subtitle: "1.8m \u00D7 0.76m \u00B7 seats up to 20", color: "#b89b72",
    equipmentTags: [],
  },
  {
    id: "7b423ca2-9714-5cb2-919c-e938a5c39933",
    slug: "trestle-4ft",
    name: "4ft Trestle Table",
    category: "table",
    widthM: 1.22, depthM: 0.76, heightM: 0.74,
    seatCount: null, collisionType: "box", tableShape: "rectangular",
    maxCount: null, subtitle: "1.2m \u00D7 0.76m \u00B7 seats up to 12", color: "#b89b72",
    equipmentTags: [],
  },
  {
    id: "19d030aa-bc18-5665-8561-1e26e0679fe3",
    slug: "poseur-table",
    name: "Poseur Table",
    category: "table",
    widthM: 0.60, depthM: 0.60, heightM: 1.05,
    seatCount: null, collisionType: "cylinder", tableShape: "round",
    maxCount: null, subtitle: "60cm round \u00B7 standing height", color: "#c0c0c8",
    equipmentTags: [],
  },
  {
    id: "a06f4c87-0ad6-5573-85a4-025276c2de03",
    slug: "poseur-table-black",
    meshUrl: "/models/furniture/poseur-table-black/v1/model.glb",
    thumbnailUrl: "/models/furniture/poseur-table-black/v1/preview.webp",
    name: "Poseur Table (Black)",
    category: "table",
    widthM: 0.60, depthM: 0.60, heightM: 1.05,
    seatCount: null, collisionType: "cylinder", tableShape: "round",
    maxCount: null, subtitle: "60cm round \u00B7 black cloth", color: "#1a1a1a",
    equipmentTags: [],
  },
  {
    id: "55534f43-9515-5489-8963-f314712ae4db",
    slug: "poseur-table-white",
    meshUrl: "/models/furniture/poseur-table-white/v1/model.glb",
    thumbnailUrl: "/models/furniture/poseur-table-white/v1/preview.webp",
    name: "Poseur Table (White)",
    category: "table",
    widthM: 0.60, depthM: 0.60, heightM: 1.05,
    seatCount: null, collisionType: "cylinder", tableShape: "round",
    maxCount: null, subtitle: "60cm round \u00B7 white cloth", color: "#f0ede8",
    equipmentTags: [],
  },

  // --- Chairs ---
  {
    id: "4dfcae64-b6e3-54f8-817f-af041edab935",
    slug: "banquet-chair",
    name: "Banquet Chair",
    category: "chair",
    widthM: 0.45, depthM: 0.45, heightM: 0.90,
    seatCount: 1, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "Padded \u00B7 stackable", color: "#a82020",
    equipmentTags: [],
  },

  {
    id: "7f1fb7a2-5210-57b1-9108-11255c059520",
    slug: "burgess-turini-18-3",
    name: "Burgess Turini 18/3",
    category: "chair",
    // Manufacturer's standard 18/3 specifications, identified by Blake.
    // The supplied Rodin model is generated presentation geometry.
    widthM: 0.42, depthM: 0.58, heightM: 0.88,
    seatCount: 1, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "42 × 58cm · seat height 44.5cm", color: "#bd7769",
    meshUrl: "/models/furniture/burgess-turini-18-3/v1/chair.glb",
    thumbnailUrl: "/models/furniture/burgess-turini-18-3/v1/preview.webp",
    equipmentTags: [],
  },

  // --- Stage ---
  // Stages imply dimmable lighting so the hallkeeper confirms the room
  // can spotlight a speaker/performer without floodlighting the audience.
  {
    id: "dec6b24b-d72c-5e5e-a883-cc9deed2f322",
    slug: "platform",
    meshUrl: "/models/furniture/platform/v1/model.glb",
    thumbnailUrl: "/models/furniture/platform/v1/preview.webp",
    name: "Platform",
    category: "stage",
    widthM: 2.44, depthM: 1.22, heightM: 0.40,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "2.4m \u00D7 1.2m \u00B7 40cm high", color: "#4a4a4a",
    equipmentTags: ["dimmable-lighting"],
  },
  {
    id: "d5273408-6b5c-5f4c-b12c-3f61fe3c7a51",
    slug: "platform-narrow",
    name: "Narrow Platform",
    category: "stage",
    widthM: 2.44, depthM: 1.02, heightM: 0.40,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: 1, subtitle: "2.4m \u00D7 1.0m \u00B7 40cm high", color: "#4a4a4a",
    equipmentTags: ["dimmable-lighting"],
  },
  // Dance floor: a 3ft parquet panel, the UK hire unit. Panels tile to the
  // standard 12/15/18ft floors, so this is placed in quantity rather than as
  // one pre-sized object. Category `stage` routes it to the hallkeeper's
  // `structure` setup phase ("risers, dance floor"), which is where the crew
  // expects it. Unlike every other `stage` asset it is WALKED ON, not around \u2014
  // see DANCEFLOOR_CATALOGUE_SLUG in the web guest-flow input.
  {
    id: "b05eaa9b-c25e-52ef-9d59-c2913c23f9b8",
    slug: "dancefloor-panel",
    name: "Parquet Dance Floor Panel",
    category: "stage",
    widthM: 0.91, depthM: 0.91, heightM: 0.05,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "3ft parquet panel \u00B7 tiles to any floor size", color: "#8a6034",
    equipmentTags: ["dimmable-lighting"],
  },

  // --- AV ---
  // Projector screen: mounted overhead, daylight-sensitive, benefits
  // from dimmable room lighting for contrast.
  {
    id: "26e25cd4-ae3e-537d-9ac0-66021f925cdd",
    slug: "projector-screen",
    name: "Projector Screen",
    category: "av",
    widthM: 2.50, depthM: 0.60, heightM: 1.80,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "2.5m wide \u00B7 freestanding", color: "#1a1a1a",
    equipmentTags: ["overhead-rig", "dimmable-lighting", "blackout"],
  },
  // Projector: needs mains power and a signal path to the source device.
  {
    id: "6907e1d9-33d6-5910-b55f-78a77727d6b0",
    slug: "projector",
    name: "Laser Projector",
    category: "av",
    widthM: 0.55, depthM: 0.35, heightM: 0.10,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "55cm \u00B7 table-mountable", color: "#3a3a40",
    equipmentTags: ["power-outlet", "av-cable-path"],
  },
  // Laptop: power + HDMI/USB-C to the projector + network for modern
  // presentation flows (cloud slides, Zoom, live demo).
  {
    id: "a75a0467-c6ec-5d57-aa2d-55a1f89990ce",
    slug: "laptop",
    name: "Laptop",
    category: "av",
    widthM: 0.36, depthM: 0.25, heightM: 0.25,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "36cm \u00B7 table-mountable", color: "#2a2a2e",
    equipmentTags: ["power-outlet", "av-cable-path", "data-network"],
  },
  {
    id: "b74b2ea9-ddee-5a0c-98f5-964d29223bb6",
    slug: "microphone",
    name: "Table Microphone",
    category: "av",
    widthM: 0.10, depthM: 0.10, heightM: 0.25,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "Gooseneck \u00B7 table-mountable", color: "#2a2a2a",
    equipmentTags: ["power-outlet", "av-cable-path"],
  },
  // Mic stand is a passive accessory — it holds a mic but doesn't
  // itself imply power or cable. The mic placed on it carries tags.
  {
    id: "06ecec63-7d51-559c-be69-0058c4dad11f",
    slug: "mic-stand",
    name: "Mic Stand",
    category: "av",
    widthM: 0.50, depthM: 0.50, heightM: 1.60,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "1.6m tall \u00B7 freestanding", color: "#2a2a2a",
    equipmentTags: [],
  },

  // --- Lecterns ---
  // Lectern implies a bottle of water at the speaker. The sheet renders
  // this as a simple "Speaker water: 1 bottle" catering line.
  {
    id: "dfcdcdec-a772-5703-bdaa-af4d44d1e0f9",
    slug: "lectern",
    name: "Lectern",
    category: "lectern",
    widthM: 0.60, depthM: 0.50, heightM: 1.15,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "60cm \u00D7 50cm \u00B7 wooden", color: "#5a3a20",
    equipmentTags: ["water-supply"],
  },

  // --- Decor ---
  {
    id: "edc002d8-77a5-508a-bd5d-a5dc9ec74b5e",
    slug: "black-table-cloth",
    name: "Black Table Cloth",
    category: "decor",
    widthM: 0.50, depthM: 0.50, heightM: 0.01,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "Drapes over any table", color: "#1a1a1a",
    equipmentTags: [],
  },
  {
    id: "22a9184e-694e-5458-af23-4b95ed37ceeb",
    slug: "white-table-cloth",
    name: "White Table Cloth",
    category: "decor",
    widthM: 0.50, depthM: 0.50, heightM: 0.01,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "Drapes over any table", color: "#f5f1e8",
    equipmentTags: [],
  },
  {
    id: "1797ad4e-89c2-5895-a3e8-9af85ec110c0",
    slug: "dinner-place-setting",
    name: "Dinner Place Setting",
    category: "decor",
    widthM: 0.35, depthM: 0.35, heightM: 0.08,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "Plates, glasses and cutlery for tables", color: "#f7f2e6",
    equipmentTags: [],
  },

  // --- Bar ---
  // Physical bar counter — dark-wood finish, 1600 × 610 mm footprint,
  // 1208 mm tall. Trades Hall's inventory is a service counter only;
  // no stools travel with it. Categorised as "other" because the enum
  // doesn't include a dedicated "bar" value. UUID v5 derived from the
  // slug via the OMNITWIN namespace 43033bd6-17fd-599e-b305-0bd60dec57f0.
  {
    id: "e10816ab-5ae2-5925-914d-7ad60d33530f",
    slug: "bar-counter",
    meshUrl: "/models/furniture/bar-counter/v1/model.glb",
    thumbnailUrl: "/models/furniture/bar-counter/v1/preview.webp",
    name: "Bar",
    category: "other",
    widthM: 1.60, depthM: 0.61, heightM: 1.208,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "1.6m \u00D7 0.61m \u00B7 dark wood", color: "#3a2418",
    equipmentTags: [],
  },

  // --- Supplied furniture batch (2026-09-07) ---
  // New item envelopes are provisional planning sizes, not measured venue facts.
  // Supplied source geometry/materials and calibration are recorded beside each GLB.
  {
    id: "0275b4b9-1dc9-5af1-bd28-387d314abdf2",
    slug: "trestle-6ft-black",
    name: "Trestle Table (Black Cloth)",
    category: "table",
    widthM: 1.83, depthM: 0.76, heightM: 0.74,
    dimensionStatus: "approximate",
    seatCount: null, collisionType: "box", tableShape: "rectangular",
    maxCount: null, subtitle: "Approx. 1.83 × 0.76m · check dimensions", color: "#242424",
    meshUrl: "/models/furniture/trestle-6ft-black/v1/model.glb",
    thumbnailUrl: "/models/furniture/trestle-6ft-black/v1/preview.webp",
    equipmentTags: [],
  },
  {
    id: "b5ff8bd6-2cf9-574e-8102-256b7442313f",
    slug: "trestle-6ft-white",
    name: "Trestle Table (White Cloth)",
    category: "table",
    widthM: 1.83, depthM: 0.76, heightM: 0.74,
    dimensionStatus: "approximate",
    seatCount: null, collisionType: "box", tableShape: "rectangular",
    maxCount: null, subtitle: "Approx. 1.83 × 0.76m · check dimensions", color: "#eeeae3",
    meshUrl: "/models/furniture/trestle-6ft-white/v1/model.glb",
    thumbnailUrl: "/models/furniture/trestle-6ft-white/v1/preview.webp",
    equipmentTags: [],
  },
  {
    id: "dd53b7d4-7683-5e30-939f-d7190201e19f",
    slug: "trestle-6ft-wooden",
    name: "6ft Wooden Trestle Table",
    category: "table",
    widthM: 1.83, depthM: 0.76, heightM: 0.74,
    dimensionStatus: "approximate",
    seatCount: null, collisionType: "box", tableShape: "rectangular",
    maxCount: null, subtitle: "Approx. 1.83 × 0.76m · check dimensions", color: "#8b6140",
    meshUrl: "/models/furniture/trestle-6ft-wooden/v1/model.glb",
    thumbnailUrl: "/models/furniture/trestle-6ft-wooden/v1/preview.webp",
    equipmentTags: [],
  },
  {
    id: "4a84c25a-a205-59d3-a821-869c99b51430",
    slug: "round-table-6ft-black",
    name: "Round Table (Black Cloth)",
    category: "table",
    widthM: 1.83, depthM: 1.83, heightM: 0.76,
    dimensionStatus: "approximate",
    seatCount: null, collisionType: "cylinder", tableShape: "round",
    maxCount: null, subtitle: "Approx. 1.83 × 1.83m · check dimensions", color: "#242424",
    meshUrl: "/models/furniture/round-table-6ft-black/v1/model.glb",
    thumbnailUrl: "/models/furniture/round-table-6ft-black/v1/preview.webp",
    equipmentTags: [],
  },
  {
    id: "aec69e97-d577-5931-ba13-8258dbdd9050",
    slug: "round-table-6ft-white",
    name: "Round Table (White Cloth)",
    category: "table",
    widthM: 1.83, depthM: 1.83, heightM: 0.76,
    dimensionStatus: "approximate",
    seatCount: null, collisionType: "cylinder", tableShape: "round",
    maxCount: null, subtitle: "Approx. 1.83 × 1.83m · check dimensions", color: "#eeeae3",
    meshUrl: "/models/furniture/round-table-6ft-white/v1/model.glb",
    thumbnailUrl: "/models/furniture/round-table-6ft-white/v1/preview.webp",
    equipmentTags: [],
  },
  {
    id: "6f56f59e-b35d-5ed3-af15-c99790cf4cd0",
    slug: "cake-cutting-table",
    name: "Cake Cutting Table",
    category: "table",
    widthM: 1.1, depthM: 1.1, heightM: 0.76,
    dimensionStatus: "approximate",
    seatCount: null, collisionType: "cylinder", tableShape: "round",
    maxCount: null, subtitle: "Approx. 1.1 × 1.1m · check dimensions", color: "#eeeae3",
    meshUrl: "/models/furniture/cake-cutting-table/v1/model.glb",
    thumbnailUrl: "/models/furniture/cake-cutting-table/v1/preview.webp",
    equipmentTags: [],
  },
  {
    id: "1c552d4e-35b5-5eca-be3c-7b56e294c47b",
    slug: "ceremony-table",
    name: "Ceremony Table",
    category: "table",
    widthM: 1.6, depthM: 1, heightM: 0.74,
    dimensionStatus: "approximate",
    seatCount: null, collisionType: "box", tableShape: "rectangular",
    maxCount: null, subtitle: "Approx. 1.6 × 1m · check dimensions", color: "#eeeae3",
    meshUrl: "/models/furniture/ceremony-table/v1/model.glb",
    thumbnailUrl: "/models/furniture/ceremony-table/v1/preview.webp",
    equipmentTags: [],
  },
  {
    id: "ff127eed-4a88-5274-becb-3c5e65e1810b",
    slug: "checked-banquet-chair",
    name: "Checked Banquet Chair",
    category: "chair",
    widthM: 0.48, depthM: 0.62, heightM: 0.9,
    dimensionStatus: "approximate",
    seatCount: 1, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "Approx. 0.48 × 0.62m · check dimensions", color: "#a28a65",
    meshUrl: "/models/furniture/checked-banquet-chair/v1/model.glb",
    thumbnailUrl: "/models/furniture/checked-banquet-chair/v1/preview.webp",
    equipmentTags: [],
  },
  {
    id: "55aed51f-aee8-5fd0-b8d0-bb11053ae2a5",
    slug: "room-divider",
    name: "Folding Room Divider",
    category: "other",
    widthM: 4.2, depthM: 0.75, heightM: 1.8,
    dimensionStatus: "approximate",
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "Approx. 4.2 × 0.75m · check dimensions", color: "#764735",
    meshUrl: "/models/furniture/room-divider/v1/model.glb",
    thumbnailUrl: "/models/furniture/room-divider/v1/preview.webp",
    equipmentTags: [],
  },
  {
    id: "e7336170-233c-518e-9af2-8fa3807c0e8a",
    slug: "round-cafe-table-white",
    name: "Round Café Table (White Cloth)",
    category: "table",
    widthM: 0.9, depthM: 0.9, heightM: 0.74,
    dimensionStatus: "approximate",
    seatCount: null, collisionType: "cylinder", tableShape: "round",
    maxCount: null, subtitle: "Approx. 0.9 × 0.9m · check dimensions", color: "#eeeae3",
    meshUrl: "/models/furniture/round-cafe-table-white/v1/model.glb",
    thumbnailUrl: "/models/furniture/round-cafe-table-white/v1/preview.webp",
    equipmentTags: [],
  },
  {
    id: "a14d8f4d-24fd-51df-b89b-68dcab56bf0e",
    slug: "square-cafe-table-white",
    name: "Square Café Table (White Cloth)",
    category: "table",
    widthM: 1.05, depthM: 1.05, heightM: 0.74,
    dimensionStatus: "approximate",
    seatCount: null, collisionType: "box", tableShape: "rectangular",
    maxCount: null, subtitle: "Approx. 1.05 × 1.05m · check dimensions", color: "#eeeae3",
    meshUrl: "/models/furniture/square-cafe-table-white/v1/model.glb",
    thumbnailUrl: "/models/furniture/square-cafe-table-white/v1/preview.webp",
    equipmentTags: [],
  },
  {
    id: "94facedd-4305-5094-af1e-d5f772f51702",
    slug: "servery-unit",
    name: "Servery Unit",
    category: "other",
    widthM: 2.05, depthM: 0.6, heightM: 0.9,
    dimensionStatus: "approximate",
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "Approx. 2.05 × 0.6m · check dimensions", color: "#805d45",
    meshUrl: "/models/furniture/servery-unit/v1/model.glb",
    thumbnailUrl: "/models/furniture/servery-unit/v1/preview.webp",
    equipmentTags: [],
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Map from deterministic UUID to asset. */
const byId = new Map<string, CanonicalAsset>(
  CANONICAL_ASSETS.map((a) => [a.id, a]),
);

/** Map from slug to asset. */
const bySlug = new Map<string, CanonicalAsset>(
  CANONICAL_ASSETS.map((a) => [a.slug, a]),
);

export function getCanonicalAssetById(id: string): CanonicalAsset | undefined {
  return byId.get(id);
}

export function getCanonicalAssetBySlug(slug: string): CanonicalAsset | undefined {
  return bySlug.get(slug);
}
