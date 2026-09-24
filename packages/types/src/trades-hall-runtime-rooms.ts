// Trades Hall runtime room identifiers, kept free of schemas so a page that
// only needs the slug list does not import the asset-version contracts. They
// are re-exported by asset-version.ts, their established import path.
export const TRADES_HALL_VENUE_SLUG = "trades-hall";
export const TRADES_HALL_RUNTIME_ROOM_SLUGS = [
  "grand-hall",
  "reception-room",
  "robert-adam-room",
  "saloon",
  "lady-convenors-room",
  "deacon-conveners-room",
  "north-gallery",
  "south-gallery",
] as const;
