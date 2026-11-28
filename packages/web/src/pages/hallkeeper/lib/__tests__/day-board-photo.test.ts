import { describe, expect, it } from "vitest";
import { dayBoardRoomPhoto } from "../day-board-photo.js";
import { roomPhoto } from "../../../../components/dashboard/enquiries/enquiry-room-photo.js";
import { diaryRoomPhoto } from "../../../../lib/diary-room-photos.js";

// ---------------------------------------------------------------------------
// The Day Board pictures each room empty (T-753): views reprojected from the
// venue's own panoramas for the four rooms they cover, the supplied Diary
// photographs for the rest of Trades Hall, and nothing for another venue.
// The Enquiries desk keeps its own photographs, unchanged.
// ---------------------------------------------------------------------------

const PANORAMA_ROOMS = ["grand-hall", "saloon", "reception-room", "robert-adam-room"] as const;

describe("the Day Board's room photographs", () => {
  it.each(["trades-hall", "trades-hall-glasgow"])("serves the four empty-room views for %s at every width", (venue) => {
    for (const room of PANORAMA_ROOMS) {
      const photo = dayBoardRoomPhoto(venue, room);
      const path = (width: number): string => `/images/rooms/day-board/${room}-${String(width)}.webp`;
      expect(photo?.src).toBe(path(768));
      expect(photo?.srcSet).toBe([480, 768, 1120, 1536].map((width) => `${path(width)} ${String(width)}w`).join(", "));
      expect(photo?.objectPosition).toBe("50% 50%");
    }
  });

  it("keeps the supplied Diary photographs for the galleries and the other rooms", () => {
    for (const room of ["north-gallery", "south-gallery", "lady-convenors-room", "deacon-conveners-room"]) {
      const supplied = diaryRoomPhoto(room);
      expect(supplied).not.toBeNull();
      expect(dayBoardRoomPhoto("trades-hall-glasgow", room)).toEqual({
        src: supplied?.src, srcSet: supplied?.srcSet, objectPosition: supplied?.objectPosition,
      });
    }
    expect(dayBoardRoomPhoto("trades-hall-glasgow", "a-room-nobody-photographed")).toBeNull();
  });

  it("never pictures another venue's room as Trades Hall's", () => {
    for (const room of [...PANORAMA_ROOMS, "north-gallery"]) expect(dayBoardRoomPhoto("harbour-hall", room)).toBeNull();
  });

  it("leaves the Enquiries desk's photographs exactly as they were", () => {
    const ladder = (stem: string, widths: readonly number[], objectPosition: string): unknown => ({
      src: `/images/venue/ladder/${stem}-768.webp`,
      srcSet: widths.map((width) => `/images/venue/ladder/${stem}-${String(width)}.webp ${String(width)}w`).join(", "),
      objectPosition,
    });
    expect(roomPhoto("trades-hall-glasgow", "grand-hall")).toEqual(ladder("grand-hall-room", [480, 768, 1120, 1535], "50% 42%"));
    expect(roomPhoto("trades-hall-glasgow", "reception-room")).toEqual(ladder("reception-room", [480, 768, 1120, 1536], "54% 52%"));
    expect(roomPhoto("trades-hall", "saloon")).toEqual(ladder("saloon-room", [480, 768, 1120, 1535], "54% 46%"));
    expect(roomPhoto("trades-hall-glasgow", "robert-adam-room")).toEqual({
      src: "/images/rooms/diary/robert-adam-room-240.webp",
      srcSet: "/images/rooms/diary/robert-adam-room-240.webp 240w, /images/rooms/diary/robert-adam-room-480.webp 480w",
      objectPosition: "50% 46%",
    });
    expect(roomPhoto("harbour-hall", "grand-hall")).toBeNull();
    // Nothing of the Day Board's views reaches the desk.
    for (const room of PANORAMA_ROOMS) expect(roomPhoto("trades-hall-glasgow", room)?.src).not.toContain("/day-board/");
  });
});
