/** Room-identity photographs for Diary rails, separate from the scan renderer.
 * Five lossless thumbnail pairs retain the supplied photographs' full frames;
 * their source hashes and pixel checks live in /images/rooms/diary/provenance.json.
 * A photograph does not describe the current booking layout or available stock.
 */
export interface DiaryRoomPhoto {
  readonly src: string;
  readonly srcSet?: string;
  readonly width: number;
  readonly height: number;
  readonly objectPosition: string;
}

function suppliedThumbnail(slug: string, height: number, objectPosition: string): DiaryRoomPhoto {
  const base = `/images/rooms/diary/${slug}`;
  return {
    src: `${base}-240.webp`,
    srcSet: `${base}-240.webp 240w, ${base}-480.webp 480w`,
    width: 240,
    height,
    objectPosition,
  };
}

const PHOTOS: Readonly<Record<string, DiaryRoomPhoto>> = {
  "grand-hall": {
    src: "/images/venue/ladder/grand-hall-room-480.webp",
    width: 480,
    height: 320,
    objectPosition: "50% 48%",
  },
  "reception-room": {
    src: "/images/venue/ladder/reception-room-480.webp",
    width: 480,
    height: 320,
    objectPosition: "54% 52%",
  },
  saloon: {
    src: "/images/venue/ladder/saloon-room-480.webp",
    width: 480,
    height: 321,
    objectPosition: "54% 46%",
  },
  // The existing Robert Adam venue ladder is a bridal portrait. Use the
  // separately supplied landscape so this rail identifies the room itself.
  "robert-adam-room": suppliedThumbnail("robert-adam-room", 160, "50% 46%"),
  "lady-convenors-room": suppliedThumbnail("lady-convenors-room", 180, "50% 52%"),
  "deacon-conveners-room": suppliedThumbnail("deacon-conveners-room", 160, "65% 50%"),
  "north-gallery": suppliedThumbnail("north-gallery", 169, "55% 52%"),
  "south-gallery": suppliedThumbnail("south-gallery", 180, "55% 58%"),
};

/** Unknown room identities deliberately retain the caller's text fallback. */
export function diaryRoomPhoto(slug: string): DiaryRoomPhoto | null {
  return Object.hasOwn(PHOTOS, slug) ? PHOTOS[slug] ?? null : null;
}

/** Account for object-fit: cover: an 88px-high landscape occupies up to
 * 132 source CSS pixels horizontally before the sides are clipped. */
export const DIARY_ROOM_PHOTO_SIZES = "(max-width: 640px) 87px, 132px";
