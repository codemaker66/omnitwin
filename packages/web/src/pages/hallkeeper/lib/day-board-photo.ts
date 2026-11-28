import { TRADES_HALL_SLUGS, type RoomPhoto } from "../../../components/dashboard/enquiries/enquiry-room-photo.js";
import { diaryRoomPhoto } from "../../../lib/diary-room-photos.js";

// ---------------------------------------------------------------------------
// The Day Board's photograph of a room (T-753, 22 November 2026).
//
// On the Day Board a room is pictured empty, so a photograph names the room
// and never implies an event. Four rooms have views reprojected from the
// venue's own panoramas (public/images/rooms/day-board, whose
// provenance.json records each sweep and view); the rest of Trades Hall keeps
// its supplied Diary photographs. Another venue's "Grand Hall" gets no
// picture rather than Trades Hall's. The Enquiries desk keeps roomPhoto().
// ---------------------------------------------------------------------------

/** The rooms the panorama views cover, by their slugs. */
const EMPTY_ROOM_VIEWS: ReadonlySet<string> = new Set(["grand-hall", "saloon", "reception-room", "robert-adam-room"]);
const WIDTHS: readonly number[] = [480, 768, 1120, 1536];

export function dayBoardRoomPhoto(venueSlug: string, roomSlug: string): RoomPhoto | null {
  if (!TRADES_HALL_SLUGS.has(venueSlug)) return null;
  if (EMPTY_ROOM_VIEWS.has(roomSlug)) {
    const path = (width: number): string => `/images/rooms/day-board/${roomSlug}-${String(width)}.webp`;
    return {
      src: path(768),
      srcSet: WIDTHS.map((width) => `${path(width)} ${String(width)}w`).join(", "),
      // Each view is framed on the room itself.
      objectPosition: "50% 50%",
    };
  }
  const supplied = diaryRoomPhoto(roomSlug);
  return supplied === null ? null : { src: supplied.src, srcSet: supplied.srcSet, objectPosition: supplied.objectPosition };
}
