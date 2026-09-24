import { TRADES_HALL_VENUE_SLUG } from "@omnitwin/types";
import { diaryRoomPhoto } from "../../../lib/diary-room-photos.js";

// ---------------------------------------------------------------------------
// The photograph of the room an enquiry asks for.
//
// Only Trades Hall's own supplied photographs exist, so a room is pictured
// only when its venue is Trades Hall under either spelling the building has
// (the twin/asset slug and the seeded database slug). Another venue's
// "Grand Hall" gets no picture rather than Trades Hall's.
// ---------------------------------------------------------------------------

const TRADES_HALL_SLUGS: ReadonlySet<string> = new Set([TRADES_HALL_VENUE_SLUG, "trades-hall-glasgow"]);

export interface RoomPhoto {
  readonly src: string;
  readonly srcSet: string | undefined;
  readonly objectPosition: string;
}

interface LadderPhoto {
  readonly stem: string;
  readonly widths: readonly number[];
  readonly objectPosition: string;
}

/** The public site's display-sized ladders of the same supplied photographs. */
const LADDERS: Readonly<Record<string, LadderPhoto>> = {
  "grand-hall": { stem: "grand-hall-room", widths: [480, 768, 1120, 1535], objectPosition: "50% 42%" },
  "reception-room": { stem: "reception-room", widths: [480, 768, 1120, 1536], objectPosition: "54% 52%" },
  saloon: { stem: "saloon-room", widths: [480, 768, 1120, 1535], objectPosition: "54% 46%" },
};

export function roomPhoto(venueSlug: string, roomSlug: string): RoomPhoto | null {
  if (!TRADES_HALL_SLUGS.has(venueSlug)) return null;
  const ladder = Object.hasOwn(LADDERS, roomSlug) ? LADDERS[roomSlug] : undefined;
  if (ladder !== undefined) {
    const path = (width: number): string => `/images/venue/ladder/${ladder.stem}-${String(width)}.webp`;
    return {
      src: path(768),
      srcSet: ladder.widths.map((width) => `${path(width)} ${String(width)}w`).join(", "),
      objectPosition: ladder.objectPosition,
    };
  }
  const supplied = diaryRoomPhoto(roomSlug);
  return supplied === null ? null : { src: supplied.src, srcSet: supplied.srcSet, objectPosition: supplied.objectPosition };
}
