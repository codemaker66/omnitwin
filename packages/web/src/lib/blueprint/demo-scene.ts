import type { BlueprintScene, RoundTableItem } from "./types.js";

// ---------------------------------------------------------------------------
// Demo scene — Grand Hall wedding banquet matching the TH_2D.png mock.
//
// Grand Hall dimensions (21 × 10 m) come from the official Trades Hall
// Glasgow website. Layout is a six-round-per-row × two-row banquet with
// a top table, stage, bar, and central dancefloor.
//
// Literal scene only — once the 2D view is wired into the real
// configuration data model, this file becomes a unit-test fixture.
// ---------------------------------------------------------------------------

const GH_WIDTH_M = 21;
const GH_LENGTH_M = 10;

function roundAt(id: string, cx: number, cy: number): RoundTableItem {
  return {
    id,
    kind: "round-table",
    shape: "round",
    center: { x: cx, y: cy },
    diameterM: 1.8,
    seats: 10,
    linen: "Ivory",
    centrepiece: "Low floral",
  };
}

/**
 * Two rows of six round tables. Row 1 at y≈4.3 m, row 2 at y≈6.8 m.
 * Tables span x≈2.5 → 18.5 m evenly.
 */
const ROUND_TABLES: readonly RoundTableItem[] = (() => {
  const xs = [2.7, 5.9, 9.1, 12.3, 15.5, 18.3];
  const ys = [4.3, 6.8];
  const tables: RoundTableItem[] = [];
  let n = 0;
  for (const y of ys) {
    for (const x of xs) {
      n += 1;
      tables.push(roundAt(`round-${String(n)}`, x, y));
    }
  }
  return tables;
})();

export const DEMO_SCENE: BlueprintScene = {
  roomName: "Grand Hall",
  layoutName: "Banquet layout",
  status: "draft",
  eventType: "wedding",
  guestCount: 180,
  room: {
    widthM: GH_WIDTH_M,
    lengthM: GH_LENGTH_M,
    labels: [
      { text: "WINDOWS", position: { x: 0.8, y: 4.2 } },
    ],
    doors: [
      { wall: "north", distanceM: 4 },
      { wall: "north", distanceM: 17.5 },
      { wall: "south", distanceM: 4 },
      { wall: "south", distanceM: 17.5 },
    ],
  },
  items: [
    // Stage — top left.
    {
      id: "stage",
      kind: "stage",
      shape: "rect",
      topLeft: { x: 1, y: 1 },
      widthM: 8,
      lengthM: 3,
    },
    // Top table — top right.
    {
      id: "top-table",
      kind: "top-table",
      shape: "rect",
      topLeft: { x: 10, y: 1 },
      widthM: 10,
      lengthM: 1.3,
      seats: 14,
      linen: "Ivory",
      centrepiece: "Tall florals",
    },
    ...ROUND_TABLES,
    // Dancefloor — centre bottom.
    {
      id: "dancefloor",
      kind: "dancefloor",
      shape: "dancefloor",
      topLeft: { x: 6, y: 8.2 },
      widthM: 6,
      lengthM: 1.6,
    },
    // Bar — bottom right.
    {
      id: "bar",
      kind: "bar",
      shape: "bar",
      topLeft: { x: 13.5, y: 8.4 },
      widthM: 6,
      lengthM: 1,
    },
  ],
  lastSavedAtMs: Date.now() - 2 * 60 * 1000,
};

/** The table highlighted in the mock — row 1, column 3. */
export const DEMO_SELECTED_ID = "round-3";
