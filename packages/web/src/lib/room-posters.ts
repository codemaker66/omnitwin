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
  return SUPPLIED_ROOM_STILLS[slug] ?? roomScanPosterUrl(slug);
}

/** The lightweight scan-rendered poster — the right tier for chrome
 *  (a lane rail must not pull a 2.6 MB photograph for a 64px thumbnail). */
export function roomScanPosterUrl(slug: string): string {
  return `/images/rooms/${slug}.jpg`;
}
