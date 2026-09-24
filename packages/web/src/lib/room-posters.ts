// ---------------------------------------------------------------------------
// Room poster resolution — ONE slug→image mapping for every surface.
//
// Promoted from RoomsHomePage (C1): the Command Centre's lane rails need the
// same pictures the front door shows, and a duplicated map is exactly the
// drift the venue-truth module warns against. Two tiers:
//
//  - Supplied photographs (best-looking, but 0.7–2.6 MB each) — the front
//    door's hero cards.
//  - Scan posters at /images/rooms/<slug>.jpg — 1280×720 stills rendered
//    from each room's own capture (10–140 KB). Small enough for chrome:
//    lane rails, lists, anywhere a photo is furniture rather than the hero.
//
// No existence bookkeeping on purpose: consumers request the file and fall
// back (onError) to a typographic treatment, so a newly rendered poster
// appears everywhere without a code change and a room with neither never
// shows a broken image.
// ---------------------------------------------------------------------------

export const SUPPLIED_ROOM_STILLS: Readonly<Record<string, string>> = {
  "grand-hall": "/images/rooms/supplied/grand-hall.jpeg",
  "reception-room": "/images/rooms/supplied/reception-room.jpeg",
  "robert-adam-room": "/images/rooms/supplied/robert-adam-room.jpg",
  "lady-convenors-room": "/images/rooms/supplied/lady-convenors-room.png",
  "deacon-conveners-room": "/images/rooms/supplied/deacon-conveners-room.png",
  "north-gallery": "/images/rooms/supplied/north-gallery.png",
  "south-gallery": "/images/rooms/supplied/south-gallery.png",
  saloon: "/images/venue/saloon-room.jpg",
};

/** The best still for a hero surface: supplied photograph, else scan poster. */
export function roomPosterUrl(slug: string): string {
  // Own keys only: "__proto__" or "constructor" must not resolve to a builtin.
  const supplied = Object.hasOwn(SUPPLIED_ROOM_STILLS, slug) ? SUPPLIED_ROOM_STILLS[slug] : undefined;
  return supplied ?? roomScanPosterUrl(slug);
}

// The same supplied photographs re-encoded as display-sized WebP (quality 80).
// Pages showed the 0.4–2.6 MB originals as 44 px thumbnails and 300 px cards;
// with a ladder the browser fetches the smallest width that is sharp at the
// rendered size and pixel ratio. Grand Hall, Reception and Saloon reuse the
// venue ladder FreshPage already serves, so those files stay cached across
// pages. Add a room here only with a ladder cut from its own supplied still.
const SUPPLIED_ROOM_LADDERS: Readonly<Record<string, { readonly base: string; readonly widths: readonly number[] }>> = {
  "grand-hall": { base: "/images/venue/ladder/grand-hall-room", widths: [480, 768, 1120, 1535] },
  "reception-room": { base: "/images/venue/ladder/reception-room", widths: [480, 768, 1120, 1536] },
  saloon: { base: "/images/venue/ladder/saloon-room", widths: [480, 768, 1120, 1535] },
  "robert-adam-room": { base: "/images/rooms/supplied/ladder/robert-adam-room", widths: [480, 768, 1120] },
  "lady-convenors-room": { base: "/images/rooms/supplied/ladder/lady-convenors-room", widths: [480, 768, 1120] },
  "deacon-conveners-room": { base: "/images/rooms/supplied/ladder/deacon-conveners-room", widths: [480, 768, 1120] },
  "north-gallery": { base: "/images/rooms/supplied/ladder/north-gallery", widths: [480, 768, 1120] },
  "south-gallery": { base: "/images/rooms/supplied/ladder/south-gallery", widths: [480, 768, 1120] },
};

export interface RoomPosterSources {
  readonly src: string;
  readonly srcSet?: string;
}

/**
 * A room's still as `src` + `srcSet` for an `<img>` with a `sizes` hint:
 * the supplied photograph's WebP ladder when it has one, else the scan poster.
 */
export function roomPosterSources(slug: string): RoomPosterSources {
  const ladder = Object.hasOwn(SUPPLIED_ROOM_LADDERS, slug) ? SUPPLIED_ROOM_LADDERS[slug] : undefined;
  const largest = ladder?.widths.at(-1);
  if (ladder === undefined || largest === undefined) return { src: roomPosterUrl(slug) };
  return {
    src: `${ladder.base}-${String(largest)}.webp`,
    srcSet: ladder.widths.map((width) => `${ladder.base}-${String(width)}.webp ${String(width)}w`).join(", "),
  };
}

/** The lightweight scan-rendered poster — the right tier for chrome
 *  (a lane rail must not pull a 2.6 MB photograph for a 64px thumbnail). */
export function roomScanPosterUrl(slug: string): string {
  return `/images/rooms/${slug}.jpg`;
}
