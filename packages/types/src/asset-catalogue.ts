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
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export const CANONICAL_ASSETS: readonly CanonicalAsset[] = [
  // --- Tables ---
  {
    id: "a1ef4d89-7786-5878-bee1-87b3fac28200",
    slug: "round-table-6ft",
    name: "6ft Round Table",
    category: "table",
    widthM: 1.83, depthM: 1.83, heightM: 0.76,
    seatCount: 10, collisionType: "cylinder", tableShape: "round",
    maxCount: null, subtitle: "1.8m round \u00B7 seats up to 12", color: "#c4a882",
  },
  {
    id: "c0d0b2df-23de-5265-81f3-2c06af79697d",
    slug: "trestle-6ft",
    name: "6ft Trestle Table",
    category: "table",
    widthM: 1.83, depthM: 0.76, heightM: 0.74,
    seatCount: null, collisionType: "box", tableShape: "rectangular",
    maxCount: null, subtitle: "1.8m \u00D7 0.76m \u00B7 seats up to 20", color: "#b89b72",
  },
  {
    id: "7b423ca2-9714-5cb2-919c-e938a5c39933",
    slug: "trestle-4ft",
    name: "4ft Trestle Table",
    category: "table",
    widthM: 1.22, depthM: 0.76, heightM: 0.74,
    seatCount: null, collisionType: "box", tableShape: "rectangular",
    maxCount: null, subtitle: "1.2m \u00D7 0.76m \u00B7 seats up to 12", color: "#b89b72",
  },
  {
    id: "19d030aa-bc18-5665-8561-1e26e0679fe3",
    slug: "poseur-table",
    name: "Poseur Table",
    category: "table",
    widthM: 0.60, depthM: 0.60, heightM: 1.05,
    seatCount: null, collisionType: "cylinder", tableShape: "round",
    maxCount: null, subtitle: "60cm round \u00B7 standing height", color: "#c0c0c8",
  },
  {
    id: "a06f4c87-0ad6-5573-85a4-025276c2de03",
    slug: "poseur-table-black",
    name: "Poseur Table (Black)",
    category: "table",
    widthM: 0.60, depthM: 0.60, heightM: 1.05,
    seatCount: null, collisionType: "cylinder", tableShape: "round",
    maxCount: null, subtitle: "60cm round \u00B7 black cloth", color: "#1a1a1a",
  },
  {
    id: "55534f43-9515-5489-8963-f314712ae4db",
    slug: "poseur-table-white",
    name: "Poseur Table (White)",
    category: "table",
    widthM: 0.60, depthM: 0.60, heightM: 1.05,
    seatCount: null, collisionType: "cylinder", tableShape: "round",
    maxCount: null, subtitle: "60cm round \u00B7 white cloth", color: "#f0ede8",
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
  },

  // --- Stage ---
  {
    id: "dec6b24b-d72c-5e5e-a883-cc9deed2f322",
    slug: "platform",
    name: "Platform",
    category: "stage",
    widthM: 2.44, depthM: 1.22, heightM: 0.40,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "2.4m \u00D7 1.2m \u00B7 40cm high", color: "#4a4a4a",
  },
  {
    id: "d5273408-6b5c-5f4c-b12c-3f61fe3c7a51",
    slug: "platform-narrow",
    name: "Narrow Platform",
    category: "stage",
    widthM: 2.44, depthM: 1.02, heightM: 0.40,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: 1, subtitle: "2.4m \u00D7 1.0m \u00B7 40cm high", color: "#4a4a4a",
  },

  // --- AV ---
  {
    id: "26e25cd4-ae3e-537d-9ac0-66021f925cdd",
    slug: "projector-screen",
    name: "Projector Screen",
    category: "av",
    widthM: 2.50, depthM: 0.60, heightM: 1.80,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "2.5m wide \u00B7 freestanding", color: "#1a1a1a",
  },
  {
    id: "6907e1d9-33d6-5910-b55f-78a77727d6b0",
    slug: "projector",
    name: "Laser Projector",
    category: "av",
    widthM: 0.55, depthM: 0.35, heightM: 0.10,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "55cm \u00B7 table-mountable", color: "#3a3a40",
  },
  {
    id: "a75a0467-c6ec-5d57-aa2d-55a1f89990ce",
    slug: "laptop",
    name: "Laptop",
    category: "av",
    widthM: 0.36, depthM: 0.25, heightM: 0.25,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "36cm \u00B7 table-mountable", color: "#2a2a2e",
  },
  {
    id: "b74b2ea9-ddee-5a0c-98f5-964d29223bb6",
    slug: "microphone",
    name: "Table Microphone",
    category: "av",
    widthM: 0.10, depthM: 0.10, heightM: 0.25,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "Gooseneck \u00B7 table-mountable", color: "#2a2a2a",
  },
  {
    id: "06ecec63-7d51-559c-be69-0058c4dad11f",
    slug: "mic-stand",
    name: "Mic Stand",
    category: "av",
    widthM: 0.50, depthM: 0.50, heightM: 1.60,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "1.6m tall \u00B7 freestanding", color: "#2a2a2a",
  },

  // --- Lecterns ---
  {
    id: "dfcdcdec-a772-5703-bdaa-af4d44d1e0f9",
    slug: "lectern",
    name: "Lectern",
    category: "lectern",
    widthM: 0.60, depthM: 0.50, heightM: 1.15,
    seatCount: null, collisionType: "box", tableShape: null,
    maxCount: null, subtitle: "60cm \u00D7 50cm \u00B7 wooden", color: "#5a3a20",
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
