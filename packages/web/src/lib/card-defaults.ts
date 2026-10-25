import { pieceCardId, type CardId } from "./setup-cards.js";

// ---------------------------------------------------------------------------
// Which cards the planner shows (card-dock spec §5; Q-13).
//
// The rail's eight named cards follow the event's style, set once and never
// reshuffled. The catalogue (More) collapses the 47 pieces onto about two
// dozen cards under five tabs, a card's variants (a table's cloths, a stage's
// deck sizes) riding on it as swatches. Search reads a card's name, its plain
// name and its aliases. What a card sets down is setup-cards.ts's (lane E).
// ---------------------------------------------------------------------------

export type RailStyle = "dinner" | "theatre" | "reception";

const ROUND: CardId = "round";
const TOP: CardId = "top-table";
const LONG: CardId = "long-table";
const DANCE: CardId = "dance-floor";
const STAGE = pieceCardId("platform");
const BAR = pieceCardId("bar-counter");
const POSEUR = pieceCardId("poseur-table");
const CAKE = pieceCardId("cake-cutting-table");
const LECTERN = pieceCardId("lectern");
const SCREEN = pieceCardId("projector-screen");
// Theatre rows arm a single chair with the line brush until Q-23 builds them (spec §5).
const THEATRE_ROWS = pieceCardId("burgess-turini-18-3");
const CHAIRS = pieceCardId("banquet-chair");

/** The eight by style, in slot order (keys 1–8). */
export const RAIL_SLOTS: Readonly<Record<RailStyle, readonly CardId[]>> = {
  dinner: [ROUND, TOP, LONG, DANCE, STAGE, BAR, POSEUR, CAKE],
  theatre: [THEATRE_ROWS, STAGE, LECTERN, SCREEN, TOP, CHAIRS, POSEUR, BAR],
  reception: [POSEUR, BAR, STAGE, LECTERN, SCREEN, CAKE, DANCE, CHAIRS],
};

/** The rail's short names (a 14 px name fits about 12 characters, spec §4.1). */
const RAIL_NAMES: Readonly<Record<string, string>> = {
  [ROUND]: "Round of 10",
  [TOP]: "Top table",
  [LONG]: "Long table",
  [DANCE]: "Dance floor",
  [STAGE]: "Stage",
  [BAR]: "Bar",
  [POSEUR]: "Poseur",
  [CAKE]: "Cake table",
  [LECTERN]: "Lectern",
  [SCREEN]: "Screen",
  [THEATRE_ROWS]: "Theatre rows",
  [CHAIRS]: "Chairs",
};

export function railName(id: CardId): string {
  return RAIL_NAMES[id] ?? id;
}

export const CARD_TABS = ["Tables", "Chairs", "Staging", "AV", "Other"] as const;
export type CardTab = (typeof CARD_TABS)[number];

export type VariantColour = "white" | "black" | "wood" | "bare" | "green" | "blue" | null;

export interface CardVariant {
  readonly slug: string;
  /** The swatch it shows, or null for a size variant ("6 × 4 deck"). */
  readonly colour: VariantColour;
  /** A size variant's own words. */
  readonly label?: string;
}

export interface CatalogueCard {
  /** What arming it puts in hand: a setup, or its first variant's piece. */
  readonly id: CardId;
  readonly name: string;
  readonly tab: CardTab;
  /** Other words people use for it. */
  readonly aliases: readonly string[];
  /** The pieces it stands for; empty for a setup (its colourway is the setup's). */
  readonly variants: readonly CardVariant[];
}

function piece(name: string, tab: CardTab, variants: readonly CardVariant[], aliases: readonly string[] = []): CatalogueCard {
  const first = variants[0];
  if (first === undefined) throw new Error(`card ${name} names no piece`);
  return { id: pieceCardId(first.slug), name, tab, aliases, variants };
}

function setup(id: CardId, name: string, tab: CardTab, aliases: readonly string[]): CatalogueCard {
  return { id, name, tab, aliases, variants: [] };
}

const v = (slug: string, colour: VariantColour = null, label?: string): CardVariant => (label === undefined ? { slug, colour } : { slug, colour, label });

export const CATALOGUE_CARDS: readonly CatalogueCard[] = [
  setup(ROUND, "Round of 10", "Tables", ["round", "banquet round", "dinner table"]),
  setup(TOP, "Top table", "Tables", ["top", "head table", "panel table"]),
  setup(LONG, "Long table", "Tables", ["banqueting table", "long"]),
  piece("Round 1.83 m", "Tables", [v("round-table-6ft-white", "white"), v("round-table-6ft-black", "black"), v("round-table-6ft", "bare")], ["6 ft round"]),
  piece("Trestle 6 ft", "Tables", [v("trestle-6ft-white", "white"), v("trestle-6ft-black", "black"), v("trestle-6ft-wooden", "wood"), v("trestle-6ft", "bare")], ["trestle", "rectangular table"]),
  piece("Trestle 4 ft", "Tables", [v("trestle-4ft-white", "white"), v("trestle-4ft-black", "black"), v("trestle-4ft", "bare")]),
  piece("Poseur", "Tables", [v("poseur-table-white", "white"), v("poseur-table-black", "black"), v("poseur-table", "bare")], ["high table", "cocktail table", "poseur table"]),
  piece("Café round", "Tables", [v("round-cafe-table-white", "white")], ["cafe round", "bistro table"]),
  piece("Café square", "Tables", [v("square-cafe-table-white", "white")], ["cafe square"]),
  piece("Cake table", "Tables", [v("cake-cutting-table")], ["cake"]),
  piece("Ceremony table", "Tables", [v("ceremony-table")], ["signing table"]),
  piece("Burgess Turini", "Chairs", [v("burgess-turini-18-3")], ["burgess", "turini"]),
  piece("Checked banquet", "Chairs", [v("checked-banquet-chair")]),
  piece("Chiavari", "Chairs", [v("chiavari-chair")], ["tiffany chair"]),
  piece("Gallery red and gold", "Chairs", [v("gallery-chair-red-gold")], ["gallery chair"]),
  piece("Pink chair", "Chairs", [v("pink-chair")]),
  piece("High chair", "Chairs", [v("highchair-white", "white"), v("highchair-green", "green"), v("highchair-blue", "blue"), v("highchair-wooden", "wood")], ["baby chair"]),
  piece("Banquet chair", "Chairs", [v("banquet-chair")], ["chair", "chairs"]),
  piece("Stage deck", "Staging", [v("platform", null, "8 × 4 ft"), v("staging-deck-6x4", null, "6 × 4 ft"), v("staging-deck-6x3", null, "6 × 3 ft"), v("platform-narrow", null, "Narrow")], ["stage", "platform", "riser"]),
  setup(DANCE, "Dance floor", "Staging", ["dance", "dancefloor", "parquet"]),
  piece("Screen", "AV", [v("projector-screen")], ["projector screen"]),
  piece("Television", "AV", [v("hisense-television")], ["tv", "monitor"]),
  piece("Projector", "AV", [v("projector")]),
  piece("Laptop", "AV", [v("laptop")]),
  piece("Mic stand", "AV", [v("mic-stand")], ["microphone stand"]),
  piece("Handheld mic", "AV", [v("handheld-microphone"), v("microphone")], ["microphone", "mic"]),
  piece("Lapel mic", "AV", [v("lapel-microphone")], ["lavalier"]),
  piece("Bar", "Other", [v("bar-counter")], ["bar counter", "drinks"]),
  piece("Servery", "Other", [v("servery-unit")], ["buffet", "servery unit"]),
  piece("Room divider", "Other", [v("room-divider")], ["divider", "screen wall"]),
  piece("Lectern", "Other", [v("lectern")], ["podium"]),
];

/**
 * Cards whose name, or one of whose aliases, matches what was typed: a name
 * that starts with it first, then an alias it equals, then a name that holds
 * it, then an alias that holds it.
 */
export function searchCatalogue(query: string): readonly CatalogueCard[] {
  const wanted = query.trim().toLowerCase();
  if (wanted.length === 0) return [];
  const scored: { readonly card: CatalogueCard; readonly score: number; readonly order: number }[] = [];
  CATALOGUE_CARDS.forEach((card, order) => {
    const name = card.name.toLowerCase();
    const aliases = card.aliases.map((alias) => alias.toLowerCase());
    const score = name.startsWith(wanted) ? 0
      : aliases.includes(wanted) ? 1
        : name.includes(wanted) ? 2
          : aliases.some((alias) => alias.includes(wanted)) ? 3
            : -1;
    if (score >= 0) scored.push({ card, score, order });
  });
  return scored.sort((a, b) => a.score - b.score || a.order - b.order).map((entry) => entry.card);
}
