/** Supplied Trades Hall illustrations, separate from persisted room geometry. */
export const HALLKEEPER_PLAN_VENUE_SLUG = "trades-hall-glasgow";

export interface RoomPlanCrop {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface HallkeeperRoomPlan {
  readonly slug: string;
  readonly name: string;
  readonly cleanedSrc: string | null;
  readonly originalSrc: string;
  /** Pixel viewport only. Never a room measurement or a geometry transform. */
  readonly originalCrop?: RoomPlanCrop;
  readonly sourceNote?: string;
}

export const HALLKEEPER_ROOM_PLANS: readonly HallkeeperRoomPlan[] = [
  { slug: "grand-hall", name: "Grand Hall", cleanedSrc: "/room-plans/cleaned/grand-hall.png", originalSrc: "/room-plans/originals/grand-hall.png" },
  { slug: "saloon", name: "Saloon", cleanedSrc: "/room-plans/cleaned/saloon.png", originalSrc: "/room-plans/originals/saloon.png" },
  { slug: "robert-adam-room", name: "Robert Adam Room", cleanedSrc: "/room-plans/cleaned/robert-adam-room.png", originalSrc: "/room-plans/originals/robert-adam-room.png", sourceNote: "Both connected sections belong to this room. Unlabelled source symbols are retained." },
  { slug: "reception-room", name: "Reception Room", cleanedSrc: "/room-plans/cleaned/reception-room.png", originalSrc: "/room-plans/originals/reception-room.png" },
  {
    slug: "north-gallery", name: "North Gallery", cleanedSrc: null,
    originalSrc: "/room-plans/originals/galleries-combined.png",
    originalCrop: { sourceWidth: 742, sourceHeight: 649, x: 44, y: 40, width: 320, height: 566 },
    sourceNote: "Left-hand room from the supplied combined drawing. The original download retains both galleries.",
  },
  { slug: "south-gallery", name: "South Gallery", cleanedSrc: "/room-plans/cleaned/south-gallery.png", originalSrc: "/room-plans/originals/south-gallery.png" },
];

export function getHallkeeperRoomPlan(slug: string | null | undefined): HallkeeperRoomPlan | null {
  return HALLKEEPER_ROOM_PLANS.find((room) => room.slug === slug) ?? null;
}
